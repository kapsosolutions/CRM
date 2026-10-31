#!/usr/bin/env bash
# One-time: move the live CRM to the release layout used by deploy-release.sh,
# and create the `deploy` user GitHub Actions logs in as. Safe to re-run.
#
#   setup-releases.sh <path-to-deploy-public-key>
#
# Before:  /opt/crm/backend (dir, with .env, keys/, node_modules)
#          /opt/crm/frontend/dist (dir)
# After:   /opt/crm/shared/{.env,keys}
#          /opt/crm/releases/initial-<date>/{backend,frontend/dist}
#          /opt/crm/current  -> releases/initial-<date>
#          /opt/crm/backend  -> current/backend      (systemd unchanged)
#          /opt/crm/frontend -> current/frontend     (nginx unchanged)
# The old folders are kept as /opt/crm/backend.pre-releases and
# /opt/crm/frontend.pre-releases until you delete them.
set -Eeuo pipefail
CRM_ROOT=/opt/crm
APP_USER=crm
PUBKEY_FILE="${1:-}"
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }

# ---- scripts --------------------------------------------------------------
# Root-owned location: the app user owns /opt/crm, so scripts that sudo runs
# must not live there.
install -m 755 -o root -g root /tmp/crm-setup/deploy-release.sh /usr/local/sbin/crm-deploy-release
install -m 755 -o root -g root /tmp/crm-setup/rollback-release.sh /usr/local/sbin/crm-rollback-release
rm -rf -- "$CRM_ROOT/bin"

# ---- layout ---------------------------------------------------------------
if [ ! -L "$CRM_ROOT/backend" ]; then
  ID="initial-$(date +%Y%m%d-%H%M%S)"
  REL="$CRM_ROOT/releases/$ID"
  echo "migrating live files to $REL"
  install -d -o "$APP_USER" -g "$APP_USER" "$CRM_ROOT/shared" "$CRM_ROOT/releases" "$REL" "$REL/frontend"
  [ -e "$CRM_ROOT/shared/.env" ] || cp -a "$CRM_ROOT/backend/.env" "$CRM_ROOT/shared/.env"
  [ -e "$CRM_ROOT/shared/keys" ] || cp -a "$CRM_ROOT/backend/keys" "$CRM_ROOT/shared/keys"
  chmod 600 "$CRM_ROOT/shared/.env"
  cp -a "$CRM_ROOT/backend" "$REL/backend"
  rm -rf -- "$REL/backend/.env" "$REL/backend/keys" "$REL/backend/.env.backup-"*
  ln -s "$CRM_ROOT/shared/.env" "$REL/backend/.env"
  ln -s "$CRM_ROOT/shared/keys" "$REL/backend/keys"
  cp -a "$CRM_ROOT/frontend/dist" "$REL/frontend/dist"
  printf 'RELEASE_ID=%s\nGIT_SHA=\nDEPLOYED_AT=%s\n' "$ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$REL/RELEASE"
  chown -R "$APP_USER:$APP_USER" "$REL"
  ln -sfn "$REL" "$CRM_ROOT/current"
  # Swap the real folders for links (nginx keeps serving; the backend process
  # keeps running from the old folder until the restart below).
  mv "$CRM_ROOT/backend" "$CRM_ROOT/backend.pre-releases"
  ln -sfn current/backend "$CRM_ROOT/backend"
  mv "$CRM_ROOT/frontend" "$CRM_ROOT/frontend.pre-releases"
  ln -sfn current/frontend "$CRM_ROOT/frontend"
  chown -h "$APP_USER:$APP_USER" "$CRM_ROOT/current" "$CRM_ROOT/backend" "$CRM_ROOT/frontend"
  MIGRATED=1
else
  echo "already on the release layout"
  MIGRATED=0
fi

# ---- systemd: the app may write only its shared .env / keys ----------------
UNIT=/etc/systemd/system/crm-backend.service
if grep -q '^ReadWritePaths=/opt/crm/backend$' "$UNIT"; then
  cp -a "$UNIT" "/root/crm-backend.service.before-releases"
  sed -i 's#^ReadWritePaths=/opt/crm/backend$#ReadWritePaths=/opt/crm/shared#' "$UNIT"
  systemctl daemon-reload
fi
if [ "$MIGRATED" = 1 ]; then
  systemctl restart crm-backend
  for i in $(seq 1 45); do
    [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:5055/api/health || true)" = 200 ] && break
    sleep 1
  done
  [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:5055/api/health || true)" = 200 ] \
    || { echo "backend NOT healthy after migration"; exit 1; }
  echo "backend healthy from $(readlink -f $CRM_ROOT/backend)"
fi

# ---- deploy user (GitHub Actions) ------------------------------------------
if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash deploy
  passwd -l deploy >/dev/null
fi
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh /home/deploy/incoming
if [ -n "$PUBKEY_FILE" ] && [ -f "$PUBKEY_FILE" ]; then
  # Key-only login, no forwarding/tunnels/terminal tricks.
  KEY="$(tr -d '\r\n' < "$PUBKEY_FILE")"
  echo "restrict $KEY" > /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys
  chmod 600 /home/deploy/.ssh/authorized_keys
fi
# sudo: only the two release scripts, nothing else. (This sudo doesn't allow
# wildcards in arguments; deploy-release.sh itself only accepts folders under
# /home/deploy/incoming when run through sudo.) Written to a temp file and
# checked first, so a bad rule never lands in sudoers.d.
TMP_SUDO="$(mktemp)"
cat > "$TMP_SUDO" <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/local/sbin/crm-deploy-release, /usr/local/sbin/crm-rollback-release
EOF
visudo -cf "$TMP_SUDO" >/dev/null
install -m 440 -o root -g root "$TMP_SUDO" /etc/sudoers.d/crm-deploy
rm -f "$TMP_SUDO"
echo "setup done"
