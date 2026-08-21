# PR Arcade — whimsical GitHub activity display

Status: ready-for-agent

## Problem Statement

Our team's GitHub activity — PRs opened, reviewed, and merged — is invisible unless you go looking for it. There's no shared, ambient sense of what's in flight, and the small wins (a merge, an approval) pass without any moment of celebration. We have a Raspberry Pi 4 and an office TV doing nothing about it.

## Solution

A display-only "PR Arcade" running fullscreen on the TV: a retro-arcade (pixel art, 8-bit) scene fed live by GitHub webhooks from our Tracked Repos. Celebration Events (merges, approvals) trigger big animations and short jingles; Ambient Events flow silently through a Feed of the last 24 hours. A single Team Score accumulates points from Celebration Events and resets weekly. Day Chimes mark the start (09:00) and end (17:00) of the workday. Quiet Hours keep the office sane: sound only on weekdays 09:00–18:00. On boot, Backfill from the GitHub API fills the screen so it never looks broken.

## User Stories

1. As a team member walking past the TV, I want to see currently open PRs in an arcade-styled scene, so that I have ambient awareness of what's in flight without opening GitHub.
2. As a team member, I want a PR merge to trigger a prominent celebration animation, so that shipping feels like an event rather than a silent state change.
3. As a team member, I want a review approval to trigger a celebration animation, so that reviewing work gets visible recognition too.
4. As a team member, I want merges and approvals to play a short 8-bit jingle (under 3 seconds), so that the win is noticeable even when nobody is looking at the screen.
5. As a team member, I want PR opened events to appear as silent animations in the Feed, so that new work entering the queue is visible without being noisy.
6. As a team member, I want PR closed-without-merge events to appear in the Feed, so that abandoned work visibly leaves the board.
7. As a team member, I want changes-requested reviews to appear as silent Ambient Events, so that review pushback is visible without being punished with a sad noise.
8. As a team member, I want PR comments to appear as subtle Ambient Events, so that active discussion shows as liveliness on the board.
9. As a team member, I want the Feed to only show the last 24 hours of events, so that the board always reflects recent activity rather than stale history.
10. As a team member, I want a single shared Team Score that grows with every Celebration Event, so that wins feel collective rather than competitive.
11. As a team member, I want the Team Score to reset weekly, so that each week starts as a fresh game.
12. As a team member, I want a Day Chime at 09:00 on weekdays, so that the workday opens with a fun shared ritual.
13. As a team member, I want a Day Chime at 17:00 on weekdays, so that the end of the workday is marked.
14. As an office occupant, I want all sounds suppressed outside Quiet Hours (weekdays 09:00–18:00), so that the display never makes noise at night or on weekends.
15. As an office occupant, I want sounds kept short and reserved for Celebration Events only, so that the display doesn't become an annoyance that gets muted forever.
16. As the display owner, I want activity limited to a curated list of Tracked Repos, so that noisy or irrelevant repos don't pollute the board.
17. As the display owner, I want the Tracked Repo list in an easily edited config, so that adding or removing a repo doesn't require code changes.
18. As the display owner, I want the display to Backfill open PRs and recent activity on boot, so that a reboot never leaves a blank or misleading screen.
19. As the display owner, I want webhook deliveries verified against a shared secret, so that only GitHub can feed events to the board.
20. As the display owner, I want events from untracked repos or unrecognized actions ignored gracefully, so that misconfigured webhooks can't crash or clutter the display.
21. As the display owner, I want the server to receive webhooks through a stable public HTTPS URL via Tailscale Funnel, so that no domain purchase or cloud relay is needed.
22. As the display owner, I want the browser to reconnect and resync automatically if the WebSocket drops, so that the TV recovers from glitches without a keyboard.
23. As the display owner, I want the whole stack to start automatically when the Pi powers on, so that recovery from a power cut is plug-and-play.
24. As the display owner, I want a deploy script that pulls the latest code and restarts services, so that updating the display is one command over SSH.
25. As the display owner, I want a guided setup walkthrough for the brand-new Pi (OS, Tailscale, kiosk, webhook registration), so that I can get from blank SD card to running display without guesswork.
26. As a developer, I want the event pipeline to be source-agnostic (GitHub payloads translated into domain events at the edge), so that Linear can be added later without reworking the display.
27. As a viewer, I want the scene rendered smoothly at 1080p on the Pi 4, so that the whimsy isn't undermined by stutter.

## Implementation Decisions

