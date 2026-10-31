# Manual deploy to the Vultr server (139.84.141.28), as a fallback to the
# GitHub Actions pipeline (.github/workflows/deploy.yml). Both install a new
# release through the same server script (crm-deploy-release), which switches
# to it only after checks pass and rolls back on a failed health check.
#
#   pwsh deploy/deploy.ps1                   # backend + frontend
#   pwsh deploy/deploy.ps1 -Only backend     # frontend copied from the live release
#   pwsh deploy/deploy.ps1 -Only frontend    # backend not restarted
#   pwsh deploy/deploy.ps1 -Rollback         # back to the previous release
#
# Uses the SSH key ~/.ssh/vultr_crm. The server keeps its own .env in
# /opt/crm/shared/.env (PUBLIC_BASE_URL=https://kapsosolutions.com): it is
# never touched from here. Edit it on the server, then
# `systemctl restart crm-backend`.
param(
  [ValidateSet('all', 'backend', 'frontend')][string]$Only = 'all',
  [switch]$Rollback
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$key = "$env:USERPROFILE\.ssh\vultr_crm"
$host_ = 'root@139.84.141.28'
$ssh = @('-i', $key, '-o', 'BatchMode=yes')

if ($Rollback) {
  ssh -n @ssh $host_ 'crm-rollback-release'
  exit $LASTEXITCODE
}

$tmp = Join-Path $env:TEMP 'crm-deploy'
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null

# Release id: time + git commit when there is one (+ "-dirty" for local changes).
$sha = ''
try { $sha = (git -C $root rev-parse --short=12 HEAD 2>$null) } catch { }
$dirty = ''
if ($sha) { if (git -C $root status --porcelain 2>$null) { $dirty = '-dirty' } }
$id = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '-manual' + $(if ($sha) { "-$sha$dirty" } else { '' })

if ($Only -in 'all', 'frontend') {
  Write-Host 'Building frontend…'
  Push-Location "$root\frontend"
  try {
    npx tsc --noEmit -p .; if ($LASTEXITCODE) { throw 'tsc failed' }
    npx vite build; if ($LASTEXITCODE) { throw 'vite build failed' }
  } finally { Pop-Location }
  tar.exe -czf "$tmp\frontend.tgz" -C "$root\frontend\dist" .
}

if ($Only -in 'all', 'backend') {
  Write-Host 'Packaging backend (no node_modules, .env, keys or logs)…'
  tar.exe -czf "$tmp\backend.tgz" --exclude=node_modules --exclude='*.log' --exclude='.env' --exclude='.env.*' --exclude=keys --exclude='*.pem' -C "$root\backend" .
}

# No BACKEND_TREE for manual deploys: a backend in the upload is always
# installed (and restarts the service); without one the live backend is kept.
[IO.File]::WriteAllText("$tmp\release.env", "RELEASE_ID=$id`nGIT_SHA=$sha$dirty`n")

$remote = "/root/crm-deploy-$id"
Write-Host "Uploading release $id…"
ssh -n @ssh $host_ "mkdir -p '$remote'"
$files = Get-ChildItem $tmp -File | ForEach-Object { $_.FullName }
scp @ssh @files "${host_}:$remote/"
Write-Host 'Installing on the server…'
ssh -n @ssh $host_ "crm-deploy-release '$remote'; rc=`$?; rm -rf '$remote'; exit `$rc"
$rc = $LASTEXITCODE

$code = curl.exe -s -o NUL -w '%{http_code}' https://kapsosolutions.com/api/health
Write-Host "Public health check: $code"
if ($rc -ne 0) { Write-Host 'DEPLOY FAILED (the previous release is live)'; exit $rc }
Write-Host "Release $id is live"
