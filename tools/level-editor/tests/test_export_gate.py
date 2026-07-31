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
    validate_level_dir(root, _valid_level()["id"])


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
