# 02 — Full event vocabulary, Feed, and snapshots

**What to build:** All tracked GitHub activity shows up on the TV. The six domain events (Celebration: `pr-merged`, `review-approved`; Ambient: `pr-opened`, `pr-closed`, `changes-requested`, `pr-comment`) are translated at the edge; the server keeps in-memory state including the Feed (last 24 hours of events, expired via an injectable clock); clients get a full state snapshot on connect and automatically resync after a WebSocket drop. The client renders the Feed with placeholder visuals. Events from repos not on the Tracked Repo list are ignored.

**Blocked by:** 01 — Tracer bullet.

**Status:** done

- [x] Each of the six event types, delivered as a signed fixture, produces the correct domain-event protocol message
- [x] A client connecting (or reconnecting) receives a snapshot reflecting current Feed state
- [x] Advancing the injectable clock 24h past an event removes it from subsequent snapshots
- [x] Fixtures from an untracked repo produce no protocol message and no state change
- [x] Client renders the Feed and reconnects automatically after a dropped socket
- [x] All behavior asserted at the server seam only

## Comments

Implemented via TDD; adversarial review returned NEEDS-FIXES (minor) — config validation, client-side 24h expiry, shape guards, test pins — all fixed. 25 seam tests green, tsc clean. Client reconnect/expiry behavior remains manual-verification (pre-agreed seam boundary): eyeball on the TV.
