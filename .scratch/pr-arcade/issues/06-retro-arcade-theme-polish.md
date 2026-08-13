# 06 — Retro arcade theme & 1080p polish

**What to build:** The whimsy. Replace all placeholder visuals with the retro-arcade theme: pixel-art sprites and sprite-sheet animations from CC0 packs, 8-bit jingles and chime sounds, and a full screen layout — the ambient Feed, a Team Score marquee, and full-screen celebration takeovers for merges and approvals. Runs smoothly at 1080p on the Pi 4.

**Blocked by:** 04 — Team Score + weekly reset; 05 — Sound, Quiet Hours, Day Chimes.

**Status:** ready-for-agent

- [ ] Every event type has a distinct themed animation; merges and approvals get takeover-scale celebrations
- [ ] Team Score rendered as an arcade marquee/score display; Feed styled as part of the scene
- [ ] All sounds are themed 8-bit audio, each under 3 seconds
- [ ] All art and audio assets are CC0/appropriately licensed, with sources noted
- [ ] Scene holds steady frame rate at 1080p on a Pi 4 (verified on device or with conservative sprite budgets)
- [ ] Verified visually — no new automated tests expected
