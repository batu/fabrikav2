"""Compose + staged export pass (no re-cutting; preserves retry-rescued sprites).

    uv run --project ../../../tools/level-editor python export_pass.py
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PUBLIC = REPO / "games" / "find_the_bird" / "public" / "levels"


def main() -> None:
    os.environ.setdefault("LEVEL_EDITOR_GAME", "find_the_bird")
    from levelbuilder.settings import apply_game_from_env

    apply_game_from_env()
    from levelbuilder.api import session as S
    from levelbuilder.api.export_gate import ExportGateError
    from levelbuilder.api.inpaint import recomposite_color
    from levelbuilder.api.session import export_to_game

    results = {}
    for level_dir in sorted(p for p in PUBLIC.iterdir() if (p / "level.json").exists()):
        level_id = level_dir.name
        sdir = S.session_dir(level_id)
        if not (sdir / "hitboxes.json").exists():
            continue
        stale = sdir / "color.png"
        raw = S.load_session_raw(level_id) or {}
        if raw.get("inpaint_mode") == "magenta" and stale.exists():
            stale.rename(sdir / "color.pre-recut.png")
        try:
            recomposite_color(level_id)
            staging = HERE / "staging"
            staging.mkdir(exist_ok=True)
            export_to_game(level_id, destination_root=staging, update_preview_manifest=False)
            live = PUBLIC / level_id
            backup = live.with_name(level_id + ".pre-recut")
            if live.exists():
                live.rename(backup)
            shutil.move(str(staging / level_id), str(live))
            if backup.exists():
                shutil.rmtree(backup)
            results[level_id] = "exported"
        except ExportGateError as error:
            results[level_id] = f"refused: {'; '.join(error.violations[:2])}"
        except Exception as exc:  # noqa: BLE001
            results[level_id] = f"error: {type(exc).__name__}: {exc}"
        print(f"{level_id}: {results[level_id][:120]}", flush=True)
    (HERE / "export_pass_results.json").write_text(json.dumps(results, indent=1))
    exported = sum(1 for v in results.values() if v == "exported")
    print(f"done: {exported}/{len(results)} exported")


if __name__ == "__main__":
    main()
