#!/usr/bin/env bash
# Serve the CRM on kapsosolutions.com (and www → apex) next to the existing
# 139-84-141-28.sslip.io address, which keeps its own certificate and keeps
# working (Meta webhooks and published flow endpoints still point at it).
#
#   1. moves the app's shared nginx settings into snippets/crm-app.conf
#      (the sslip.io site then just includes it; behaviour unchanged);
#   2. adds an HTTP block for the new names that answers Let's Encrypt
#      challenges and redirects everything else to https;
#   3. gets one certificate for kapsosolutions.com + www (webroot, so renewals
#      never touch the config);
#   4. adds the https blocks: apex = the app, www = 301 to apex.
# Backs up the current config first and restores it if nginx -t fails.
set -euo pipefail

DOMAIN=kapsosolutions.com
WWW=www.kapsosolutions.com
SITES=/etc/nginx/sites-available
SNIP=/etc/nginx/snippets
ACME=/var/www/letsencrypt
STAMP=$(date +%Y%m%d-%H%M%S)

cp -a "$SITES/crm" "/root/crm.nginx.backup-$STAMP"
[ -f "$SITES/kapso" ] && cp -a "$SITES/kapso" "/root/kapso.nginx.backup-$STAMP"
mkdir -p "$ACME"

restore() {
  echo "nginx -t failed: restoring the previous config" >&2
  cp -a "/root/crm.nginx.backup-$STAMP" "$SITES/crm"
  rm -f /etc/nginx/sites-enabled/kapso
  if [ -f "/root/kapso.nginx.backup-$STAMP" ]; then
    cp -a "/root/kapso.nginx.backup-$STAMP" "$SITES/kapso"
    ln -sf "$SITES/kapso" /etc/nginx/sites-enabled/kapso
  fi
  nginx -t && systemctl reload nginx
  exit 1
}

# ---------------------------------------------------------------- 1. shared app settings
cat > "$SNIP/crm-app.conf" <<'EOF'
# The CRM app: static frontend (Vite build) + API / Socket.IO proxied to the
# Node backend on 127.0.0.1:5055. Included by every https server name.
root /opt/crm/frontend/dist;
index index.html;
# Media uploads (16 MB per file, several per request) and Meta webhooks.
client_max_body_size 100m;
gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/plain text/css application/javascript application/json image/svg+xml application/xml;
# Security headers (HSTS, nosniff, frame and referrer rules) on every response.
include /etc/nginx/snippets/crm-security-headers.conf;
# Ad videos up to 250 MB (plus multipart overhead); the backend answers once the file is on disk.
location = /api/ads/meta/create/videos {
    client_max_body_size 260m;
    proxy_pass http://127.0.0.1:5055;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    proxy_send_timeout 300s;
}
location /api/ {
    proxy_pass http://127.0.0.1:5055;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
location /socket.io/ {
    proxy_pass http://127.0.0.1:5055;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
# Hashed build assets never change: cache for a year.
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    include /etc/nginx/snippets/crm-security-headers.conf;
    try_files $uri =404;
}
# The app shell must always be fresh so a new deploy is picked up.
location = /index.html {
    add_header Cache-Control "no-cache";
    include /etc/nginx/snippets/crm-security-headers.conf;
    include /etc/nginx/snippets/crm-csp.conf;
}
location / {
    try_files $uri $uri/ /index.html;
}
EOF

# The sslip.io site, same certificate lines certbot wrote.
cat > "$SITES/crm" <<'EOF'
# WhatsApp CRM on 139-84-141-28.sslip.io. The app itself is in
# snippets/crm-app.conf (shared with kapsosolutions.com, see sites-available/kapso).
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    server_name 139-84-141-28.sslip.io;
    include /etc/nginx/snippets/crm-app.conf;
    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/139-84-141-28.sslip.io/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/139-84-141-28.sslip.io/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    if ($host = 139-84-141-28.sslip.io) {
        return 301 https://$host$request_uri;
    } # managed by Certbot
    listen 80;
    listen [::]:80;
    server_name 139-84-141-28.sslip.io;
    return 404; # managed by Certbot
}
EOF

# ---------------------------------------------------------------- 2. http for the new names
http_block() {
cat <<EOF
# kapsosolutions.com: http → https, and Let's Encrypt challenges (webroot).
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN $WWW;
    location /.well-known/acme-challenge/ {
        root $ACME;
    }
    location / {
        return 301 https://$DOMAIN\$request_uri;
    }
}
EOF
}
http_block > "$SITES/kapso"
ln -sf "$SITES/kapso" /etc/nginx/sites-enabled/kapso
nginx -t || restore
systemctl reload nginx

# ---------------------------------------------------------------- 3. certificate
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot certonly --webroot -w "$ACME" -d "$DOMAIN" -d "$WWW" --cert-name "$DOMAIN" \
    --non-interactive --agree-tos --keep-until-expiring --deploy-hook "systemctl reload nginx"
fi

# ---------------------------------------------------------------- 4. https blocks
{
http_block
cat <<EOF

# The app on the main domain.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    include /etc/nginx/snippets/crm-app.conf;
}

# www → the main domain.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $WWW;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    include /etc/nginx/snippets/crm-security-headers.conf;
    return 301 https://$DOMAIN\$request_uri;
}
EOF
} > "$SITES/kapso"
nginx -t || restore
systemctl reload nginx
echo "DONE: https://$DOMAIN is served; backups in /root/*.nginx.backup-$STAMP"