- **Architecture**: one Node/TypeScript server process on the Pi doing four jobs: webhook receiver, Backfill on startup, state keeper, and WebSocket/static server for the display client. A Chromium kiosk on the same Pi runs the client fullscreen.
- **Ingress**: GitHub per-repo webhooks on the Tracked Repos listed in `config.json`, delivered to the Pi through Tailscale Funnel (free tier, stable `*.ts.net` hostname, TLS handled by Tailscale). Webhook payloads verified with the shared webhook secret.
- **Event pipeline**: GitHub payloads are translated at the edge into a small domain-event vocabulary (Celebration Event: `pr-merged`, `review-approved`; Ambient Event: `pr-opened`, `pr-closed`, `changes-requested`, `pr-comment`). Everything downstream — state, protocol, client — speaks only domain events, so a Linear adapter can be added later without touching the display.
- **Event set**: PR opened, merged, closed-without-merge; review approved / changes-requested; PR comments. Drafts, pushes, CI status, and issues are ignored.
- **State**: in-memory, rebuilt on boot via Backfill (open PRs and last-24h activity from the GitHub API using a fine-grained PAT). No database. Team Score is derived from the week's Celebration Events, so it survives restarts via Backfill rather than persistence.
- **Display protocol**: server pushes domain events and state snapshots to the client over WebSocket; a full snapshot is sent on (re)connect. The protocol is the contract between server and client.
- **Scoring**: Team Score only — no per-person scores. Point values per event type are config. Weekly reset at Monday 00:00 local time.
- **Time-driven behavior**: server-side scheduler emits Day Chimes (weekdays 09:00 and 17:00), enforces Quiet Hours (sound allowed weekdays 09:00–18:00 only; outside it Celebration Events animate silently), expires Feed entries past 24h, and resets the Team Score weekly. The clock is injectable for tests.
- **Client**: PixiJS canvas at 1080p, retro-arcade theme, sprites and jingles from CC0 asset packs. Audio out over HDMI to the TV. Display-only — no input handling.
- **Ops**: systemd units for the server and kiosk; deploy is git pull + restart via a script. Setup of the fresh Pi is delivered as a guided walkthrough (OS flash, Tailscale + Funnel, kiosk autostart, webhook registration).
- **Config**: Tracked Repo list, point values, Quiet Hours window, chime times, and secrets live in simple config/env — editable without code changes.

## Testing Decisions

- **One seam: the server boundary.** Tests exercise the server from the outside only — POST recorded GitHub webhook fixture payloads to the HTTP endpoint, stub the GitHub API for Backfill, drive time through the injectable clock — and assert on observable outputs: WebSocket display-protocol messages and state snapshots (Feed contents, Team Score).
- Good tests assert external behavior ("a merged-PR webhook produces a `pr-merged` celebration message and increments the Team Score"), never internals (no reaching into state modules or asserting on translation functions directly).
- Time behavior is tested through the same seam: advance the fake clock past 09:00 weekday → chime message; deliver a merge on Sunday → celebration message flagged silent; advance a week → score reset; advance 24h → Feed entry expiry.
- Webhook signature rejection, untracked-repo filtering, and snapshot-on-reconnect are covered at the same seam.
- The PixiJS client (animations, sprites, sound playback) is not automatically tested — it is verified visually. The display protocol is its contract and is fully covered from the server side.
- Prior art: none — this is the first code in the repo, so these tests establish the pattern.

## Out of Scope

- Linear as an event source (pipeline is shaped for it, but no adapter in v1).
- Any interactivity: no keyboard, remote, touch, or admin UI.
- Per-person leaderboards, avatars-as-competition, or any individual scoring.
- CI status, push events, draft PRs, and issue events.
- Persistence (database) — Backfill makes the in-memory state good enough.
- Multi-display or multi-TV support.
- Historical analytics or reporting.

## Further Notes

- Domain vocabulary lives in the repo glossary (`CONTEXT.md`): Celebration Event, Ambient Event, Tracked Repo, Quiet Hours, Backfill, Feed, Team Score, Day Chime. Use these terms in code, issues, and tests.
- The 17:00 Day Chime falls inside Quiet Hours' sound-allowed window (09:00–18:00), so chimes never conflict with the sound policy; the 09:00 chime sits exactly on the boundary and is allowed.
- Pi 4 rendering budget is real: target 1080p output even on a 4K TV, and prefer sprite-sheet animations over per-frame object churn.
- Tailscale Funnel was chosen over Cloudflare Tunnel (needs a purchased domain), smee.io (no delivery guarantees), and polling (loses the real-time feel celebrations depend on). It also gives SSH access to the headless Pi as a side benefit.
