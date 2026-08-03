"""AE2: the export gate refuses invalid packages before manifests move."""

import json
import shutil
from pathlib import Path

import pytest

from levelbuilder.api.export_gate import ExportGateError, validate_corpus, validate_level_dir

FIXTURE = Path(__file__).parent / "fixtures" / "level-valid.json"


def _corpus_with_level(tmp_path: Path, level: dict) -> Path:
    root = tmp_path / "public" / "levels"
    level_dir = root / level["id"]
    level_dir.mkdir(parents=True)
    (level_dir / "level.json").write_text(json.dumps(level))
    return root


def _valid_level() -> dict:
    return json.loads(FIXTURE.read_text())


def test_valid_level_passes(tmp_path: Path) -> None:
    root = _corpus_with_level(tmp_path, _valid_level())
    # Schema/geometry check only: the JSON fixture has no sprite files on disk,
    # which the sprite-quality gate would (correctly) refuse at real export time.
    validate_level_dir(root, _valid_level()["id"], sprite_quality=False)


def test_out_of_bounds_hitbox_refused_and_named(tmp_path: Path) -> None:
    level = _valid_level()
    level["dogs"][0]["x"] = level["width"] + 500  # push hitbox past the image
    root = _corpus_with_level(tmp_path, level)
    with pytest.raises(ExportGateError) as excinfo:
        validate_level_dir(root, level["id"])
    assert "geometry" in str(excinfo.value)


def test_schema_garbage_refused(tmp_path: Path) -> None:
    root = tmp_path / "public" / "levels"
    (root / "broken").mkdir(parents=True)
    (root / "broken" / "level.json").write_text("{not json")
    with pytest.raises(ExportGateError):
        validate_level_dir(root, "broken")


def test_missing_level_json_refused(tmp_path: Path) -> None:
    root = tmp_path / "public" / "levels"
    (root / "empty").mkdir(parents=True)
    with pytest.raises(ExportGateError):
        validate_level_dir(root, "empty")


def test_corpus_empty_ok_and_no_levels_index_needed(tmp_path: Path) -> None:
    root = tmp_path / "public" / "levels"
    root.mkdir(parents=True)
    summary = validate_corpus(root)
    assert summary == {"levels": 0, "catalogChecked": False}


def test_corpus_fails_on_bad_level(tmp_path: Path) -> None:
    level = _valid_level()
    level["dogs"][0]["y"] = -99999
    root = _corpus_with_level(tmp_path, level)
    with pytest.raises(ExportGateError):
        validate_corpus(root)


def test_sprite_quality_gate_refuses_failing_level(tmp_path, monkeypatch):
    """A schema-valid package with a background-leak sprite is refused (U8 gate)."""
    import json
    from PIL import Image
    from levelbuilder.api.export_gate import ExportGateError, validate_level_dir, _sprite_quality_violations

    lv = tmp_path / "levels" / "bad_level"
    (lv / "dogs" / "dog_00").mkdir(parents=True)
    clean = Image.new("RGB", (120, 120), (100, 100, 100))
    clean.save(lv / "bg_00.png")
    clean.save(lv / "color.png")  # nothing painted: sprite is pure background leak
    Image.new("RGBA", (40, 40), (200, 40, 40, 255)).save(lv / "dogs" / "dog_00" / "sprite_000.png")
    (lv / "level.json").write_text(json.dumps({
        "id": "bad_level", "width": 120, "height": 120,
        "dogs": [{"id": "dog_00", "x": 50, "y": 50, "r": 20, "sprite": {
            "image": "levels/bad_level/dogs/dog_00/sprite_000.png",
            "x": 30, "y": 30, "width": 40, "height": 40,
            "cleanup": {"x": 28, "y": 28, "width": 44, "height": 44},
            "anchorX": 0.5, "anchorY": 0.5}}],
    }))
    # Opt-in since 2026-08-03 (paint-first compositing is the shipped policy;
    # these axes assume sprite-only composites).
    assert _sprite_quality_violations(lv) == []
    monkeypatch.setenv("FTD_SPRITE_QUALITY_GATE", "1")
    violations = _sprite_quality_violations(lv)
    assert any("exclusion" in v for v in violations)
