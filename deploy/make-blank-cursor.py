#!/usr/bin/env python3
"""Regenerate blank-cursor/: an Xcursor theme whose every cursor is a single
transparent pixel. Committed output; rerun only if the name list changes."""

import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
CURSORS = os.path.join(HERE, "blank-cursor", "cursors")

# One 1x1 fully transparent image chunk, nominal size 24.
# Xcursor file: magic, header size, version, ntoc; one toc entry; image chunk.
IMAGE = 0xFFFD0002
blank = struct.pack("<4sIII", b"Xcur", 16, 0x10000, 1)  # file header, 1 toc entry
blank += struct.pack("<III", IMAGE, 24, 28)  # toc: image, size 24, at byte 28
blank += struct.pack("<IIIIIIIII", 36, IMAGE, 24, 1, 1, 1, 0, 0, 50)  # 1x1, hot 0,0
blank += struct.pack("<I", 0x00000000)  # the pixel: transparent ARGB

# Every name Chromium or the compositor might ask for during boot and load.
NAMES = """left_ptr default arrow ptr top_left_arrow text xterm ibeam pointer
hand hand1 hand2 pointing_hand wait watch progress left_ptr_watch crosshair
cross move grabbing closedhand openhand not-allowed no-drop dnd-none
col-resize row-resize ns-resize ew-resize nesw-resize nwse-resize
n-resize s-resize e-resize w-resize ne-resize nw-resize se-resize sw-resize
sb_h_double_arrow sb_v_double_arrow help question_arrow context-menu
vertical-text alias copy cell all-scroll zoom-in zoom-out up_arrow""".split()

os.makedirs(CURSORS, exist_ok=True)
with open(os.path.join(CURSORS, NAMES[0]), "wb") as f:
    f.write(blank)
for name in NAMES[1:]:
    link = os.path.join(CURSORS, name)
    if os.path.lexists(link):
        os.remove(link)
    os.symlink(NAMES[0], link)
with open(os.path.join(HERE, "blank-cursor", "index.theme"), "w") as f:
    f.write("[Icon Theme]\nName=blank-cursor\n")
print(f"wrote {CURSORS}: 1 cursor + {len(NAMES) - 1} symlinks")
