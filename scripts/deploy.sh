#!/usr/bin/env bash
# Production deploy on the EC2 server (run by GitHub Actions over SSH, or by hand).
# Pulls main, updates backend deps (only when the lockfile changed), restarts pm2,
# and swaps in the frontend that GitHub Actions already built.
#
# The frontend is NEVER built here: the t3.micro (1 GB RAM) freezes during
# `npm ci` / `vite build`. CI uploads a ready dist tarball; pass its path as DIST_TGZ.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/driveflow-dashboard}"
PM2_APP="${PM2_APP:-carzzi-backend}"
DIST_TGZ="${DIST_TGZ:-}"

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
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ] || [ "$(cat .deploy-lock-hash 2>/dev/null)" != "$LOCK_HASH" ]; then
  npm ci --omit=dev --no-audit --no-fund
  echo "$LOCK_HASH" > .deploy-lock-hash
else
  echo "    dependencies unchanged, skipping npm ci"
fi
pm2 restart "$PM2_APP" --update-env
pm2 save >/dev/null

echo "==> Frontend"
cd "$APP_DIR/frontend"
if [ -n "$DIST_TGZ" ] && [ -f "$DIST_TGZ" ]; then
  rm -rf dist.new dist.old
  mkdir dist.new
  tar -xzf "$DIST_TGZ" -C dist.new
  [ -f dist.new/index.html ] || { echo "    prebuilt dist has no index.html, keeping current site"; rm -rf dist.new; exit 1; }
  [ -d dist ] && mv dist dist.old
  mv dist.new dist          # near-instant swap; nginx serves frontend/dist
  rm -rf dist.old
  rm -f "$DIST_TGZ"
  echo "    new frontend live"
else
  echo "    no prebuilt frontend given (DIST_TGZ), keeping current site"
fi

echo "==> Deployed $(git -C "$APP_DIR" log --oneline -1)"
