#!/usr/bin/env bash
# Exercises deploy-release.sh / rollback-release.sh against a throwaway app
# (its own folder, systemd unit and port), never the real CRM. Run as root:
#   bash selftest.sh /path/to/deploy-release.sh /path/to/rollback-release.sh
set -uo pipefail
DEPLOY="$1"; ROLLBACK="$2"
export CRM_ROOT=/opt/crm-selftest SERVICE=crm-selftest HEALTH_URL=http://127.0.0.1:5099/api/health PUBLIC_URL= HEALTH_WAIT=8 KEEP=3 INCOMING_ROOT=/tmp/crm-deploy-selftest LOCK_FILE=/run/crm-deploy-selftest.lock
pass=0; fail=0
ok() { if eval "$2"; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1"; fail=$((fail+1)); fi; }
live() { basename "$(readlink -f $CRM_ROOT/current)"; }
pid() { systemctl show -p MainPID --value $SERVICE; }

cleanup() {
  systemctl stop $SERVICE 2>/dev/null; systemctl disable $SERVICE 2>/dev/null
  rm -f /etc/systemd/system/$SERVICE.service; systemctl daemon-reload
  rm -rf $CRM_ROOT /tmp/crm-deploy-selftest*
}
cleanup

# A tiny app: /api/health answers 200 and reports its version.
mkapp() { # dir version [broken|syntax]
  mkdir -p "$1"
  cat > "$1/package.json" <<EOF
{ "name": "selftest", "version": "1.0.0", "private": true, "type": "module" }
EOF
  cat > "$1/package-lock.json" <<EOF
{ "name": "selftest", "version": "1.0.0", "lockfileVersion": 3, "requires": true, "packages": { "": { "name": "selftest", "version": "1.0.0" } } }
EOF
  local pre=""
  [ "${3:-}" = broken ] && pre="process.exit(1);"
  [ "${3:-}" = syntax ] && pre="this is not javascript ("
  cat > "$1/server.js" <<EOF
$pre
import http from 'node:http';
import fs from 'node:fs';
const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').trim() : 'no-env';
http.createServer((q, s) => { s.writeHead(q.url === '/api/health' ? 200 : 404); s.end('$2 ' + env); }).listen(5099, '127.0.0.1');
EOF
}
pack() { # id version [broken|syntax] [tree] [parts]
  local d=/tmp/crm-deploy-selftest/$1; mkdir -p $d/b $d/f; chmod 700 /tmp/crm-deploy-selftest
  mkapp $d/b "$2" "${3:-}"
  echo "<html><div id=\"root\"></div>$2</html>" > $d/f/index.html; mkdir -p $d/f/assets; echo "$2" > $d/f/assets/app-$2.js
  case "${5:-bf}" in *b*) tar -czf $d/backend.tgz -C $d/b . ;; esac
  case "${5:-bf}" in *f*) tar -czf $d/frontend.tgz -C $d/f . ;; esac
  rm -rf $d/b $d/f
  printf 'RELEASE_ID=%s\nGIT_SHA=abc%s\nBACKEND_TREE=%s\n' "$1" "$2" "${4:-tree-$2}" > $d/release.env
  echo $d
}

# ---- initial release, by hand (as setup-releases.sh does) ----
install -d -o crm -g crm $CRM_ROOT/shared/keys $CRM_ROOT/releases/r0/frontend/dist
echo "SECRET=shared" > $CRM_ROOT/shared/.env; chown crm:crm $CRM_ROOT/shared/.env
mkapp $CRM_ROOT/releases/r0/backend v0
ln -s $CRM_ROOT/shared/.env $CRM_ROOT/releases/r0/backend/.env; ln -s $CRM_ROOT/shared/keys $CRM_ROOT/releases/r0/backend/keys
echo '<div id="root"></div>' > $CRM_ROOT/releases/r0/frontend/dist/index.html
chown -R crm:crm $CRM_ROOT/releases
ln -sfn $CRM_ROOT/releases/r0 $CRM_ROOT/current; ln -sfn current/backend $CRM_ROOT/backend
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Service]
User=crm
WorkingDirectory=$CRM_ROOT/backend
ExecStart=/usr/local/bin/node server.js
Restart=no
EOF
systemctl daemon-reload; systemctl start $SERVICE; sleep 1
ok "initial app is up" '[ "$(curl -s $HEALTH_URL)" = "v0 SECRET=shared" ]'

# 1. good backend + frontend
bash "$DEPLOY" "$(pack rel-001 v1)" >/tmp/st.log 2>&1; rc=$?
ok "deploy v1: exit 0, live, new code, shared .env" '[ $rc = 0 ] && [ "$(live)" = rel-001 ] && [ "$(curl -s $HEALTH_URL)" = "v1 SECRET=shared" ]'
ok "v1 has .env/keys as links to shared" '[ "$(readlink $CRM_ROOT/releases/rel-001/backend/.env)" = "$CRM_ROOT/shared/.env" ] && [ -L $CRM_ROOT/releases/rel-001/backend/keys ]'
ok "v1 files owned by the app user" '[ "$(stat -c %U $CRM_ROOT/releases/rel-001/backend/server.js)" = crm ]'
P1=$(pid)

