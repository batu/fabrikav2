"""Offline voting ensemble over saved raw GPU/VLM runs.

Sources: raw box runs under eval/results/<run>/raw/<sid>.json (x,y,w,h,score)
or VLM candidate dirs (circles). Boxes above per-source conf become proposals;
proposals from different sources within --radius px (level-relative, 87@4096
by default) form a cluster. Clusters with >= --votes distinct sources survive;
center = mean of member centers (per source, its best-scoring member).

Usage:
  uv run python eval/runners/ensemble_vote.py --run-id ens-ow-gd-yo \
      --sources owlv2-c008:0.15,gdino-c020:0.25,yolo11s-v4-c010:0.1 --votes 2
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent
GOLDEN_DIR = EVAL_DIR / "golden-hitboxes-2026-08-05"


def load_source(run: str, conf: float, sid: str) -> list[dict]:
    raw = EVAL_DIR / "results" / run / "raw" / f"{sid}.json"
    if raw.exists():
        return [{"x": b["x"] + b["w"] / 2, "y": b["y"] + b["h"] / 2, "score": b["score"]}
                for b in json.loads(raw.read_text()) if b["score"] >= conf]
    cand = EVAL_DIR / "results" / run / "candidates" / f"{sid}.json"
    if cand.exists():
        return [{"x": c["x"], "y": c["y"], "score": 1.0} for c in json.loads(cand.read_text())]
    return []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--sources", required=True,
                    help="csv of run:conf entries; first source is the anchor")
    ap.add_argument("--votes", type=int, default=2)
    ap.add_argument("--radius", type=float, default=87.0, help="cluster radius @4096")
    ap.add_argument("--anchor-only", action="store_true",
                    help="only clusters containing the anchor source survive")
    args = ap.parse_args()

    sources = []
    for tok in args.sources.split(","):
        run, conf = tok.rsplit(":", 1)
        sources.append((run, float(conf)))

    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
    cand_dir = EVAL_DIR / "results" / args.run_id / "candidates"
    cand_dir.mkdir(parents=True, exist_ok=True)

    for sid, info in manifest.items():
        dim = info["dims"][0]
        radius = args.radius * dim / 4096.0
        r_uniform = max(18, round(87 * dim / 4096))
        per_src = [load_source(run, conf, sid) for run, conf in sources]
        # Greedy clustering anchored on source order, then score.
        clusters: list[dict] = []  # {members: {src_idx: (x, y, score)}}
        for si, dets in enumerate(per_src):
            for d in dets:
                best = None
                for cl in clusters:
                    cx = sum(m[0] for m in cl["members"].values()) / len(cl["members"])
                    cy = sum(m[1] for m in cl["members"].values()) / len(cl["members"])
                    dist = ((d["x"] - cx) ** 2 + (d["y"] - cy) ** 2) ** 0.5
                    if dist <= radius and (best is None or dist < best[0]):
                        best = (dist, cl)
                if best is not None:
                    cl = best[1]
                    if si not in cl["members"] or d["score"] > cl["members"][si][2]:
                        cl["members"][si] = (d["x"], d["y"], d["score"])
                else:
                    clusters.append({"members": {si: (d["x"], d["y"], d["score"])}})
        out = []
        for cl in clusters:
            if len(cl["members"]) < args.votes:
                continue
            if args.anchor_only and 0 not in cl["members"]:
                continue
            xs = [m[0] for m in cl["members"].values()]
            ys = [m[1] for m in cl["members"].values()]
            out.append({"x": round(sum(xs) / len(xs)), "y": round(sum(ys) / len(ys)),
                        "r": r_uniform})
        (cand_dir / f"{sid}.json").write_text(json.dumps(out))

    subprocess.run([sys.executable, str(EVAL_DIR / "score.py"), str(cand_dir),
                    "--run-id", args.run_id, "--notes",
                    f"vote>={args.votes} of [{args.sources}] r{args.radius:g}"
                    + (" anchor" if args.anchor_only else ""),
                    "--meta", json.dumps({"ensemble": args.sources, "votes": args.votes,
                                          "radius": args.radius,
                                          "anchor_only": args.anchor_only})],
                   check=True)


if __name__ == "__main__":
    main()
