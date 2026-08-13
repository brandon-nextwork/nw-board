# CONTEXT.md

Glossary for the PR arcade display (Raspberry Pi + TV, GitHub activity).

## Terms

- **Celebration Event** — an event worth fanfare: a PR merged or a review approval. Triggers a prominent animation and a short sound effect.
- **Ambient Event** — any other tracked event (PR opened, PR closed without merge, changes requested, PR comment). Shown as a silent animation in the background feed.
- **Tracked Repo** — a repository on the curated list whose activity feeds the display. Activity from any other repo is ignored.
- **Quiet Hours** — a configured daily window during which Celebration Events animate but make no sound.
- **Backfill** — fetching the current state of Tracked Repos (open PRs, recent activity) at startup, so the display is never empty and missed events don't leave gaps.
- **Feed** — the ambient stream of the last 24 hours of tracked events.
- **Team Score** — a single shared point total earned from Celebration Events. No per-person scores. Resets weekly.
- **Day Chime** — a scheduled sound marking the start (09:00) and end (17:00) of the workday, weekdays only. Not tied to any event.
