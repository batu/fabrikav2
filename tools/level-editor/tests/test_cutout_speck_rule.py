"""Satellite-speck rule tightening (plan 2026-07-31-002 U7)."""

import numpy as np
from PIL import Image

from levelbuilder.api.inpaint import Hitbox, _clean_sprite_alpha


def _mask(w, h, rects):
    arr = np.zeros((h, w), dtype=np.uint8)
    for x0, y0, x1, y1 in rects:
        arr[y0:y1, x0:x1] = 255
    return Image.fromarray(arr, mode="L")


def test_detached_crumb_outside_tight_zone_is_dropped():
    hb = Hitbox(x=100, y=100, radius=24)
    box = (40, 40, 160, 160)
    # Body on the core + a 4x4 crumb 55px away (inside old 2.6r=62, outside new 1.8r=43).
    mask = _mask(120, 120, [(45, 45, 80, 80), (110, 58, 114, 62)])
    cleaned = _clean_sprite_alpha(mask, hb, box)
    arr = np.array(cleaned)
    assert arr[46:78, 46:78].max() > 0  # body kept
    assert arr[56:64, 108:116].max() == 0  # crumb dropped


def test_held_tool_touching_core_is_kept():
    hb = Hitbox(x=100, y=100, radius=24)
    box = (40, 40, 160, 160)
    # Body plus a thin telescope crossing the hitbox core outward to the edge zone.
    mask = _mask(120, 120, [(45, 45, 80, 80), (58, 58, 118, 64)])
    cleaned = _clean_sprite_alpha(mask, hb, box)
    arr = np.array(cleaned)
    assert arr[59:63, 100:116].max() > 0  # tool tip survives (component touches core)
