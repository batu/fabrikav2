"""Export restore background (2026-09-08): erase the whole connected painted
bird, not just the cleanup rectangle, so feet/tails outside the sticker box
do not stay on screen after the pickup. Detached additions stay put."""
import json

import numpy as np
from PIL import Image


def test_connected_bird_pixels_outside_cleanup_are_erased_but_detached_blob_stays(tmp_path):
    from levelbuilder.api.session import _write_birdless_restore_bg

    sdir = tmp_path / "s"
    dst = tmp_path / "d"
    sdir.mkdir()
    dst.mkdir()
    rng = np.random.default_rng(1)
    clean = rng.integers(60, 120, size=(200, 200, 3), dtype=np.uint8)
    painted = clean.copy()
    # bird body inside the cleanup rect (80..120), a "tail" sticking out to
    # x=135 — inside the 2x footprint (60..140) the runtime reveals
    painted[85:115, 85:115] = (230, 40, 40)
    painted[95:105, 115:135] = (230, 40, 40)
    # detached leaf, well away from the rect but inside the 2x footprint
    painted[70:76, 150:158] = (30, 200, 60)
    Image.fromarray(clean).save(sdir / "bg_00.png")
    Image.fromarray(painted).save(sdir / "color.png")
    level = {"dogs": [{"id": "b", "sprite": {"cleanup": {"x": 80, "y": 80, "width": 40, "height": 40}}}]}
    _write_birdless_restore_bg(sdir, dst, {"selected_bg": 0}, level)
    out = np.asarray(Image.open(dst / "bg_00.png").convert("RGB")).astype(int)
    tail = np.abs(out[97:103, 118:133] - clean[97:103, 118:133].astype(int)).sum(axis=2)
    assert tail.max() < 45, "tail outside the cleanup rect must be erased"
    leaf = np.abs(out[71:75, 151:157] - painted[71:75, 151:157].astype(int)).sum(axis=2)
    assert leaf.max() < 45, "a detached addition must stay as painted"
    far = np.abs(out[10:30, 10:30] - painted[10:30, 10:30].astype(int)).sum(axis=2)
    assert far.max() == 0
