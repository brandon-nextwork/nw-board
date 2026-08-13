# 06 — Retro arcade theme & 1080p polish

**What to build:** The whimsy. Replace all placeholder visuals with the retro-arcade theme: pixel-art sprites and sprite-sheet animations from CC0 packs, 8-bit jingles and chime sounds, and a full screen layout — the ambient Feed, a Team Score marquee, and full-screen celebration takeovers for merges and approvals. Runs smoothly at 1080p on the Pi 4.

**Blocked by:** 04 — Team Score + weekly reset; 05 — Sound, Quiet Hours, Day Chimes.

**Status:** done

- [x] Every event type has a distinct themed animation; merges and approvals get takeover-scale celebrations
- [x] Team Score rendered as an arcade marquee/score display; Feed styled as part of the scene
- [x] All sounds are themed 8-bit audio, each under 3 seconds
- [x] All art and audio assets are CC0/appropriately licensed, with sources noted
- [x] Scene holds steady frame rate at 1080p on a Pi 4 (verified on device or with conservative sprite budgets)
- [x] Verified visually — no new automated tests expected

## Comments

All art and audio generated programmatically (Graphics->RenderTexture pixel sprites, WebAudio chiptunes) — no asset files, no licensing. Pixi served locally via public/vendor symlink into node_modules. Verified via headless screenshots + full webhook->celebration pipeline. Frame-rate on the actual Pi 4 still needs an on-device check (ticket 07 wizard). Console QA: `arcade.demo()`.
