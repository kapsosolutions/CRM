#!/usr/bin/env bash
# =============================================================================
# Install one release of the CRM and switch to it, with automatic rollback.
# Installed as /usr/local/sbin/crm-deploy-release (root-owned). Runs as root
# (GitHub Actions calls it through a restricted sudo rule for the `deploy`
# user; deploy/deploy.ps1 calls it as root).
#
#   deploy-release.sh <incoming-dir>
#
# <incoming-dir> holds:
#   release.env    RELEASE_ID=<id>, optional GIT_SHA=, BACKEND_TREE=
#   backend.tgz    backend source (no node_modules, no .env)   [optional]
#   frontend.tgz   built frontend (contents of frontend/dist)  [optional]
# A part that is missing is copied from the release now live, so a frontend-
# only deploy doesn't restart the backend.
#
# Layout (CRM_ROOT=/opt/crm):
#   shared/.env, shared/keys/        kept across releases (symlinked in)
#   releases/<id>/backend, frontend  one folder per release
#   current -> releases/<id>         switched atomically
#   backend -> current/backend       what systemd runs (WorkingDirectory)
#   frontend -> current/frontend     what nginx serves (root .../dist)
# The last KEEP releases stay on disk for rollback (rollback-release.sh).
# =============================================================================
set -Eeuo pipefail
umask 022

CRM_ROOT="${CRM_ROOT:-/opt/crm}"
SERVICE="${SERVICE:-crm-backend}"
APP_USER="${APP_USER:-crm}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5055/api/health}"
PUBLIC_URL="${PUBLIC_URL:-https://kapsosolutions.com/}"
INCOMING_ROOT="${INCOMING_ROOT:-/home/deploy/incoming}"
HEALTH_WAIT="${HEALTH_WAIT:-45}"
KEEP="${KEEP:-5}"

