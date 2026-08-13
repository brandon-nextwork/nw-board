# 05 — Sound, Quiet Hours, Day Chimes

**What to build:** The board makes delightful but disciplined noise. Celebration Events play a short 8-bit jingle (<3 seconds) through the TV; outside Quiet Hours (sound allowed weekdays 09:00–18:00 only) celebrations are delivered flagged silent and animate without audio. The server scheduler emits a Day Chime at 09:00 and 17:00 on weekdays, which the client plays as its own sound. Windows and chime times are config.

**Blocked by:** 02 — Full event vocabulary, Feed, and snapshots.

**Status:** ready-for-agent

- [ ] A celebration fixture delivered inside Quiet Hours' allowed window produces a protocol message marked audible; the same fixture on a weekend or at night is marked silent
- [ ] Advancing the injectable clock to 09:00 and 17:00 on a weekday each emit a Day Chime protocol message; weekends emit none
- [ ] Client plays a jingle on audible celebrations, stays silent on silent ones, and plays the chime sound on Day Chime messages
- [ ] Sound window and chime times come from config
- [ ] Server-side behavior asserted at the server seam; audio playback verified by ear
