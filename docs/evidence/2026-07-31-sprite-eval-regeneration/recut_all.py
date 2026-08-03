"""Re-cut every shipped level's sprites with the SAM2-primary ladder, then
sprite-only recomposite and re-export through the quality gate (plan U8).

No provider image spend: paint stays as-is; only cutouts, composites, and
packages are rebuilt. Birds whose paint contains no bird (the eval's job to
catch) are collected into repaint_needed.json for `regenerate --dog`.

    FTD_SAM2_URL=http://localhost:8977 uv run --project ../../../tools/level-editor \
        python recut_all.py [--level ID ...]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PUBLIC = REPO / "games" / "find_the_bird" / "public" / "levels"


def recut_level(session_id: str) -> dict:
    from levelbuilder.api import inpaint as inp
    from levelbuilder.api import session as S

    sdir = S.session_dir(session_id)
    hitboxes = json.loads((sdir / "hitboxes.json").read_text())
    raw = S.load_session_raw(session_id) or {}
    dogs_meta = {d.get("index"): d for d in raw.get("dogs", []) if isinstance(d, dict)}
    with Image.open(sdir / "bg_00.png") as bg_src:
        bg_src.load()
        bg = bg_src.convert("RGB").copy()

    results = {"levelId": session_id, "recut": 0, "failed": [], "skipped": []}
    for i, hb_data in enumerate(hitboxes):
        dog_dir = S.dogs_dir(session_id) / f"dog_{i:02d}"
        meta = dogs_meta.get(i) or {}
        variant_idx = meta.get("activeVariant", 0) or 0
        variant_path = dog_dir / f"variant_{variant_idx:03d}.png"
        if not variant_path.exists():
            results["skipped"].append(f"dog_{i:02d}: no variant")
            continue
        box = inp._load_variant_box(variant_path)
        if box is None:
            results["skipped"].append(f"dog_{i:02d}: no box sidecar")
            continue
        box = tuple(box)
        hb = inp.Hitbox(
            x=hb_data["x"], y=hb_data["y"],
            radius=hb_data.get("r", hb_data.get("radius", 30)),
        )
        with Image.open(variant_path) as vimg:
            vimg.load()
            painted = vimg.convert("RGB").copy()
        expected = (box[2] - box[0], box[3] - box[1])
        if painted.size != expected:
            painted = painted.resize(expected, Image.LANCZOS)
        clean_crop = bg.crop(box)
        dog_mask = inp._extract_dog_pixels(clean_crop, painted, threshold=30)
        saved = inp._save_sprite_assets(
            dog_dir=dog_dir, variant_idx=variant_idx, painted=painted,
            dog_mask=dog_mask, hitbox=hb, box=box, clean_crop=clean_crop,
        )
        if saved is None:
            results["failed"].append(f"dog_{i:02d}")
        else:
            results["recut"] += 1
        painted.close()
        clean_crop.close()
    bg.close()

    if not results["failed"]:
        import shutil

        from levelbuilder.api.inpaint import recomposite_color
        from levelbuilder.api.session import export_to_game

        # Full recut: every sprite was rebuilt, so the composite base must be
        # the clean background. Legacy magenta sessions otherwise reuse the old
        # broad-pasted color.png, whose stray paint survives outside the new
        # cleanup boxes and fails the coherence gate.
        stale_color = sdir / "color.png"
        if stale_color.exists():
            stale_color.rename(sdir / "color.pre-recut.png")
        recomposite_color(session_id)

        # Stage the export: the gate's fail-closed removal must never touch the
        # live corpus (10 shipped levels exist only on disk, not in git).
        from levelbuilder.api.export_gate import ExportGateError

        staging = HERE / "staging"
        staging.mkdir(exist_ok=True)
        try:
            export_to_game(session_id, destination_root=staging, update_preview_manifest=False)
        except ExportGateError as error:
            # Cutouts are fine geometrically but the paint itself is wrong for
            # these dogs (non-bird content). Keep the old live package; queue
            # the dogs for provider repaint.
            results["failed"] = sorted({
                v.split()[2] for v in error.violations if v.startswith("sprite quality:")
            })
            results["gateRefusal"] = error.violations
            results["exported"] = False
            return results
        live = PUBLIC / session_id
        backup = live.with_name(session_id + ".pre-recut")
        if live.exists():
            live.rename(backup)
        shutil.move(str(staging / session_id), str(live))
        if backup.exists():
            shutil.rmtree(backup)
        results["exported"] = True
    else:
        results["exported"] = False
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", action="append")
    args = parser.parse_args()
    if not os.environ.get("FTD_SAM2_URL"):
        print("FTD_SAM2_URL not set — SAM2-primary would silently fall back", file=sys.stderr)
        sys.exit(2)
    os.environ.setdefault("LEVEL_EDITOR_GAME", "find_the_bird")
    from levelbuilder.settings import apply_game_from_env

    apply_game_from_env()  # must run before the api modules import their roots
    level_ids = args.level or sorted(
        p.name for p in PUBLIC.iterdir() if (p / "level.json").exists()
    )
    out_path = HERE / "recut_results.json"
    all_results = json.loads(out_path.read_text()) if out_path.exists() else {}
    repaint: dict[str, list[str]] = {}
    for level_id in level_ids:
        if all_results.get(level_id, {}).get("exported"):
            continue
        start = time.time()
        try:
            result = recut_level(level_id)
        except Exception as exc:  # noqa: BLE001 — keep the batch going, record faithfully
            result = {"levelId": level_id, "error": f"{type(exc).__name__}: {exc}", "exported": False}
        result["seconds"] = round(time.time() - start, 1)
        all_results[level_id] = result
        if result.get("failed"):
            repaint[level_id] = result["failed"]
        out_path.write_text(json.dumps(all_results, indent=1))
        print(f"{level_id}: recut={result.get('recut')} failed={result.get('failed')} "
              f"exported={result.get('exported')} ({result['seconds']}s)", flush=True)
    if repaint:
        (HERE / "repaint_needed.json").write_text(json.dumps(repaint, indent=1))
    print(f"done: {sum(1 for r in all_results.values() if r.get('exported'))} exported, "
          f"{len(repaint)} levels need repaints")


if __name__ == "__main__":
    main()
