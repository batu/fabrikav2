"""Pull a 4090 detection run, convert boxes to candidate circles, sweep conf
thresholds offline (boxes carry scores), and score each via eval/score.py.

Usage: uv run python eval/runners/score_gpu_run.py <remote_run_name> \
    [--confs 0.05,0.1,0.15,0.2,0.3] [--host ubuntu-server]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent
GOLDEN_DIR = EVAL_DIR / "golden-hitboxes-2026-08-05"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_name")
    ap.add_argument("--confs", default="0.05,0.1,0.15,0.2,0.3")
    ap.add_argument("--host", default="ubuntu-server")
    ap.add_argument("--local", action="store_true",
                    help="skip the rsync pull; score the raw/ boxes already on disk "
                    "(for locally-assembled runs like stitched fold composites)")
    args = ap.parse_args()

    raw_dir = EVAL_DIR / "results" / args.run_name / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    if not args.local:
        # A failed pull must never fall through to stale local boxes: scoring
        # last week's raw/ under this week's run name corrupts RESULTS.md.
        subprocess.run(["rsync", "-a", f"{args.host}:hitbox-lab/runs/{args.run_name}/",
                        str(raw_dir) + "/"], check=True)
    if not any(raw_dir.glob("*.json")):
        raise SystemExit(f"no raw boxes in {raw_dir}")

    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
    run_meta = json.loads((raw_dir / "_run.json").read_text())
    missing = [sid for sid in manifest if not (raw_dir / f"{sid}.json").exists()]
    if missing:
        print(f"WARNING: {len(missing)} manifest levels have no raw boxes "
              f"(scored as zero candidates): {missing}")

    for conf in [float(c) for c in args.confs.split(",")]:
        tag = f"{args.run_name}-conf{conf:g}"
        cand_dir = EVAL_DIR / "results" / tag / "candidates"
        cand_dir.mkdir(parents=True, exist_ok=True)
        for sid, info in manifest.items():
            src = raw_dir / f"{sid}.json"
            if not src.exists():
                continue
            dim = info["dims"][0]
            r_uniform = max(18, round(87 * dim / 4096))
            cands = [
                {"x": round(b["x"] + b["w"] / 2), "y": round(b["y"] + b["h"] / 2),
                 "r": r_uniform}
                for b in json.loads(src.read_text()) if b["score"] >= conf
            ]
            (cand_dir / f"{sid}.json").write_text(json.dumps(cands))
        meta = {"backend": run_meta.get("backend"), "weights": run_meta.get("weights"),
                "params": run_meta.get("params"), "conf": conf,
                "timings_s_total": round(sum(run_meta.get("timings_s", {}).values()), 1),
                "gpu_mem_mb": run_meta.get("gpu_mem_mb")}
        subprocess.run([sys.executable, str(EVAL_DIR / "score.py"), str(cand_dir),
                        "--run-id", tag, "--notes",
                        f"{run_meta.get('backend')} conf>={conf:g} tiled",
                        "--meta", json.dumps(meta)], check=True)


if __name__ == "__main__":
    main()
