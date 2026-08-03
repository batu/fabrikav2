"""Codex semantic sweep over the RECUT session sprites (plan U8 per-bird gate).

Judges every dog's freshly recut sprite in its authoring session (the future
corpus), producing the definitive repaint worklist. Resumable.

    uv run --project ../../../tools/level-editor python judge_recut.py
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PUBLIC = REPO / "games" / "find_the_bird" / "public" / "levels"
DEFECT = 0.5


def main() -> None:
    os.environ.setdefault("LEVEL_EDITOR_GAME", "find_the_bird")
    from levelbuilder.settings import apply_game_from_env

    apply_game_from_env()
    from levelbuilder.api import session as S
    from levelbuilder.api.sprite_judge import JudgeCase, make_backend

    backend = make_backend("codex")
    out_path = HERE / "judge_recut_results.json"
    results = json.loads(out_path.read_text()) if out_path.exists() else {}

    level_ids = sorted(p.name for p in PUBLIC.iterdir() if (p / "level.json").exists())
    todo = []
    for level_id in level_ids:
        sdir = S.session_dir(level_id)
        if not (sdir / "hitboxes.json").exists():
            continue
        for dog_dir in sorted((S.dogs_dir(level_id)).glob("dog_*")):
            meta_path = next(iter(sorted(dog_dir.glob("sprite_*.json"))), None)
            if meta_path:
                todo.append((level_id, dog_dir, meta_path))

    for i, (level_id, dog_dir, meta_path) in enumerate(todo):
        key = f"{level_id}/{dog_dir.name}"
        if key in results and results[key].get("ok"):
            continue
        meta = json.loads(meta_path.read_text())
        sdir = S.session_dir(level_id)
        sprite = Image.open(dog_dir / Path(meta["image"]).name).convert("RGBA")
        x0, y0, x1, y1 = meta["sourceBox"]
        painted = clean = None
        variant_path = dog_dir / Path(meta["sourceVariant"]).name
        if variant_path.exists():
            painted = Image.open(variant_path).convert("RGB")
        if (sdir / "bg_00.png").exists():
            clean = Image.open(sdir / "bg_00.png").convert("RGB").crop((x0, y0, x1, y1))
        start = time.time()
        verdict = backend.judge(JudgeCase(dog_id=key, sprite=sprite, painted_crop=painted, clean_crop=clean))
        record = verdict.to_dict()
        record["seconds"] = round(time.time() - start, 1)
        results[key] = record
        out_path.write_text(json.dumps(results, indent=1))
        print(f"[{i + 1}/{len(todo)}] {key} subject={verdict.subject} "
              f"completeness={verdict.completeness} ok={verdict.ok}", flush=True)

    bad = sorted(k for k, r in results.items()
                 if r.get("ok") and (r["subject"] < DEFECT or r["completeness"] < DEFECT))
    (HERE / "semantic_repaint_list.json").write_text(json.dumps(bad, indent=1))
    print(f"done: {len(results)} judged, {len(bad)} semantic repaints -> semantic_repaint_list.json")


if __name__ == "__main__":
    main()
