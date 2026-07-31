"""Free retry pass over the repaint worklist (plan U7 iterate loop).

Many flagged birds are fully painted but badly masked. Try SAM2 prompt
variants (wider box, diff-centroid point); accept a variant only when the
codex judge clears it. Survivors stay on the repaint list.

    FTD_SAM2_URL=... uv run --project ../../../tools/level-editor python retry_cutouts.py
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEFECT = 0.5


def main() -> None:
    os.environ.setdefault("LEVEL_EDITOR_GAME", "find_the_bird")
    # The winning retry alpha is passed as dog_mask; keep _save_sprite_assets
    # from re-running its own SAM2-primary pass over it.
    os.environ["FTD_SAM2_PRIMARY"] = "0"
    from levelbuilder.settings import apply_game_from_env

    apply_game_from_env()
    from levelbuilder.api import inpaint as inp
    from levelbuilder.api import session as S
    from levelbuilder.api.sprite_judge import JudgeCase, make_backend

    judge = make_backend("codex")
    worklist = json.loads((HERE / "final_repaint_worklist.json").read_text())
    out_path = HERE / "retry_results.json"
    results = json.loads(out_path.read_text()) if out_path.exists() else {}

    for i, key in enumerate(worklist):
        if key in results and results[key].get("resolved") is not None:
            continue
        level_id, dog_name = key.split("/")
        dog_dir = S.dogs_dir(level_id) / dog_name
        index = int(dog_name.split("_")[1])
        sdir = S.session_dir(level_id)
        try:
            hitboxes = json.loads((sdir / "hitboxes.json").read_text())
            hb_data = hitboxes[index]
        except (FileNotFoundError, IndexError):
            results[key] = {"resolved": False, "reason": "session state broken"}
            continue
        variant_path = next(iter(sorted(dog_dir.glob("variant_*.png"))), None)
        box = inp._load_variant_box(variant_path) if variant_path else None
        if box is None:
            results[key] = {"resolved": False, "reason": "no variant/box"}
            continue
        box = tuple(box)
        hb = inp.Hitbox(x=hb_data["x"], y=hb_data["y"], radius=hb_data.get("r", hb_data.get("radius", 30)))
        with Image.open(variant_path) as vimg:
            vimg.load()
            painted = vimg.convert("RGB").copy()
        expected = (box[2] - box[0], box[3] - box[1])
        if painted.size != expected:
            painted = painted.resize(expected, Image.LANCZOS)
        bg = Image.open(sdir / "bg_00.png").convert("RGB")
        clean_crop = bg.crop(box)
        bg.close()

        # Diff centroid as an alternative subject point.
        diff = np.abs(
            np.asarray(painted, dtype=np.int16) - np.asarray(clean_crop, dtype=np.int16)
        ).sum(axis=2) > 40
        centroid = None
        if diff.any():
            ys, xs = np.nonzero(diff)
            centroid = (float(xs.mean()), float(ys.mean()))

        attempts = [
            {"box_scale": 1.2},
            {"box_scale": 1.6},
        ]
        if centroid:
            attempts += [
                {"box_scale": 1.2, "point_override": centroid},
                {"box_scale": 1.8, "point_override": centroid},
            ]
        resolved = False
        for attempt in attempts:
            alpha = inp._sam2_sprite_alpha(painted, hb, box, relaxed=True, **attempt)
            if alpha is None:
                continue
            sprite = painted.convert("RGBA")
            sprite.putalpha(alpha)
            verdict = judge.judge(JudgeCase(
                dog_id=key, sprite=sprite.crop(alpha.getbbox()),
                painted_crop=painted, clean_crop=clean_crop,
            ))
            if verdict.ok and verdict.subject >= DEFECT and verdict.completeness >= DEFECT:
                dog_mask = alpha.point(lambda v: 255 if v > 8 else 0)
                saved = inp._save_sprite_assets(
                    dog_dir=dog_dir, variant_idx=int(variant_path.stem.split("_")[1]),
                    painted=painted, dog_mask=dog_mask, hitbox=hb, box=box,
                    clean_crop=clean_crop, prevalidated=True,
                )
                if saved is not None:
                    results[key] = {"resolved": True, "attempt": attempt,
                                    "subject": verdict.subject, "completeness": verdict.completeness}
                    resolved = True
                    break
            sprite.close()
        if not resolved:
            results.setdefault(key, {})["resolved"] = False
            results[key].setdefault("reason", "no variant cleared the judge")
        out_path.write_text(json.dumps(results, indent=1))
        print(f"[{i + 1}/{len(worklist)}] {key} resolved={results[key]['resolved']}", flush=True)

    fixed = sorted(k for k, r in results.items() if r.get("resolved"))
    still = sorted(k for k, r in results.items() if not r.get("resolved"))
    (HERE / "repaint_final.json").write_text(json.dumps(still, indent=1))
    print(f"done: {len(fixed)} fixed free, {len(still)} still need repaint -> repaint_final.json")


if __name__ == "__main__":
    main()
