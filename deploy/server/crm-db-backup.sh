#!/bin/bash
# Nightly logical backup of the CRM database (Supabase Postgres, public schema).
# Installed as /usr/local/sbin/crm-db-backup, run by crm-db-backup.timer.
#
#   /opt/crm/backups/crm-<UTC time>.dump   pg_dump custom format, root-only
#   kept KEEP_DAYS days (default 14)
#
# Restore into a database (careful: overwrites the tables it contains):
#   pg_restore --clean --if-exists --no-owner --no-privileges -d "<DATABASE_URL>" /opt/crm/backups/crm-....dump
#
# Tokens in the dump are encrypted with TOKEN_ENC_KEY from /opt/crm/shared/.env;
# keep a copy of that key somewhere safe too, or the dump's tokens can't be read.
set -euo pipefail
umask 077

ENV_FILE="${ENV_FILE:-/opt/crm/shared/.env}"
DIR="${BACKUP_DIR:-/opt/crm/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$DIR"
chmod 700 "$DIR"

URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
[ -n "$URL" ] || { echo "DATABASE_URL not found in $ENV_FILE" >&2; exit 1; }

# Split the URL into libpq environment variables so the password never
# appears on a command line (visible in ps).
eval "$(URL="$URL" node -e '
  const u = new URL(process.env.URL);
  const q = (s) => "\x27" + String(s).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
  console.log(`export PGHOST=${q(u.hostname)} PGPORT=${q(u.port || 5432)} PGUSER=${q(decodeURIComponent(u.username))} PGPASSWORD=${q(decodeURIComponent(u.password))} PGDATABASE=${q(u.pathname.slice(1) || "postgres")} PGSSLMODE=require`);
')"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DIR/crm-$TS.dump"
pg_dump --schema=public --no-owner --no-privileges -Fc -f "$OUT.partial"
mv "$OUT.partial" "$OUT"
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"

find "$DIR" -maxdepth 1 -name 'crm-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$DIR" -maxdepth 1 -name '*.partial' -mmin +360 -delete