# 2. frontend only → backend not restarted
bash "$DEPLOY" "$(pack rel-002 v2 '' tree-v1 f)" >>/tmp/st.log 2>&1; rc=$?
ok "frontend-only deploy: live, backend NOT restarted, old assets kept" '[ $rc = 0 ] && [ "$(live)" = rel-002 ] && [ "$(pid)" = "$P1" ] && grep -q v2 $CRM_ROOT/current/frontend/dist/index.html && [ -f $CRM_ROOT/current/frontend/dist/assets/app-v1.js ]'

# 3. same backend tree → no restart
bash "$DEPLOY" "$(pack rel-003 v3 '' tree-v1)" >>/tmp/st.log 2>&1; rc=$?
ok "unchanged backend tree: no restart, still v1 code" '[ $rc = 0 ] && [ "$(pid)" = "$P1" ] && [ "$(curl -s $HEALTH_URL)" = "v1 SECRET=shared" ]'

# 4. backend that crashes on start → automatic rollback
bash "$DEPLOY" "$(pack rel-004 v4 broken)" >>/tmp/st.log 2>&1; rc=$?
ok "crashing release: exit 1, rolled back to rel-003, app healthy" '[ $rc = 1 ] && [ "$(live)" = rel-003 ] && [ "$(curl -s $HEALTH_URL)" = "v1 SECRET=shared" ] && [ -d $CRM_ROOT/releases/failed-rel-004 ]'

# 5. syntax error → refused before switching
P5=$(pid)
bash "$DEPLOY" "$(pack rel-005 v5 syntax)" >>/tmp/st.log 2>&1; rc=$?
ok "syntax error: refused, nothing switched or restarted, folder removed" '[ $rc != 0 ] && [ "$(live)" = rel-003 ] && [ "$(pid)" = "$P5" ] && [ ! -d $CRM_ROOT/releases/rel-005 ]'

# 6. bad inputs
d=$(pack rel-006 v6); sed -i 's/RELEASE_ID=.*/RELEASE_ID=..\/..\/etc/' $d/release.env
bash "$DEPLOY" "$d" >>/tmp/st.log 2>&1; rc=$?
ok "bad RELEASE_ID refused" '[ $rc != 0 ] && [ "$(live)" = rel-003 ]'
mkdir -p /var/tmp/elsewhere; cp $d/release.env /var/tmp/elsewhere/
bash "$DEPLOY" /var/tmp/elsewhere >>/tmp/st.log 2>&1; rc=$?
ok "incoming dir outside the upload folder refused" '[ $rc != 0 ]'; rm -rf /var/tmp/elsewhere
d=$(pack rel-001 v1x)
bash "$DEPLOY" "$d" >>/tmp/st.log 2>&1; rc=$?
ok "an existing release id is refused" '[ $rc != 0 ] && [ "$(live)" = rel-003 ]'

# 7. lock
exec 8>$LOCK_FILE; flock 8
bash "$DEPLOY" "$(pack rel-007 v7)" >>/tmp/st.log 2>&1; rc=$?
flock -u 8; exec 8>&-
ok "second deploy while one runs is refused" '[ $rc != 0 ] && [ "$(live)" = rel-003 ]'

# 8. more good deploys → old ones pruned (KEEP=3)
for n in 8 9; do bash "$DEPLOY" "$(pack rel-00$n v$n)" >>/tmp/st.log 2>&1; done
ok "after v9: live, only 3 releases kept + failed" '[ "$(live)" = rel-009 ] && [ "$(ls $CRM_ROOT/releases | grep -vc failed-)" = 3 ]'

# 9. rollback script
bash "$ROLLBACK" >>/tmp/st.log 2>&1; rc=$?
ok "rollback-release.sh → previous release, healthy" '[ $rc = 0 ] && [ "$(live)" = rel-008 ] && [ "$(curl -s $HEALTH_URL)" = "v8 SECRET=shared" ]'
bash "$ROLLBACK" --list >>/tmp/st.log 2>&1
ok "rollback --list works" 'grep -q "^\* rel-008" /tmp/st.log'
ok "shared .env untouched by everything" '[ "$(cat $CRM_ROOT/shared/.env)" = "SECRET=shared" ]'

echo "--- log tail"; tail -n 12 /tmp/st.log
[ $fail = 0 ] || { echo "--- log head"; head -n 40 /tmp/st.log; }
cleanup; rm -f /tmp/st.log
echo "SELFTEST: $pass passed, $fail failed"
[ $fail = 0 ]