log() { printf '[deploy %(%H:%M:%S)T] %s\n' -1 "$*"; }
die() { log "ERROR: $*"; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
IN="${1:-}"
[ -n "$IN" ] || die "usage: deploy-release.sh <incoming-dir>"
IN="$(realpath -e -- "$IN")" || die "incoming dir not found"
if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != root ]; then
  # Through sudo (the deploy user): only its own upload folder.
  case "$IN" in "$INCOMING_ROOT"/*) ;; *) die "incoming dir must be under $INCOMING_ROOT" ;; esac
else
  case "$IN" in
    "$INCOMING_ROOT"/*|/root/crm-deploy-*|/tmp/crm-deploy-*) ;;
    *) die "incoming dir must be under $INCOMING_ROOT" ;;
  esac
fi
[ -f "$IN/release.env" ] || die "missing release.env"

# release.env: only plain KEY=value lines with safe characters are read.
RELEASE_ID="" GIT_SHA="" BACKEND_TREE=""
while IFS='=' read -r k v; do
  case "$k" in
    RELEASE_ID|GIT_SHA|BACKEND_TREE) [[ "$v" =~ ^[A-Za-z0-9._-]{0,80}$ ]] || die "bad value for $k"; printf -v "$k" '%s' "$v" ;;
  esac
done < "$IN/release.env"
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]{6,80}$ ]] || die "bad RELEASE_ID"

# One deploy at a time.
exec 9>"${LOCK_FILE:-/run/crm-deploy.lock}"
flock -n 9 || die "another deploy is running"

REL="$CRM_ROOT/releases/$RELEASE_ID"
[ -e "$REL" ] && die "release $RELEASE_ID already exists"
PREV="$(readlink -f "$CRM_ROOT/current" 2>/dev/null || true)"
[ -n "$PREV" ] && [ -d "$PREV" ] || die "no current release ($CRM_ROOT/current)"

cleanup_failed() { [ -n "${REL:-}" ] && [ -d "$REL" ] && [ "$(readlink -f "$CRM_ROOT/current")" != "$REL" ] && rm -rf -- "$REL"; }
trap 'log "failed at line $LINENO"; cleanup_failed' ERR

log "release $RELEASE_ID ${GIT_SHA:+(git $GIT_SHA)}; live now: $(basename "$PREV")"
install -d -o "$APP_USER" -g "$APP_USER" "$REL"

# ---- backend --------------------------------------------------------------
BACKEND_CHANGED=1
if [ -f "$IN/backend.tgz" ] && [ -n "$BACKEND_TREE" ] && [ -f "$PREV/.backend-tree" ] \
   && [ "$(cat "$PREV/.backend-tree")" = "$BACKEND_TREE" ]; then
  log "backend unchanged (tree $BACKEND_TREE): reusing the live one"
  BACKEND_CHANGED=0
fi
if [ -f "$IN/backend.tgz" ] && [ "$BACKEND_CHANGED" = 1 ]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$REL/backend"
  # Extract as the app user, never as root.
  # root opens the upload (the app user can't read the deploy user's folder),
  # the app user unpacks it.
  runuser -u "$APP_USER" -- tar -xzf - -C "$REL/backend" --no-same-owner --no-same-permissions < "$IN/backend.tgz"
  rm -rf -- "$REL/backend/.env" "$REL/backend/keys" "$REL/backend/node_modules"
  ln -s "$CRM_ROOT/shared/.env" "$REL/backend/.env"
  ln -s "$CRM_ROOT/shared/keys" "$REL/backend/keys"
  log "npm ci (production dependencies)"
  ( cd "$REL/backend" && runuser -u "$APP_USER" -- env HOME="$CRM_ROOT" npm ci --omit=dev --no-audit --no-fund --loglevel=error )
  log "syntax check"
  ( cd "$REL/backend" && find . -path ./node_modules -prune -o -name '*.js' -print0 | xargs -0 -n 50 runuser -u "$APP_USER" -- node --check )
else
  [ "$BACKEND_CHANGED" = 1 ] && log "no backend in this release: reusing the live one"
  BACKEND_CHANGED=0
  runuser -u "$APP_USER" -- cp -a "$PREV/backend" "$REL/backend"
fi
# Which backend source this release runs (git tree id), to spot "unchanged".
if [ -n "$BACKEND_TREE" ] && { [ "$BACKEND_CHANGED" = 1 ] || [ -f "$IN/backend.tgz" ]; }; then
  printf '%s' "$BACKEND_TREE" | runuser -u "$APP_USER" -- tee "$REL/.backend-tree" >/dev/null
elif [ -f "$PREV/.backend-tree" ] && [ ! -f "$IN/backend.tgz" ]; then
  runuser -u "$APP_USER" -- cp "$PREV/.backend-tree" "$REL/.backend-tree"
fi

# ---- frontend -------------------------------------------------------------
install -d -o "$APP_USER" -g "$APP_USER" "$REL/frontend"
if [ -f "$IN/frontend.tgz" ]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$REL/frontend/dist"
  runuser -u "$APP_USER" -- tar -xzf - -C "$REL/frontend/dist" --no-same-owner --no-same-permissions < "$IN/frontend.tgz"
  [ -f "$REL/frontend/dist/index.html" ] || die "frontend.tgz has no index.html"
  # Keep the previous build's hashed assets, so a tab still open on the old
  # version can load its lazy chunks after the switch.
  # Only files from the last 14 days, so old chunks don't pile up forever.
  if [ -d "$PREV/frontend/dist/assets" ] && [ -d "$REL/frontend/dist/assets" ]; then
    find "$PREV/frontend/dist/assets" -maxdepth 1 -type f -mtime -14 -exec runuser -u "$APP_USER" -- cp -an -t "$REL/frontend/dist/assets/" {} + 2>/dev/null || true
  fi
else
  log "no frontend in this release: reusing the live one"
  runuser -u "$APP_USER" -- cp -a "$PREV/frontend/dist" "$REL/frontend/dist"
fi

{
  echo "RELEASE_ID=$RELEASE_ID"
  echo "GIT_SHA=$GIT_SHA"
  echo "DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} | runuser -u "$APP_USER" -- tee "$REL/RELEASE" >/dev/null
# Everything in $REL was written by the app user (root never writes files
# inside folders the app user controls).

# ---- switch ---------------------------------------------------------------
switch_to() {
  ln -sfn "$1" "$CRM_ROOT/current.new"
  mv -Tf "$CRM_ROOT/current.new" "$CRM_ROOT/current"
}
healthy() {
  local i code
  for ((i = 0; i < HEALTH_WAIT; i++)); do
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || true)"
    [ "$code" = 200 ] && return 0
    sleep 1
  done
  return 1
}
site_ok() {
  [ -z "$PUBLIC_URL" ] && return 0
  curl -s -m 10 "$PUBLIC_URL" | grep -q '<div id="root"'
}

trap - ERR
switch_to "$REL"
log "switched to $RELEASE_ID"
if [ "$BACKEND_CHANGED" = 1 ]; then
  systemctl restart "$SERVICE"
fi
if healthy && site_ok; then
  log "healthy"
else
  log "health check FAILED: rolling back to $(basename "$PREV")"
  journalctl -u "$SERVICE" -n 30 --no-pager -o cat 2>/dev/null | tail -30 || true
  switch_to "$PREV"
  [ "$BACKEND_CHANGED" = 1 ] && systemctl restart "$SERVICE"
  if healthy; then log "rolled back; the previous release is live"; else log "WARNING: previous release is not healthy either"; fi
  mv -- "$REL" "$CRM_ROOT/releases/failed-$RELEASE_ID" 2>/dev/null || true
  exit 1
fi

# ---- tidy -----------------------------------------------------------------
cd "$CRM_ROOT/releases"
LIVE="$(basename "$(readlink -f "$CRM_ROOT/current")")"
# Newest first; keep KEEP releases (the live one always stays).
{ ls -1t | grep -v '^failed-' | grep -vx "$LIVE" || true; } | tail -n +"$KEEP" | while read -r old; do rm -rf -- "$old"; done
{ ls -1t | grep '^failed-' || true; } | tail -n +4 | while read -r old; do rm -rf -- "$old"; done
[ "$IN" != "/" ] && case "$IN" in "$INCOMING_ROOT"/*|/tmp/crm-deploy-*) rm -rf -- "$IN" ;; esac
log "done: $RELEASE_ID is live"
