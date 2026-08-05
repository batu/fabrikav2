"""Build tiled YOLO dataset v3 (runs on ubuntu-server).

v3 changes vs v2: parametrized corpus file (--corpus), leakage exclusion at
build time (--exclude-keys keyword list / --exclude-golden-tagged), so the
same builder produces both the golden-free main dataset and the
leave-family-out fold datasets. Retains v2's per-scene scale normalization
(median bird box ~= --target-bird px) and fixed val families.

Usage: .venv/bin/python build_yolo_dataset_v3.py --out dataset-v4 \
    --corpus corpus/corpus_v4.json --exclude-golden-tagged
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
LAB = Path.home() / "hitbox-lab"
VAL_KEYS = ("uk_cotswolds", "railway_roundhouse_sleepy", "japan_temple_garden")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--corpus", default="corpus/corpus_v3.json")
    ap.add_argument("--exclude-keys", default="", help="csv keywords: skip sids matching any")
    ap.add_argument("--exclude-golden-tagged", action="store_true", help="skip sessions with any golden_keys")
    ap.add_argument("--tile", type=int, default=1024)
    ap.add_argument("--overlap", type=int, default=256)
    ap.add_argument("--target-bird", type=int, default=190)
    ap.add_argument("--neg-frac", type=float, default=0.3)
    args = ap.parse_args()

    rng = random.Random(0)
    corpus = json.loads((LAB / args.corpus).read_text())
    excl = [k for k in args.exclude_keys.split(",") if k]
    out = LAB / args.out
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)

    step = args.tile - args.overlap
    n_tiles = {"train": 0, "val": 0}
    n_boxes = {"train": 0, "val": 0}
    skipped = 0
    for sid, e in sorted(corpus.items()):
        if args.exclude_golden_tagged and e.get("golden_keys"):
            skipped += 1
            continue
        if excl and any(k in sid for k in excl):
            skipped += 1
            continue
        split = "val" if any(k in sid for k in VAL_KEYS) else "train"
        img = Image.open(LAB / "corpus/scenes" / f"{sid}.png").convert("RGB")
        scale = max(0.5, min(6.0, args.target_bird / max(20, e["median_box"])))
        W = round(img.width * scale)
        H = round(img.height * scale)
        if scale != 1.0:
            img = img.resize((W, H), Image.LANCZOS)
        boxes = [[v * scale for v in b] for b in e["boxes"]]
        tile = min(args.tile, W, H)
        xs = list(range(0, max(1, W - tile) + 1, step))
        ys = list(range(0, max(1, H - tile) + 1, step))
        if xs[-1] + tile < W:
            xs.append(W - tile)
        if ys[-1] + tile < H:
            ys.append(H - tile)
        for ty in ys:
            for tx in xs:
                inside = []
                for x0, y0, x1, y1 in boxes:
                    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                    if not (tx <= cx < tx + tile and ty <= cy < ty + tile):
                        continue
                    bx0, by0 = max(x0, tx), max(y0, ty)
                    bx1, by1 = min(x1, tx + tile), min(y1, ty + tile)
                    if bx1 - bx0 < 8 or by1 - by0 < 8:
                        continue
                    inside.append((
                        ((bx0 + bx1) / 2 - tx) / tile, ((by0 + by1) / 2 - ty) / tile,
                        (bx1 - bx0) / tile, (by1 - by0) / tile))
                if not inside and rng.random() > args.neg_frac:
                    continue
                name = f"{sid}_{tx}_{ty}"
                img.crop((tx, ty, tx + tile, ty + tile)).save(
                    out / "images" / split / f"{name}.jpg", quality=92)
                (out / "labels" / split / f"{name}.txt").write_text(
                    "".join(f"0 {c[0]:.6f} {c[1]:.6f} {c[2]:.6f} {c[3]:.6f}\n" for c in inside))
                n_tiles[split] += 1
                n_boxes[split] += len(inside)
    (out / "data.yaml").write_text(
        f"path: {out}\ntrain: images/train\nval: images/val\nnames:\n  0: bird\n")
    print(f"tiles: {n_tiles}, boxes: {n_boxes}, skipped: {skipped}")


if __name__ == "__main__":
    main()
