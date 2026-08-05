"""Incumbent runner: local-diff detection (standalone, READ-ONLY).

Reimplements `detect_painted_subjects()` (levelbuilder/api/inpaint.py) against
manifest paths so golden sessions are never touched. Emits candidate circles:
center = diff-component centroid (what the shipped recentre snaps to),
r = uniform editor radius scaled to level size (87 in 4096-space — the
pipeline's tap-generosity convention, not a fit to golden).

Usage: uv run python eval/runners/run_local_diff.py <out_dir> \
    [--threshold 40] [--min-area 400] [--merge-px 4] [--center bbox|centroid]
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


def detect(sdir: Path, threshold: int, min_area: int, merge_px: int, center: str) -> list[dict]:
    with Image.open(selected_bg(sdir)) as a_img, Image.open(sdir / "color.png") as b_img:
        a = np.asarray(a_img.convert("RGB"), dtype=np.int16)
        b = np.asarray(b_img.convert("RGB"), dtype=np.int16)
    if a.shape != b.shape:
        raise SystemExit(f"{sdir.name}: bg {a.shape} vs color {b.shape} mismatch")
    dim = b.shape[0]
    # min_area scales with resolution: defaults were tuned at 4096.
    area_scaled = max(1, int(min_area * (dim / 4096.0) ** 2))
    changed = np.abs(a - b).sum(axis=2) > threshold
    if merge_px > 0:
        changed = ndi.binary_dilation(changed, iterations=merge_px)
    labels, _n = ndi.label(changed)
    r_uniform = max(18, round(87 * dim / 4096))
    dets: list[dict] = []
    for idx, sl in enumerate(ndi.find_objects(labels), start=1):
        if sl is None:
            continue
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if w * h < area_scaled:
            continue
        if center == "centroid":
            ys, xs = np.nonzero(labels == idx)
            cx, cy = float(xs.mean()), float(ys.mean())
        else:
            cx = (sl[1].start + sl[1].stop) / 2.0
            cy = (sl[0].start + sl[0].stop) / 2.0
        dets.append({"x": round(cx), "y": round(cy), "r": r_uniform,
                     "w": w, "h": h})
    return dets


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--threshold", type=int, default=40)
    ap.add_argument("--min-area", type=int, default=400)
    ap.add_argument("--merge-px", type=int, default=4)
    ap.add_argument("--center", choices=["bbox", "centroid"], default="centroid")
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
    timings = {}
    for sid, info in manifest.items():
        t0 = time.time()
        dets = detect(Path(info["color"]).parent, args.threshold, args.min_area,
                      args.merge_px, args.center)
        timings[sid] = round(time.time() - t0, 2)
        (args.out_dir / f"{sid}.json").write_text(json.dumps(
            [{"x": d["x"], "y": d["y"], "r": d["r"]} for d in dets]))
        print(f"{sid}: {len(dets)} dets in {timings[sid]}s")
    (args.out_dir / "_run.json").write_text(json.dumps({
        "runner": "local-diff", "params": vars(args) | {"out_dir": str(args.out_dir)},
        "timings_s": timings, "total_s": round(sum(timings.values()), 1)}, indent=2))


if __name__ == "__main__":
    main()
