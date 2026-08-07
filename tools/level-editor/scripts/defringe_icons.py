"""Kill the faint ghost halo on nav icons without eating real antialiasing.

Ghost pixels (alpha < GHOST_MAX) are pure artefact from the generation/keying
chain: they render as a dirty haze around the icon. Real edge antialiasing
lives well above that. Zero the ghost, then re-normalise the surviving partial
alphas so the edge keeps its smooth ramp instead of gaining a hard step.
"""
from PIL import Image
import numpy as np
from pathlib import Path
import sys

GHOST_MAX = 40
G = Path("/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/public/ui")
TARGETS = [
    G / "achievements/achievement-shortcut-runtime.png",
    G / "menu-icons/shop-icon-runtime.png",
    G / "menu-icons/settings-icon-runtime.png",
]
write = "--write" in sys.argv

for p in TARGETS:
    im = Image.open(p).convert("RGBA")
    arr = np.asarray(im).astype(np.float32)
    a = arr[..., 3]
    before_bbox = im.getbbox()
    ghost = (a > 0) & (a < GHOST_MAX)
    a = np.where(ghost, 0.0, a)
    # Re-ramp: map [GHOST_MAX,255] -> [0,255] so the edge stays smooth.
    partial = (a > 0) & (a < 255)
    a = np.where(partial, (a - GHOST_MAX) / (255.0 - GHOST_MAX) * 255.0, a)
    arr[..., 3] = np.clip(a, 0, 255)
    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    after_bbox = out.getbbox()
    print(f"{p.name:42} removed {int(ghost.sum()):5} ghost px  bbox {before_bbox} -> {after_bbox}")
    if write:
        out.save(p)
if write:
    print("WROTE")
