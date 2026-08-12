"""FF-5: retained formats load strictly — missing is None/empty (legitimate),
present-but-invalid raises instead of silently collapsing to a default."""
import json

import pytest


@pytest.fixture
def public_dir(tmp_path):
    return tmp_path


def test_bundled_manifest_missing_is_none_invalid_is_loud(public_dir):
    from levelbuilder.api import public_levels as P

    assert P.load_bundled_manifest(public_dir) is None
    (public_dir / "bundled-manifest.json").write_text("not json {")
    with pytest.raises(P.FormatError, match="bundled-manifest"):
        P.load_bundled_manifest(public_dir)
    (public_dir / "bundled-manifest.json").write_text(json.dumps(["not", "a", "dict"]))
    with pytest.raises(P.FormatError, match="bundled-manifest"):
        P.load_bundled_manifest(public_dir)
    (public_dir / "bundled-manifest.json").write_text(json.dumps({"version": 99, "levels": []}))
    with pytest.raises(P.FormatError, match="version"):
        P.load_bundled_manifest(public_dir)
    (public_dir / "bundled-manifest.json").write_text(json.dumps({"version": 1, "levels": []}))
    assert P.load_bundled_manifest(public_dir) == {"version": 1, "levels": []}


def test_catalog_manifest_missing_is_none_invalid_is_loud(public_dir):
    from levelbuilder.api import public_levels as P

    assert P.load_catalog_manifest(public_dir) is None
    (public_dir / "catalog-manifest.json").write_text("{broken")
    with pytest.raises(P.FormatError, match="catalog-manifest"):
        P.load_catalog_manifest(public_dir)
    (public_dir / "catalog-manifest.json").write_text(json.dumps({"version": 1, "levels": []}))
    assert P.load_catalog_manifest(public_dir)["version"] == 1


def test_levels_index_missing_is_empty_invalid_is_loud(public_dir):
    from levelbuilder.api import public_levels as P

    assert P.load_levels_index(public_dir) == []
    (public_dir / "levels-index.json").write_text(json.dumps({"not": "a list"}))
    with pytest.raises(P.FormatError, match="levels-index"):
        P.load_levels_index(public_dir)
    (public_dir / "levels-index.json").write_text(json.dumps([{"id": "a", "name": "A"}]))
    assert P.load_levels_index(public_dir) == [{"id": "a", "name": "A"}]


def test_archive_ledger_missing_is_empty_corrupt_is_loud(tmp_path, monkeypatch):
    from levelbuilder.api import session as S

    monkeypatch.setattr(S, "ARCHIVE_LEDGER_PATH", tmp_path / "state" / "archive-ledger.json")
    assert S._load_archive_ledger() == {}
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "archive-ledger.json").write_text("corrupt{")
    with pytest.raises(S.PublicLevels.FormatError, match="archive-ledger"):
        S._load_archive_ledger()
    (tmp_path / "state" / "archive-ledger.json").write_text(
        json.dumps({"version": 1, "sessions": {"x": {"archived": True}}})
    )
    assert S._load_archive_ledger() == {"x": {"archived": True}}
