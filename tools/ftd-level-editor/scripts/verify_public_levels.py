#!/usr/bin/env python3
"""Validate the committed FTD public corpus against target-owned contracts."""

from __future__ import annotations

import json
from pathlib import Path

from ftd_editor.publishing.catalog import validate_catalog
from ftd_editor.publishing.level_schema import LevelFileV1, validate_level_geometry


ROOT = Path(__file__).resolve().parents[3]
LEVELS = ROOT / "games/find_the_dog/public/levels"


def main() -> int:
    level_paths = sorted(LEVELS.glob("*/level.json"))
    if not level_paths:
        raise SystemExit("no committed public levels found")
    for path in level_paths:
        level = LevelFileV1.model_validate_json(path.read_bytes())
        native_path = path.parent / "native" / "level.json"
        native = (
            LevelFileV1.model_validate_json(native_path.read_bytes())
            if native_path.exists()
            else None
        )
        validate_level_geometry(level, native=native)
    catalog_path = LEVELS / "catalog-manifest.json"
    validate_catalog(json.loads(catalog_path.read_text()))
    index_path = LEVELS / "levels-index.json"
    if not index_path.exists():
        raise SystemExit(
            "levels-index.json remains required by create-game until all consumer gates migrate"
        )
    print(f"validated {len(level_paths)} level packages, catalog, and retained levels-index")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
