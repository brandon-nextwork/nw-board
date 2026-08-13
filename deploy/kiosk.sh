#!/usr/bin/env bash
#
# Launched by pr-arcade-kiosk.service. Waits for a desktop session and for the
# board to be served, turns off the cursor and screen blanking, then runs
# Chromium fullscreen forever.
#
# The port lives here and in /etc/pr-arcade.env — change both.

set -euo pipefail

URL="http://localhost:3000/"

# Wait for something to draw on: this service can start before the compositor
# after a cold boot. Detected rather than hardcoded in the unit, because the
# wayland socket name varies by session (wayfire, labwc, X-only).
RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DISPLAY="${DISPLAY:-:0}"
for _ in $(seq 1 60); do
  for sock in "$RUNTIME"/wayland-[0-9]*; do
    # -S skips the .lock files sitting next to the socket.
    if [ -S "$sock" ]; then export WAYLAND_DISPLAY="${sock##*/}"; fi
  done
  if [ -n "${WAYLAND_DISPLAY:-}" ] || [ -e /tmp/.X11-unix/X0 ]; then break; fi
  sleep 1
done

# Chromium caches whatever it loads first, so don't start it until the server
# is actually answering — otherwise the TV shows a connection-refused page.
until curl -sfo /dev/null "$URL"; do sleep 2; done

# X11 only (incl. XWayland). On a pure Wayland session this is a no-op and
# blanking is handled by `raspi-config nonint do_blanking 1` instead.
if command -v xset >/dev/null 2>&1; then
  xset s off -dpms s noblank || true
fi

# Hide the mouse pointer. Dies with the service (same cgroup).
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 &
fi

CHROMIUM="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$CHROMIUM" ]; then
  echo "no chromium-browser/chromium on PATH" >&2
  exit 1
fi

# --autoplay-policy is load-bearing: without it Chromium mutes the jingles
# because a display-only page never gets a user gesture.
exec "$CHROMIUM" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=Translate \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  "$URL"
