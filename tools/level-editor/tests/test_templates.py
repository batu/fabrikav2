import json
from pathlib import Path

from levelbuilder.templates import SEED_TEMPLATES, load_templates


def test_seeds_served_without_workspace_file(tmp_path: Path) -> None:
    templates = load_templates(tmp_path)
    assert {t["id"] for t in templates} == {t["id"] for t in SEED_TEMPLATES}


def test_workspace_adds_and_overrides_by_id(tmp_path: Path) -> None:
    extra = {
        "id": "custom-1", "label": "Custom", "view": "isometric", "style": "lineart",
        "entity": "bird", "setting": "japan", "scene": "japan_morning_market",
        "model": "google/gemini-3.1-flash-image-preview", "nDogs": 5,
    }
    override = dict(SEED_TEMPLATES[0], label="Overridden")
    (tmp_path / "templates.json").write_text(json.dumps([extra, override]))
    templates = {t["id"]: t for t in load_templates(tmp_path)}
    assert templates["custom-1"]["nDogs"] == 5
    assert templates[SEED_TEMPLATES[0]["id"]]["label"] == "Overridden"


def test_malformed_workspace_file_serves_seeds(tmp_path: Path) -> None:
    (tmp_path / "templates.json").write_text("{broken")
    templates = load_templates(tmp_path)
    assert {t["id"] for t in templates} == {t["id"] for t in SEED_TEMPLATES}


def test_config_endpoint_serves_templates(app_client) -> None:
    config = app_client.get("/api/config").json()
    ids = {t["id"] for t in config["templates"]}
    assert "ftb-cardboard-forest" in ids and "stb-lineart" in ids
