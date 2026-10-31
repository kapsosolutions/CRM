#!/usr/bin/env bash
# Installs the security-header snippets (shared by kapsosolutions.com and
# 139-84-141-28.sslip.io through snippets/crm-app.conf). The site files
# themselves are set up by add-domain.sh and are not touched here. Backs up
# the snippets first; if `nginx -t` fails, puts them back and nginx keeps
# running the old config.
#   Files expected in /tmp: crm-security-headers.conf, crm-csp.conf
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
SNIP=/etc/nginx/snippets

for f in crm-security-headers.conf crm-csp.conf; do
  [ -f "$SNIP/$f" ] && cp -p "$SNIP/$f" "/root/$f.backup-$STAMP"
done
echo "backups: /root/crm-*.conf.backup-$STAMP"

install -m 644 /tmp/crm-security-headers.conf "$SNIP/crm-security-headers.conf"
install -m 644 /tmp/crm-csp.conf "$SNIP/crm-csp.conf"

if nginx -t; then
  systemctl reload nginx
  echo "RELOADED with security headers"
else
  echo "nginx -t FAILED: restoring the previous snippets"
  for f in crm-security-headers.conf crm-csp.conf; do
    [ -f "/root/$f.backup-$STAMP" ] && cp -p "/root/$f.backup-$STAMP" "$SNIP/$f"
  done
  nginx -t && systemctl reload nginx
  exit 1
fi
