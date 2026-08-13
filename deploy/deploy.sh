#!/usr/bin/env bash
#
# The one-command update. Run on the Pi, or from anywhere:
#   ssh pi@<pi-host> pr-arcade/deploy/deploy.sh
#
# Assumes passwordless sudo for the pi user (the stock Pi OS default).

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BEFORE="$(git rev-parse HEAD)"
if ! git pull --ff-only; then
  echo >&2
  echo "==> git pull --ff-only failed. Usually one of:" >&2
  echo "    • local edits (config.json is the usual culprit): git stash, deploy, git stash pop" >&2
  echo "    • the branch diverged: git status, then sort it out by hand" >&2
  echo "    • no credentials for a private repo: gh auth setup-git, or use a deploy key" >&2
  exit 1
fi

if ! git diff --quiet "$BEFORE" HEAD -- package.json package-lock.json; then
  echo "==> dependencies changed, reinstalling"
  # NOT --omit=dev: `npm start` runs the server through tsx, which lives in
  # devDependencies. Switch to `npm ci --omit=dev` if that ever stops being true.
  npm ci
fi

echo "==> restarting server"
# The pull may have changed the unit files; without this, systemd keeps running
# the old ones and the deploy silently does nothing.
sudo systemctl daemon-reload
sudo systemctl restart pr-arcade.service

echo "==> restarting kiosk (picks up client changes)"
systemctl --user restart pr-arcade-kiosk.service 2>/dev/null ||
  echo "    (no user session here — restart it on the Pi or reboot to refresh the TV)"

if systemctl is-active --quiet pr-arcade.service; then
  echo "==> server is up"
else
  echo "==> server FAILED, see: journalctl -u pr-arcade -n 50" >&2
  exit 1
fi
