"""Score candidate hitboxes against the frozen golden set (GOAL.md contract).

Usage:
    uv run python eval/score.py <candidates_dir> --run-id <id> [--notes "..."] \
        [--meta '{"model": "...", "thresholds": {...}}']

<candidates_dir> holds one <session_id>.json per level: a JSON list of either
circles {"x", "y", "r"} or boxes {"x", "y", "width", "height"} (box entries
are converted to center + r = max(w,h)/2). Missing level file = zero
candidates for that level (counts fully against recall).

Metrics (rank order per GOAL.md): recall, precision, center error, radius fit.
 - recall:    golden g is FOUND if some candidate center lies within g.r of g.
 - precision: candidate c is a TP if its center lies inside some golden circle.
 - center error: mean over one-to-one greedy matches (pairs with dist <= g.r),
   in 4096-normalized px (raw px * 4096 / level_dim).
 - radius fit: mean |c.r - g.r| / g.r over the same one-to-one matches.
Duplicates (TP candidates left over after one-to-one matching) are reported —
they don't hurt the contract metrics but flag double-boxing of one bird.

Writes eval/results/<run_id>/metrics.json and appends to eval/results/RESULTS.md.
Read-only with respect to golden data.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
GOLDEN_DIR = EVAL_DIR / "golden-hitboxes-2026-08-05"
RESULTS_DIR = EVAL_DIR / "results"
NORM = 4096.0


def load_candidates(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for c in json.loads(path.read_text()):
        if "r" in c and "width" not in c:
            out.append({"x": float(c["x"]), "y": float(c["y"]), "r": float(c["r"])})
        else:
            w, h = float(c["width"]), float(c["height"])
            out.append({
                "x": float(c["x"]) + w / 2.0,
                "y": float(c["y"]) + h / 2.0,
                "r": max(w, h) / 2.0,
            })
    return out


def score_level(golden: list[dict], cands: list[dict], dim: int) -> dict:
    scale = NORM / dim
    n_g, n_c = len(golden), len(cands)
    dist = [[math.hypot(c["x"] - g["x"], c["y"] - g["y"]) for c in cands] for g in golden]

    found = [any(dist[i][j] <= g["r"] for j in range(n_c)) for i, g in enumerate(golden)]
    tp_cand = [any(dist[i][j] <= golden[i]["r"] for i in range(n_g)) for j in range(n_c)]

    # One-to-one greedy matching over admissible pairs (dist <= g.r), nearest first.
    pairs = sorted(
        ((dist[i][j], i, j) for i in range(n_g) for j in range(n_c) if dist[i][j] <= golden[i]["r"]),
    )
    used_g: set[int] = set()
    used_c: set[int] = set()
    matches: list[tuple[int, int, float]] = []
    for d, i, j in pairs:
        if i in used_g or j in used_c:
            continue
        used_g.add(i)
        used_c.add(j)
        matches.append((i, j, d))

    center_errs = [d * scale for _, _, d in matches]
    radius_errs = [abs(cands[j]["r"] - golden[i]["r"]) / golden[i]["r"] for i, j, _ in matches]
    duplicates = sum(1 for j in range(n_c) if tp_cand[j] and j not in used_c)

    return {
        "golden": n_g,
        "candidates": n_c,
        "found": sum(found),
        "missed": [golden[i]["id"] for i in range(n_g) if not found[i]],
        "false_positives": sum(1 for t in tp_cand if not t),
        "duplicates": duplicates,
        "recall": (sum(found) / n_g) if n_g else None,
        "precision": (sum(tp_cand) / n_c) if n_c else None,
        "center_err_px4096": (sum(center_errs) / len(center_errs)) if center_errs else None,
        "radius_fit": (sum(radius_errs) / len(radius_errs)) if radius_errs else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("candidates_dir", type=Path)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--notes", default="")
    ap.add_argument("--meta", default="{}", help="JSON: model, weights hash, thresholds, timing, gpu")
    args = ap.parse_args()

    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
    per_level: dict[str, dict] = {}
    tot_g = tot_found = tot_c = tot_tp = tot_dup = 0
    all_center: list[float] = []
    all_radius: list[float] = []

    excluded: list[str] = []
    for sid, info in manifest.items():
        golden = json.loads((GOLDEN_DIR / f"{sid}.hitboxes.json").read_text())
        if not golden:
            # No ground truth (level was never hand-hitboxed, e.g. _da7e which
            # visibly contains birds) — cannot score, exclude entirely.
            excluded.append(sid)
            continue
        cands = load_candidates(args.candidates_dir / f"{sid}.json")
        lvl = score_level(golden, cands, info["dims"][0])
        per_level[sid] = lvl
        tot_g += lvl["golden"]
        tot_found += lvl["found"]
        tot_c += lvl["candidates"]
        tot_tp += lvl["candidates"] - lvl["false_positives"]
        tot_dup += lvl["duplicates"]

    # Exact aggregate center/radius means: re-walk matches per level.
    for sid, info in manifest.items():
        golden = json.loads((GOLDEN_DIR / f"{sid}.hitboxes.json").read_text())
        if not golden:
            continue
        cands = load_candidates(args.candidates_dir / f"{sid}.json")
        scale = NORM / info["dims"][0]
        dist = [[math.hypot(c["x"] - g["x"], c["y"] - g["y"]) for c in cands] for g in golden]
        pairs = sorted(
            ((dist[i][j], i, j) for i in range(len(golden)) for j in range(len(cands))
             if dist[i][j] <= golden[i]["r"]),
        )
        used_g: set[int] = set()
        used_c: set[int] = set()
        for d, i, j in pairs:
            if i in used_g or j in used_c:
                continue
            used_g.add(i)
            used_c.add(j)
            all_center.append(d * scale)
            all_radius.append(abs(cands[j]["r"] - golden[i]["r"]) / golden[i]["r"])

    summary = {
        "run_id": args.run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "notes": args.notes,
        "meta": json.loads(args.meta),
        "golden_total": tot_g,
        "candidates_total": tot_c,
        "recall": tot_found / tot_g if tot_g else None,
        "precision": tot_tp / tot_c if tot_c else None,
        "center_err_px4096": sum(all_center) / len(all_center) if all_center else None,
        "radius_fit": sum(all_radius) / len(all_radius) if all_radius else None,
        "duplicates": tot_dup,
        "excluded_unlabeled": excluded,
        "per_level": per_level,
    }

    out_dir = RESULTS_DIR / args.run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "metrics.json").write_text(json.dumps(summary, indent=2))

    results_md = RESULTS_DIR / "RESULTS.md"
    if not results_md.exists():
        results_md.write_text(
            "# Hitbox Hillclimb Results\n\n"
            "Golden: 22 levels / 412 hitboxes (`golden-hitboxes-2026-08-05`). "
            "Target: recall >=0.97, precision >=0.95, center err <=25px(4096), $0, <30s/level.\n\n"
            "| run | recall | precision | center px | radius fit | dup | cands | notes |\n"
            "|---|---|---|---|---|---|---|---|\n"
        )
    r = summary

    def fmt(v, p=4):
        return "-" if v is None else f"{v:.{p}f}"

    with results_md.open("a") as f:
        f.write(
            f"| {r['run_id']} | {fmt(r['recall'])} | {fmt(r['precision'])} | "
            f"{fmt(r['center_err_px4096'], 1)} | {fmt(r['radius_fit'], 3)} | "
            f"{r['duplicates']} | {r['candidates_total']} | {r['notes']} |\n"
        )

    print(json.dumps({k: summary[k] for k in
                      ("run_id", "recall", "precision", "center_err_px4096",
                       "radius_fit", "duplicates", "candidates_total")}, indent=2))
    worst = sorted(
        ((sid, lvl) for sid, lvl in per_level.items() if lvl["golden"]),
        key=lambda kv: (kv[1]["recall"], -(kv[1]["false_positives"])),
    )[:5]
    for sid, lvl in worst:
        print(f"  worst: {sid} recall={lvl['recall']:.2f} fp={lvl['false_positives']} "
              f"cands={lvl['candidates']}/{lvl['golden']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
