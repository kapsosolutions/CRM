#!/usr/bin/env bash
# Switch back to an earlier release (default: the one before the live one).
#   rollback-release.sh            → previous release
#   rollback-release.sh <id>       → that release
#   rollback-release.sh --list     → list releases, newest first
set -Eeuo pipefail
CRM_ROOT="${CRM_ROOT:-/opt/crm}"
SERVICE="${SERVICE:-crm-backend}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5055/api/health}"
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
cd "$CRM_ROOT/releases"
LIVE="$(basename "$(readlink -f "$CRM_ROOT/current")")"
if [ "${1:-}" = "--list" ]; then
  ls -1t | grep -v '^failed-' | while read -r r; do
    printf '%s %s  %s\n' "$([ "$r" = "$LIVE" ] && echo '*' || echo ' ')" "$r" "$(grep -h '^GIT_SHA=\|^DEPLOYED_AT=' "$r/RELEASE" 2>/dev/null | tr '\n' ' ')"
  done
  exit 0
fi
TARGET="${1:-$(ls -1t | grep -v '^failed-' | grep -vx "$LIVE" | head -1)}"
[[ "$TARGET" =~ ^[A-Za-z0-9._-]+$ ]] && [ -d "$TARGET/backend" ] || { echo "no such release: $TARGET"; exit 1; }
exec 9>"${LOCK_FILE:-/run/crm-deploy.lock}"; flock -n 9 || { echo "a deploy is running"; exit 1; }
echo "rolling back: $LIVE -> $TARGET"
ln -sfn "$CRM_ROOT/releases/$TARGET" "$CRM_ROOT/current.new"
mv -Tf "$CRM_ROOT/current.new" "$CRM_ROOT/current"
systemctl restart "$SERVICE"
for i in $(seq 1 45); do
  [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || true)" = 200 ] && { echo "healthy: $TARGET is live"; exit 0; }
  sleep 1
done
echo "WARNING: $TARGET did not become healthy"; exit 1
