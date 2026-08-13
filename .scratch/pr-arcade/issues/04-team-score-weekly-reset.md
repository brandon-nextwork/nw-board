# 04 — Team Score + weekly reset

**What to build:** The board shows a single shared Team Score that grows with every Celebration Event (points per event type are config) and resets to zero every Monday at 00:00 local time. The score is part of state snapshots, and after a restart Backfill's recent-activity data rebuilds the current week's score.

**Blocked by:** 02 — Full event vocabulary, Feed, and snapshots.

**Status:** done

- [x] A `pr-merged` fixture increases the Team Score by the configured merge points; `review-approved` by the configured approval points; Ambient Events change nothing
- [x] Snapshots include the current Team Score; the client displays it
- [x] Advancing the injectable clock across Monday 00:00 resets the score to zero
- [x] Point values are read from config, not hardcoded
- [x] Asserted at the server seam

## Comments

Built in a parallel worktree, merged, then fixed after combined review: redelivered merges can no longer double-score; connected displays get a snapshot push when the week rolls over; Backfill rebuilds merge AND approval points. 63 seam tests green.
