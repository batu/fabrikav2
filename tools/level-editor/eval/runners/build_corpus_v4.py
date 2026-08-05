"""Corpus v4 (runs on Mac): hitbox-anchored centers + local-diff extents.

v3 lesson: spriteBoxes are cutout-space rects — undersized/offset vs painted
birds. v4 derives each bird's extent from the diff component under its OWN
hitbox (local crop, so global repaint drift can't leak in), exactly like the
shipped recentre. Boxes are always centered on the hitbox; side clamped to [1.6r, 3.2r], fallback 2.2r when no component qualifies.

Writes eval/corpus/corpus_v4.json.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
# Repo-relative so the recipe survives this worktree's deletion. The
# levels workspace lives in the MAIN checkout (session data is untracked
# and absent in fresh worktrees); resolve via env override when needed.
import os
EVAL = Path(__file__).resolve().parents[1]
LEVELS = Path(os.environ.get('FTB_LEVELS_DIR',
    Path.home() / 'dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels'))

GOLDEN_KEYWORDS = [
    "autumn_forest", "bazaar_alley", "castle_market", "japanese_garden",
    "snowy_chalet", "treehouse_village", "cheese_farm", "goat_pasture",
    "herb_market", "snowmelt_creek", "autumn_pond", "fairy_ring",
    "surf_shack", "north_shore", "rainforest_waterfall", "hawaii_waterfall",
    "amalfi", "tuscan_hill", "dia_de_muertos", "yucatan_cenote",
    "broken_bow", "treasure_cove", "pirate_cove",
]

corpus = json.loads((EVAL / 'corpus/corpus.json').read_text())
out = {}
dropped = []
for sid, e in sorted(corpus.items()):
    sdir = LEVELS / sid
    hbs = json.loads((sdir / 'hitboxes.json').read_text())
    if not hbs:
        continue
    sel = json.loads((sdir / 'session.json').read_text()).get('selected_bg') or 0
    a = np.asarray(Image.open(sdir / f'bg_{int(sel):02d}.png').convert('RGB'), dtype=np.int16)
    b = np.asarray(Image.open(sdir / 'color.png').convert('RGB'), dtype=np.int16)
    if a.shape != b.shape:
        dropped.append((sid, 'dims mismatch'))
        continue
    H, W = b.shape[:2]
    scale = W / 4096.0
    min_area = max(30, int(900 * scale * scale))
    boxes = []
    n_diff = 0
    for hb in hbs:
        x, y, r = int(hb['x']), int(hb['y']), int(hb.get('r') or 58)
        pad = int(r * 2.2)
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(W, x + pad), min(H, y + pad)
        rawdiff = np.abs(a[y0:y1, x0:x1] - b[y0:y1, x0:x1]).sum(axis=2) > 120
        diff = ndi.binary_dilation(rawdiff, iterations=5)
        labels, _ = ndi.label(diff)
        best = None
        for idx, sl in enumerate(ndi.find_objects(labels), start=1):
            if sl is None:
                continue
            h_ = sl[0].stop - sl[0].start
            w_ = sl[1].stop - sl[1].start
            if w_ * h_ < min_area:
                continue
            ys, xs = np.nonzero(labels == idx)
            cy, cx = float(ys.mean()) + y0, float(xs.mean()) + x0
            dist = ((cx - x) ** 2 + (cy - y) ** 2) ** 0.5
            if dist <= r * 1.6 and (best is None or dist < best[0]):
                best = (dist, idx, sl)
        # Box is ALWAYS centered on the hitbox center (the quantity the model
        # must learn to predict); the diff component only sets its size.
        half = 1.1 * r
        if best is not None:
            _, idx, sl = best
            ys, xs = np.nonzero((labels == idx) & rawdiff)
            if len(xs):
                side = max(int(xs.max() - xs.min()), int(ys.max() - ys.min())) + 8
                half = max(0.8 * r, min(1.6 * r, side / 2))
                n_diff += 1
        boxes.append([round(x - half), round(y - half), round(x + half), round(y + half)])
    frac_diff = n_diff / len(boxes)
    if frac_diff < 0.34:
        dropped.append((sid, f'only {n_diff}/{len(boxes)} diff-derived'))
        continue
    sizes = sorted(max(bb[2] - bb[0], bb[3] - bb[1]) for bb in boxes)
    out[sid] = {'family': e['family'], 'color': e['color'], 'dims': e['dims'],
                'boxes': boxes, 'median_box': sizes[len(sizes) // 2],
                'n_diff': n_diff,
                'golden_keys': [k for k in GOLDEN_KEYWORDS if k in sid]}
    print(f"{sid}: {len(boxes)} boxes ({n_diff} diff-derived) median={sizes[len(sizes)//2]}")

(EVAL / 'corpus/corpus_v4.json').write_text(json.dumps(out, indent=1))
print(f"\nkept={len(out)} boxes={sum(len(e['boxes']) for e in out.values())} "
      f"golden-tagged={sum(1 for e in out.values() if e['golden_keys'])}")
for sid, why in dropped:
    print(f"DROPPED {sid}: {why}")
