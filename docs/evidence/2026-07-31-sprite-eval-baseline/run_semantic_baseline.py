"""Semantic baseline: judge every shipped sprite with the calibrated backend.

    uv run --project ../../../tools/level-editor python run_semantic_baseline.py --backend <name> [--model M]

Resumable; writes semantic_<tag>.json incrementally.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
LEVELS = REPO / "docs" / "evidence" / "2026-07-31-sprite-eval-regeneration" / "baseline-corpus" / "levels"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", required=True)
    parser.add_argument("--model")
    parser.add_argument("--tag")
    args = parser.parse_args()

    from levelbuilder.api.sprite_judge import JudgeCase, make_backend

    backend = make_backend(args.backend, **({"model": args.model} if args.model else {}))
    tag = args.tag or args.backend
    out_path = HERE / f"semantic_{tag}.json"
    results = json.loads(out_path.read_text()) if out_path.exists() else {}

    todo = []
    for level_dir in sorted(p for p in LEVELS.iterdir() if (p / "level.json").exists()):
        level = json.loads((level_dir / "level.json").read_text())
        for dog in level.get("dogs", []):
            todo.append((level_dir, level, dog))

    for i, (level_dir, level, dog) in enumerate(todo):
        key = f"{level_dir.name}/{dog['id']}"
        if key in results and results[key].get("ok"):
            continue
        sprite_rel = (dog.get("sprite") or {}).get("image")
        if not sprite_rel or not (LEVELS.parent / sprite_rel).exists():
            results[key] = {"ok": False, "error": "missing sprite", "backend": backend.name}
            continue
        sprite = Image.open(LEVELS.parent / sprite_rel).convert("RGBA")
        sidecar = level_dir / "dogs" / dog["id"] / "sprite_000.json"
        painted = clean = None
        if sidecar.exists():
            x0, y0, x1, y1 = json.loads(sidecar.read_text())["sourceBox"]
            if (level_dir / "color.png").exists():
                painted = Image.open(level_dir / "color.png").convert("RGB").crop((x0, y0, x1, y1))
            if (level_dir / "bg_00.png").exists():
                clean = Image.open(level_dir / "bg_00.png").convert("RGB").crop((x0, y0, x1, y1))
        start = time.time()
        verdict = backend.judge(JudgeCase(dog_id=key, sprite=sprite, painted_crop=painted, clean_crop=clean))
        record = verdict.to_dict()
        record["seconds"] = round(time.time() - start, 1)
        results[key] = record
        out_path.write_text(json.dumps(results, indent=1))
        print(f"[{i + 1}/{len(todo)}] {key} ok={verdict.ok} subject={verdict.subject}", flush=True)
    bad = sum(1 for r in results.values() if r.get("ok") and r.get("subject", 1) < 0.5)
    failed = sum(1 for r in results.values() if not r.get("ok"))
    print(f"done: {len(results)} judged, {bad} subject<0.5, {failed} errored -> {out_path.name}")


if __name__ == "__main__":
    main()
