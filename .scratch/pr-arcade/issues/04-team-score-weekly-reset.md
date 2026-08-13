# 04 — Team Score + weekly reset

**What to build:** The board shows a single shared Team Score that grows with every Celebration Event (points per event type are config) and resets to zero every Monday at 00:00 local time. The score is part of state snapshots, and after a restart Backfill's recent-activity data rebuilds the current week's score.

**Blocked by:** 02 — Full event vocabulary, Feed, and snapshots.

**Status:** ready-for-agent

- [ ] A `pr-merged` fixture increases the Team Score by the configured merge points; `review-approved` by the configured approval points; Ambient Events change nothing
- [ ] Snapshots include the current Team Score; the client displays it
- [ ] Advancing the injectable clock across Monday 00:00 resets the score to zero
- [ ] Point values are read from config, not hardcoded
- [ ] Asserted at the server seam
