#!/usr/bin/env bash
# Production deploy on the EC2 server (run by GitHub Actions over SSH, or by hand).
# Pulls main, installs backend deps, restarts pm2, rebuilds the frontend nginx serves.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/driveflow-dashboard}"
PM2_APP="${PM2_APP:-carzzi-backend}"

# Non-interactive SSH shells don't load nvm, so node/npm/pm2 may be missing from PATH.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$APP_DIR"
echo "==> Pulling main"
git fetch origin main
git checkout main
git pull --ff-only origin main
echo "    now at $(git log --oneline -1)"

echo "==> Backend"
cd "$APP_DIR/backend"
npm ci --omit=dev --no-audit --no-fund
pm2 restart "$PM2_APP" --update-env
pm2 save >/dev/null

echo "==> Frontend"
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund
npm run build

echo "==> Deployed $(git -C "$APP_DIR" log --oneline -1)"
