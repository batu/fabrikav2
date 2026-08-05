"""Stitch leave-family-out fold runs into one leakage-free composite raw run.

Each golden level's boxes come from the fold model that excluded that level's
scene family from training (foldD trained on everything, legal for levels
whose family has no corpus sessions).

Usage: uv run python eval/runners/stitch_folds.py yolo-folds-composite
"""

import json
import shutil
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent
GOLDEN_DIR = EVAL_DIR / "golden-hitboxes-2026-08-05"

FOLD_FOR_KEYWORD = {
    "autumn_forest": "yolo11m-foldA-golden",
    "treasure_cove": "yolo11m-foldB-golden",
    "broken_bow": "yolo11m-foldB-golden",
    "yucatan_cenote": "yolo11m-foldC-golden",
    "rainforest_waterfall": "yolo11m-foldC-golden",
}
DEFAULT = "yolo11m-foldD-golden"

run_id = sys.argv[1]
out = EVAL_DIR / "results" / run_id / "raw"
out.mkdir(parents=True, exist_ok=True)
manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
sources = {}
for sid in manifest:
    fold = next((f for k, f in FOLD_FOR_KEYWORD.items() if k in sid), DEFAULT)
    src = EVAL_DIR / "results" / fold / "raw" / f"{sid}.json"
    if not src.exists():
        raise SystemExit(f"missing {src}")
    shutil.copy(src, out / f"{sid}.json")
    sources[sid] = fold
(out / "_run.json").write_text(json.dumps(
    {"runner": "stitch-folds", "sources": sources,
     "backend": "yolo11m LOFO composite", "weights": "4 fold best.pt"}, indent=2))
print(f"stitched {len(sources)} levels")
