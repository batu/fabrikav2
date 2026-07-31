"""Recipe templates: one pick sets every generation axis (R6/KTD7).

Seeds ship with the tool; a workspace `templates.json` (list of template
objects) merges over them by id, so new templates are data, not code.
Templates are conveniences, not authority: a malformed workspace file logs a
warning and the seeds still serve (fail-open by design — exports stay
fail-closed via the gate)."""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger("levelbuilder.templates")

SEED_TEMPLATES: list[dict] = [
    {
        "id": "ftb-cardboard-forest",
        "label": "Find the Bird — Bold Cardboard (forest pilot)",
        "view": "isometric_close_20",
        "style": "bold_cardboard",
        "entity": "bird",
        "setting": "fairytale_forest",
        "scene": "fairytale_forest_mushroom_cottage_glade",
        "model": "google/gemini-3.1-flash-image-preview",
        "nDogs": 20,
    },
    {
        "id": "ftb-cardboard-market",
        "label": "Find the Bird — Bold Cardboard (market pilot)",
        "view": "isometric_close_20",
        "style": "bold_cardboard",
        "entity": "bird",
        "setting": "japan",
        "scene": "japan_morning_market",
        "model": "google/gemini-3.1-flash-image-preview",
        "nDogs": 20,
    },
    {
        "id": "stb-lineart",
        "label": "Spot The Bird — Line Art",
        "view": "isometric",
        "style": "lineart",
        "entity": "bird",
        "setting": "japan",
        "scene": "japan_morning_market",
        "model": "google/gemini-3.1-flash-image-preview",
        "nDogs": 15,
    },
]

_REQUIRED_KEYS = {"id", "label", "view", "style", "entity", "setting", "scene", "model"}


def load_templates(workspace_root: Path) -> list[dict]:
    merged: dict[str, dict] = {t["id"]: t for t in SEED_TEMPLATES}
    path = workspace_root / "templates.json"
    if path.is_file():
        try:
            entries = json.loads(path.read_text())
            if not isinstance(entries, list):
                raise ValueError("templates.json must be a JSON list")
            for entry in entries:
                missing = _REQUIRED_KEYS - set(entry)
                if missing:
                    raise ValueError(f"template {entry.get('id')!r} missing keys: {sorted(missing)}")
                merged[entry["id"]] = entry
        except Exception as error:
            logger.warning("ignoring malformed %s: %s", path, error)
    return list(merged.values())
