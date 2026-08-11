from __future__ import annotations

import hashlib
import json
from pathlib import Path

from levelbuilder.api.integrity_audit import audit_level_inventory


def _tree_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _source(root: Path, level_id: str, *, canonical_pointer: str | None = None) -> Path:
    level = root / level_id
    level.mkdir(parents=True)
    (level / "session.json").write_text(json.dumps({"id": level_id, "dogs": []}))
    if canonical_pointer is not None:
        canonical = level / ".canonical"
        canonical.mkdir()
        (canonical / "current.json").write_text(canonical_pointer)
    return level


def _public(root: Path, level_id: str) -> Path:
    level = root / level_id
    level.mkdir(parents=True)
    (level / "level.json").write_text(json.dumps({"id": level_id, "dogs": []}))
    return level


def test_audit_classifies_all_inventory_without_writes(tmp_path: Path) -> None:
    source = tmp_path / "source"
    public = tmp_path / "public"
    _source(source, "source_only")
    _public(public, "public_only")
    _source(source, "shadowed", canonical_pointer="not-json")
    _public(public, "shadowed")
    _source(source, "archived")

    before = _tree_hash(tmp_path)
    report = audit_level_inventory(
        source_root=source,
        public_root=public,
        lineup_ids=["shadowed", "public_only"],
        archived_ids={"archived"},
        inspect_legacy=False,
    )
    assert _tree_hash(tmp_path) == before

    by_id = {level.level_id: level for level in report.levels}
    assert by_id["source_only"].inventory == "source_only"
    assert by_id["source_only"].status == "migratable"
    assert "migration_required" in by_id["source_only"].issue_codes
    assert by_id["public_only"].inventory == "public_only"
    assert by_id["public_only"].status == "frozen_legacy"
    assert "public_only_frozen" in by_id["public_only"].issue_codes
    assert by_id["shadowed"].status == "quarantined"
    assert "canonical_integrity" in by_id["shadowed"].issue_codes
    assert "shadowed_projection_conflict" in by_id["shadowed"].issue_codes
    assert by_id["archived"].archived is True
    assert by_id["archived"].lineup is False


def test_archived_and_lineup_are_metadata_not_inventory_authority(tmp_path: Path) -> None:
    source = tmp_path / "source"
    public = tmp_path / "public"
    _source(source, "same")
    _public(public, "same")

    report = audit_level_inventory(
        source_root=source,
        public_root=public,
        lineup_ids=["same"],
        archived_ids={"same"},
        inspect_legacy=False,
    )
    level = report.levels[0]
    assert level.inventory == "source_and_public"
    assert level.archived is True
    assert level.lineup is True
    assert "archived_in_lineup" in level.issue_codes
    assert level.status == "quarantined"
