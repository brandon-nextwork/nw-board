# 03 — Backfill on boot

**What to build:** A freshly (re)started server never shows a blank board. On startup the server performs Backfill: it fetches open PRs and the last 24 hours of activity for the Tracked Repos from the GitHub API (fine-grained PAT) and rebuilds in-memory state, so the first client snapshot is already populated and events missed during downtime leave no gaps.

**Blocked by:** 02 — Full event vocabulary, Feed, and snapshots.

**Status:** ready-for-agent

- [ ] With the GitHub API stubbed to return open PRs and recent events, a client connecting right after boot receives a snapshot containing them
- [ ] Backfilled and webhook-delivered versions of the same event don't double-appear in the Feed
- [ ] A Backfill failure (API error) leaves the server running and serving live webhook events, not crashed
- [ ] Asserted at the server seam with the API stub
