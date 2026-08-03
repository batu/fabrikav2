"""Calibration driver for the sprite judge (plan 2026-07-31-002 U4).

Selects a stratified case set from the shipped corpus, then runs one judge
backend over it (resumable). Run per backend:

    uv run --project tools/level-editor python run_calibration.py select
    uv run --project tools/level-editor python run_calibration.py run --backend ollama
    uv run --project tools/level-editor python run_calibration.py run --backend codex
    uv run --project tools/level-editor python run_calibration.py run --backend openrouter --model google/gemini-2.5-flash --tag openrouter-flash
    uv run --project tools/level-editor python run_calibration.py run --backend openrouter --model google/gemini-2.5-pro --tag gold
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
LEVELS = REPO / "games" / "find_the_bird" / "public" / "levels"
CASES = HERE / "cases.json"
PANELS = HERE / "panels"
TARGET = 60


def _levels():
    return sorted(p for p in LEVELS.iterdir() if (p / "level.json").exists())


def select() -> None:
    from levelbuilder.api.sprite_eval import evaluate_level_dir

    rng = random.Random(2026)
    picked = []
    for level_dir in _levels():
        report = evaluate_level_dir(level_dir)
        fails, passes = [], []
        for bird in report["birds"]:
            axes = bird.get("axes", {})
            excl = axes.get("exclusion", {})
            entry = {
                "level": level_dir.name,
                "dogId": bird["dogId"],
                "exclusionVerdict": excl.get("verdict"),
                "coherenceVerdict": axes.get("coherence", {}).get("verdict"),
            }
            (fails if excl.get("verdict") == "fail" else passes).append(entry)
        picked.extend(fails)  # every deterministic failure is a candidate defect
        picked.extend(rng.sample(passes, min(2, len(passes))))
    rng.shuffle(picked)
    picked = picked[:TARGET]
    CASES.write_text(json.dumps(picked, indent=1))
    print(f"selected {len(picked)} cases "
          f"({sum(1 for c in picked if c['exclusionVerdict'] == 'fail')} deterministic-fail)")


def _build_case(entry: dict):
    from levelbuilder.api.sprite_judge import JudgeCase

    level_dir = LEVELS / entry["level"]
    level = json.loads((level_dir / "level.json").read_text())
    dog = next(d for d in level["dogs"] if d["id"] == entry["dogId"])
    sprite_rel = dog["sprite"]["image"]
    sprite = Image.open(LEVELS.parent / sprite_rel).convert("RGBA")
    sidecar = (level_dir / "dogs" / dog["id"] / "sprite_000.json")
    box = json.loads(sidecar.read_text())["sourceBox"] if sidecar.exists() else None
    painted = clean = None
    if box:
        x0, y0, x1, y1 = box
        scene_path = level_dir / "color.png"
        clean_path = level_dir / "bg_00.png"
        if scene_path.exists():
            painted = Image.open(scene_path).convert("RGB").crop((x0, y0, x1, y1))
        if clean_path.exists():
            clean = Image.open(clean_path).convert("RGB").crop((x0, y0, x1, y1))
    return JudgeCase(
        dog_id=f"{entry['level']}/{entry['dogId']}",
        sprite=sprite, painted_crop=painted, clean_crop=clean,
    )


def run(backend_name: str, model: str | None, tag: str) -> None:
    from levelbuilder.api.sprite_judge import build_judge_panel, make_backend

    kwargs = {"model": model} if model else {}
    backend = make_backend(backend_name, **kwargs)
    out_path = HERE / f"results_{tag}.json"
    results = json.loads(out_path.read_text()) if out_path.exists() else {}
    entries = json.loads(CASES.read_text())
    PANELS.mkdir(exist_ok=True)
    for i, entry in enumerate(entries):
        key = f"{entry['level']}/{entry['dogId']}"
        if key in results and results[key].get("ok"):
            continue
        case = _build_case(entry)
        panel_path = PANELS / f"{entry['level']}__{entry['dogId']}.png"
        if not panel_path.exists():
            build_judge_panel(case).save(panel_path)
        start = time.time()
        verdict = backend.judge(case)
        record = verdict.to_dict()
        record["seconds"] = round(time.time() - start, 1)
        results[key] = record
        out_path.write_text(json.dumps(results, indent=1))
        print(f"[{i + 1}/{len(entries)}] {key} ok={verdict.ok} "
              f"subject={verdict.subject} completeness={verdict.completeness} "
              f"({record['seconds']}s)", flush=True)
    failed = sum(1 for r in results.values() if not r.get("ok"))
    print(f"done: {len(results)} results, {failed} failed -> {out_path.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("select")
    runp = sub.add_parser("run")
    runp.add_argument("--backend", required=True)
    runp.add_argument("--model")
    runp.add_argument("--tag")
    args = parser.parse_args()
    if args.cmd == "select":
        select()
    else:
        run(args.backend, args.model, args.tag or args.backend)


if __name__ == "__main__":
    sys.exit(main())
