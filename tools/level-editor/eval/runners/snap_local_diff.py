"""Standalone local-diff snap: recentre candidate circles to the nearest
painted-diff component inside their own crop (READ-ONLY port of
`recenter_hitboxes_local_diff()`, same defaults: crop 2.2r, threshold 80,
min_area 900, dilate 5, refuse shifts > 1.6r).

Usage: uv run python eval/runners/snap_local_diff.py <in_dir> <out_dir> \
    [--prune-empty]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
EVAL_DIR = Path(__file__).resolve().parent.parent
GOLDEN_DIR = EVAL_DIR / "golden-hitboxes-2026-08-05"


def selected_bg(sdir: Path) -> Path:
    sel = json.loads((sdir / "session.json").read_text()).get("selected_bg") or 0
    return sdir / f"bg_{int(sel):02d}.png"


def snap(sdir: Path, hitboxes: list[dict], *, crop_factor=2.2, threshold=80,
         min_area=900, max_shift_factor=1.6, dilate=5, prune_empty=False) -> list[dict]:
    a_full = np.asarray(Image.open(selected_bg(sdir)).convert("RGB"), dtype=np.int16)
    b_full = np.asarray(Image.open(sdir / "color.png").convert("RGB"), dtype=np.int16)
    H, W = b_full.shape[:2]
    area_scaled = max(1, int(min_area * (W / 4096.0) ** 2))
    out = []
    for hb in hitboxes:
        r = int(hb.get("r") or 58)
        pad = int(r * crop_factor)
        x0, y0 = max(0, hb["x"] - pad), max(0, hb["y"] - pad)
        x1, y1 = min(W, hb["x"] + pad), min(H, hb["y"] + pad)
        diff = np.abs(a_full[y0:y1, x0:x1] - b_full[y0:y1, x0:x1]).sum(axis=2) > threshold
        if dilate:
            diff = ndi.binary_dilation(diff, iterations=dilate)
        labels, _n = ndi.label(diff)
        best = None
        for idx, sl in enumerate(ndi.find_objects(labels), start=1):
            if sl is None:
                continue
            h = sl[0].stop - sl[0].start
            w = sl[1].stop - sl[1].start
            if w * h < area_scaled:
                continue
            ys, xs = np.nonzero(labels == idx)
            cy, cx = float(ys.mean()) + y0, float(xs.mean()) + x0
            dist = ((cx - hb["x"]) ** 2 + (cy - hb["y"]) ** 2) ** 0.5
            if best is None or dist < best[0]:
                best = (dist, cx, cy)
        hb = dict(hb)
        if best is None:
            if prune_empty:
                continue
        else:
            dist, cx, cy = best
            if 3 <= dist <= r * max_shift_factor:
                hb["x"], hb["y"] = int(cx), int(cy)
        out.append(hb)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("in_dir", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--prune-empty", action="store_true")
    ap.add_argument("--threshold", type=int, default=80)
    ap.add_argument("--dilate", type=int, default=5)
    ap.add_argument("--min-area", type=int, default=900)
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
    timings = {}
    for sid, info in manifest.items():
        src = args.in_dir / f"{sid}.json"
        if not src.exists():
            continue
        t0 = time.time()
        hbs = json.loads(src.read_text())
        snapped = snap(Path(info["color"]).parent, hbs, prune_empty=args.prune_empty,
                       threshold=args.threshold, dilate=args.dilate, min_area=args.min_area)
        timings[sid] = round(time.time() - t0, 2)
        (args.out_dir / f"{sid}.json").write_text(json.dumps(snapped))
        print(f"{sid}: {len(hbs)} -> {len(snapped)} in {timings[sid]}s")
    (args.out_dir / "_run.json").write_text(json.dumps({
        "runner": "snap-local-diff", "in_dir": str(args.in_dir),
        "prune_empty": args.prune_empty, "timings_s": timings}, indent=2))


if __name__ == "__main__":
    main()
