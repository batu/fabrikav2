"""Diff-evidence verifier: filter detector proposal boxes by how strongly the
box region differs from the clean background (painted birds diff hard even
under global repaint drift; measured golden windows frac(diff>40) ~0.85 vs
drift ~0.5-0.65). READ-ONLY.

Reads raw GPU boxes (eval/results/<run>/raw/<sid>.json: x,y,w,h,score),
emits filtered candidate circles for each (conf, min diff-fraction) combo and
scores them.

Usage: uv run python eval/runners/verify_diff.py <run_name> \
    --conf 0.1 --fracs 0.5,0.6,0.7,0.8 [--dthresh 40]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
EVAL_DIR = Path(__file__).resolve().parent.parent
GOLDEN_DIR = EVAL_DIR / "golden-hitboxes-2026-08-05"


def selected_bg(sdir: Path) -> Path:
    sel = json.loads((sdir / "session.json").read_text()).get("selected_bg") or 0
    return sdir / f"bg_{int(sel):02d}.png"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_name")
    ap.add_argument("--conf", type=float, default=0.1)
    ap.add_argument("--fracs", default="0.5,0.6,0.7,0.8")
    ap.add_argument("--dthresh", type=int, default=40)
    args = ap.parse_args()

    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
    raw_dir = EVAL_DIR / "results" / args.run_name / "raw"
    fracs = [float(f) for f in args.fracs.split(",")]

    # Pass 1: annotate every box with its diff fraction (one image pair load per level).
    annotated: dict[str, list[dict]] = {}
    for sid, info in manifest.items():
        src = raw_dir / f"{sid}.json"
        if not src.exists():
            continue
        sdir = Path(info["color"]).parent
        a = np.asarray(Image.open(selected_bg(sdir)).convert("RGB"), dtype=np.int16)
        b = np.asarray(Image.open(sdir / "color.png").convert("RGB"), dtype=np.int16)
        diff = np.abs(a - b).sum(axis=2) > args.dthresh
        H, W = diff.shape
        boxes = [bx for bx in json.loads(src.read_text()) if bx["score"] >= args.conf]
        for bx in boxes:
            x0 = max(0, int(bx["x"])); y0 = max(0, int(bx["y"]))
            x1 = min(W, int(bx["x"] + bx["w"])); y1 = min(H, int(bx["y"] + bx["h"]))
            win = diff[y0:y1, x0:x1]
            bx["diff_frac"] = float(win.mean()) if win.size else 0.0
        annotated[sid] = boxes
        print(f"{sid}: {len(boxes)} boxes annotated", flush=True)

    for frac in fracs:
        tag = f"{args.run_name}-conf{args.conf:g}-diff{frac:g}"
        cand_dir = EVAL_DIR / "results" / tag / "candidates"
        cand_dir.mkdir(parents=True, exist_ok=True)
        for sid, info in manifest.items():
            if sid not in annotated:
                continue
            dim = info["dims"][0]
            r_uniform = max(18, round(87 * dim / 4096))
            cands = [
                {"x": round(bx["x"] + bx["w"] / 2), "y": round(bx["y"] + bx["h"] / 2),
                 "r": r_uniform}
                for bx in annotated[sid] if bx["diff_frac"] >= frac
            ]
            (cand_dir / f"{sid}.json").write_text(json.dumps(cands))
        subprocess.run([sys.executable, str(EVAL_DIR / "score.py"), str(cand_dir),
                        "--run-id", tag, "--notes",
                        f"{args.run_name} conf>={args.conf:g} + diff-frac>={frac:g} (t{args.dthresh})",
                        "--meta", json.dumps({"verifier": "diff-frac", "conf": args.conf,
                                              "frac": frac, "dthresh": args.dthresh})],
                       check=True)


if __name__ == "__main__":
    main()
