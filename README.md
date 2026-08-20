# nw-board (PR Arcade)

Arcade-style GitHub activity board for a Raspberry Pi + office TV. A Node
server receives GitHub webhooks for the Tracked Repos in `config.json`,
translates them into celebration/ambient events, and pushes them over a
WebSocket to a PixiJS front end running fullscreen in Chromium.

See `CONTEXT.md` for the domain vocabulary (Celebration Event, MVP, Quiet
Hours, Backfill, …) and `deploy/README.md` for everything Pi-specific.

## Run locally

Requires Node 20+.

```sh
npm ci
GITHUB_WEBHOOK_SECRET=dev npm start   # http://localhost:3000
```

- `GITHUB_WEBHOOK_SECRET` is required — the server refuses to start without it.
- `GITHUB_TOKEN` is optional locally; without it Backfill is skipped and the
  board fills from live webhooks only.
- `PORT` defaults to 3000.
- Real webhook deliveries need a public URL; production uses Tailscale Funnel.
  To fake an event locally, POST a signed payload to `/webhook` (see
  `test/webhook.test.ts` for the signature format).

## Test

```sh
npm test   # vitest, covers webhook handling, backfill, MVP, sound rules
```

## Update the deployed board

```sh
ssh <user>@pr-arcade.local pr-arcade/deploy/deploy.sh
```

Pulls, runs `npm ci` only if the lockfile changed, restarts the server and the
kiosk. Details, first-time setup (blank SD card → TV), and troubleshooting:
`deploy/README.md`.

## Watching webhook deliveries

The server logs one line per accepted delivery saying what became of it —
`recorded`, `repeat, dropped`, `ignored <event>/<action>`, or `untracked repo` —
keyed by the `X-GitHub-Delivery` id so you can match it to GitHub's
"Recent Deliveries" page.

On the Pi:

```sh
journalctl -u pr-arcade -f              # live tail
journalctl -u pr-arcade | grep webhook  # delivery outcomes only
```

Locally the same lines go to stdout of `npm start`.

Note: a green 204 in GitHub's webhook UI isn't proof it was ours —
`projects-app` also has a Discord webhook. Check by the hook's `config.url`,
then confirm the delivery id in the logs.

## Configuration

`config.json` (in git, not secret): Tracked Repos, Quiet Hours, Day Chime
times, and the login → first-name map. The server won't start without it.
Change it in git and deploy — editing it on the Pi makes the next deploy
refuse to fast-forward.

Merge sound: the board plays `public/sounds/another-one.mp3` (the DJ Khaled clip)
on a merge. The file isn't in git — drop it there yourself; without it the board
falls back to the 8-bit fanfare.

Secrets live only in `/etc/pr-arcade.env` on the Pi
(`PORT`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`).
