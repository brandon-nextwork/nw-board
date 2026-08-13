# 01 — Tracer bullet: merged PR → celebration on screen

**What to build:** When a PR is merged in a Tracked Repo, the TV plays a celebration animation within seconds. A signature-verified GitHub webhook arrives at the server, is translated at the edge into a `pr-merged` Celebration Event, is pushed to the browser over WebSocket, and the PixiJS client (placeholder art is fine) plays a visible celebration. This proves the entire pipe end to end.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] POSTing a recorded `pull_request` merged fixture (correctly signed) to the webhook endpoint results in a `pr-merged` display-protocol message on a connected WebSocket client
- [x] Requests with a bad or missing signature are rejected and produce no protocol message
- [x] The browser client connects, and on receiving `pr-merged` plays a placeholder celebration animation on a PixiJS canvas
- [x] Server-seam test covers the fixture-in → protocol-message-out path (no internals asserted)

## Comments

Implemented via TDD (8 red→green cycles, incl. 5 fix cycles from adversarial review). 10 seam tests green, tsc clean. Review findings on CDN import and ws:// hardcoding deliberately deferred to tickets 06/07.
