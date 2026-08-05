"""Rescore every run in eval/results/ (rebuilds RESULTS.md from scratch,
preserving each run's notes/meta from its previous metrics.json)."""

import json
import subprocess
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent
RESULTS = EVAL_DIR / "results"

md = RESULTS / "RESULTS.md"
if md.exists():
    md.unlink()
for run_dir in sorted(RESULTS.iterdir()):
    cand = run_dir / "candidates"
    if not cand.is_dir():
        continue
    meta_p = run_dir / "metrics.json"
    notes, meta = "", {}
    if meta_p.exists():
        old = json.loads(meta_p.read_text())
        notes, meta = old.get("notes", ""), old.get("meta", {})
    subprocess.run([sys.executable, str(EVAL_DIR / "score.py"), str(cand),
                    "--run-id", run_dir.name, "--notes", notes,
                    "--meta", json.dumps(meta)], check=True,
                   stdout=subprocess.DEVNULL)
    print("rescored", run_dir.name)
