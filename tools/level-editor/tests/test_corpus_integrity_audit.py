import json
from pathlib import Path


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def _level(dog_id: str = "bird-a", *, x: int = 20) -> dict:
    return {
        "width": 100,
        "height": 100,
        "dogs": [{
            "id": dog_id,
            "x": x,
            "y": 20,
            "radius": 5,
            "sprite": {
                "image": "levels/example/dogs/dog_00/sprite_000.png",
                "cleanup": {"x": 10, "y": 10, "width": 20, "height": 20},
            },
        }],
    }


def test_audit_classifies_inventory_and_never_hydrates_public_only(tmp_path):
    from levelbuilder.api.canonical_migration import audit_corpus_integrity, checksum_tree

    source = tmp_path / "source"
    public = tmp_path / "public"
    source.mkdir()
    public.mkdir()
    _write_json(source / "both" / "level.json", _level())
    _write_json(public / "both" / "level.json", _level())
    _write_json(source / "source-only" / "level.json", _level())
    _write_json(public / "public-only" / "level.json", _level())
    before = {"source": checksum_tree(source), "public": checksum_tree(public)}

    report = audit_corpus_integrity(
        source_root=source,
        public_root=public,
        lineup_ids={"both", "public-only"},
        archived_ids={"source-only"},
    )

    by_id = {entry.level_id: entry for entry in report.levels}
    assert by_id["both"].inventory_class == "source_public"
    assert by_id["both"].in_lineup is True
    assert by_id["source-only"].inventory_class == "source_only"
    assert by_id["source-only"].archived is True
    assert by_id["public-only"].inventory_class == "public_only"
    assert by_id["public-only"].status == "quarantined"
    assert [issue.code for issue in by_id["public-only"].issues] == ["projection_only_authority"]
    assert not (source / "public-only").exists()
    assert before == {"source": checksum_tree(source), "public": checksum_tree(public)}


def test_audit_reports_deterministic_divergence_and_cross_bird_cleanup(tmp_path):
    from levelbuilder.api.canonical_migration import audit_corpus_integrity

    source = tmp_path / "source"
    public = tmp_path / "public"
    _write_json(source / "broken" / "level.json", _level("bird-source"))
    public_level = _level("bird-public", x=80)
    _write_json(public / "broken" / "level.json", public_level)

    first = audit_corpus_integrity(source_root=source, public_root=public)
    second = audit_corpus_integrity(source_root=source, public_root=public)

    assert first.to_dict() == second.to_dict()
    entry = first.levels[0]
    assert entry.status == "quarantined"
    assert [issue.code for issue in entry.issues] == [
        "cross_bird_cleanup",
        "divergent_stores",
    ]
    assert entry.issues[0].evidence_paths == [str(public / "broken" / "level.json")]


def test_audit_totals_are_mutually_exclusive_and_archived_excluded_from_normal_counts(tmp_path):
    from levelbuilder.api.canonical_migration import audit_corpus_integrity

    source = tmp_path / "source"
    public = tmp_path / "public"
    _write_json(source / "migratable" / "level.json", _level())
    _write_json(source / "archived" / "level.json", _level())
    _write_json(public / "quarantined" / "level.json", _level())

    report = audit_corpus_integrity(
        source_root=source,
        public_root=public,
        archived_ids={"archived"},
    )

    assert report.totals == {"safe": 0, "migratable": 1, "quarantined": 1}
    assert report.archived_totals == {"safe": 0, "migratable": 1, "quarantined": 0}
    assert sum(report.totals.values()) == 2
    assert sum(report.archived_totals.values()) == 1
