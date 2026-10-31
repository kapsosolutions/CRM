# Deploying Kapso Solutions CRM

Production: **https://kapsosolutions.com**, served by one Vultr server (Bengaluru) with nginx and the
`crm-backend` systemd service. Database: Supabase. Media: Bunny.net.

## How a change reaches production

1. Push or merge to `main`.
2. **CI** (`.github/workflows/ci.yml`) type-checks and builds the frontend, then installs the backend,
   syntax-checks it, loads every module and runs `npm audit`.
3. **Deploy** (`.github/workflows/deploy.yml`) waits for approval on the `production` environment, then:
   - packages exactly the committed backend (`git archive`) and the frontend build CI produced;
   - uploads them as the restricted `deploy` user;
   - runs `crm-deploy-release` on the server.
4. `crm-deploy-release` installs the release in its own folder next to the live one:
   - runs `npm ci` and a syntax check;
   - switches to the new folder and restarts the backend only if the backend changed;
   - checks `/api/health` and the website, and **switches back by itself** if either fails.

Checks run on every branch and pull request. Only `main` deploys.

## Server layout

```
/opt/crm/shared/.env           secrets (never in git, never in a release)
/opt/crm/shared/keys/          WhatsApp Flows keypair
/opt/crm/releases/<id>/        one folder per release (the last 5 are kept)
/opt/crm/current -> releases/<id>
/opt/crm/backend -> current/backend     systemd WorkingDirectory
/opt/crm/frontend -> current/frontend   nginx root (frontend/dist)
/usr/local/sbin/crm-deploy-release      install + switch + auto-rollback
/usr/local/sbin/crm-rollback-release    manual rollback
```

To change a secret, edit `/opt/crm/shared/.env` on the server, then run `systemctl restart crm-backend`.

## Rollback

- From your PC: `pwsh deploy/deploy.ps1 -Rollback`. This switches to the previous release.
- On the server: `crm-rollback-release --list`, then `crm-rollback-release <id>`.

## Manual deploy (fallback)

`pwsh deploy/deploy.ps1` deploys everything. Use `-Only backend` or `-Only frontend` to deploy one part.

It uses the same server script, so the checks and the automatic rollback are the same.

## One-time GitHub setup

All of these are under the repo's **Settings**.

1. **Secrets and variables → Actions → Secrets:**
   - `DEPLOY_SSH_KEY`: the private key for the `deploy` user (`~/.ssh/kapso_github_deploy` on the admin PC).
   - `DEPLOY_KNOWN_HOSTS`: the server's pinned host key line (`~/.ssh/kapso_github_known_hosts.txt`).
2. **Environments → New environment `production`:**
   - add yourself under **Required reviewers**;
   - under **Deployment branches**, choose *Selected branches* and allow only `main`.
3. **Secrets and variables → Actions → Variables:** set `DEPLOY_ENABLED` to `true`. Until it is set, Deploy is skipped.
4. **Branches → Add rule for `main`:**
   - require a pull request;
   - require the CI checks `Frontend · type-check + build` and `Backend · install + syntax check`.

## Files here

- `server/deploy-release.sh`: installed as `/usr/local/sbin/crm-deploy-release`.
- `server/rollback-release.sh`: installed as `/usr/local/sbin/crm-rollback-release`.
- `server/setup-releases.sh`: one-time migration to the release layout and the `deploy` user. Already done.
- `server/selftest.sh`: tests the two scripts against a throwaway app. It never touches production:

  ```
  bash selftest.sh deploy-release.sh rollback-release.sh
  ```
- `nginx/`: security headers, CSP and the domain setup.
