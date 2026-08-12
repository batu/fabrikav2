import json


def _asset(path: str, char: str) -> dict:
    return {"path": path, "sha256": char * 64, "bytes": 1}


def _snapshot(level_id: str) -> dict:
    scene = _asset("color.png", "a")
    sprite = _asset("dogs/dog_00/sprite_000.png", "c")
    return {
        "schemaVersion": 1,
        "sessionId": level_id,
        "assets": {"scene": scene, "cleanBackground": _asset("bg_00.png", "b")},
        "restore": {"asset": _asset("restore.png", "d"), "sourceSceneSha256": scene["sha256"]},
        "birds": [{
            "birdId": "018f4f34-cc65-7c21-b59d-9b44c8c02a33",
            "compatibilitySlot": "dog_00",
            "presentationOrder": 0,
            "hitbox": {"x": 10, "y": 10, "r": 3},
            "activeGeneration": {"generationId": "g1", "inputSceneSha256": scene["sha256"]},
            "sprite": {
                "asset": sprite,
                "placement": {"x": 5, "y": 5, "width": 10, "height": 10},
                "anchorX": 0.5, "anchorY": 0.5, "flipX": False, "flipY": False,
            },
            "cleanup": {"x": 4, "y": 4, "width": 12, "height": 12, "sourceSpriteSha256": sprite["sha256"]},
        }],
        "reviews": {},
        "operational": {},
    }


def test_sequence_diagnostics_block_legacy_quarantined_and_unreviewed(monkeypatch, tmp_path):
    from levelbuilder.api import sequence_workflow
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore

    levels = tmp_path / "levels"
    monkeypatch.setattr(sequence_workflow.S, "LEVELS_DIR", levels)
    quarantine = levels / "quarantined" / ".canonical"
    quarantine.mkdir(parents=True)
    (quarantine / "quarantine.json").write_text(json.dumps({"issues": ["bird_id_set_mismatch"]}))
    from conftest import materialize_snapshot_assets
    unreviewed = _snapshot("unreviewed")
    materialize_snapshot_assets(levels / "unreviewed", unreviewed)
    CanonicalRevisionStore(levels / "unreviewed").commit(
        unreviewed, expected_content_revision=None,
    )
    reviewed_store = CanonicalRevisionStore(levels / "reviewed")
    reviewed = _snapshot("reviewed")
    materialize_snapshot_assets(levels / "reviewed", reviewed)
    pointer = reviewed_store.commit(reviewed, expected_content_revision=None)
    reviewed["reviews"] = {
        kind: {
            "contentRevision": pointer.content_revision,
            "reviewer": "human:test",
            "reviewedAt": "2026-08-11T00:00:00Z",
        }
        for kind in ("hitboxes", "finalCutouts")
    }
    reviewed_store.commit(reviewed, expected_content_revision=pointer.content_revision)

    diagnostics = sequence_workflow._artifact_integrity_diagnostics([
        "legacy", "quarantined", "unreviewed",
    ])

    assert [item["code"] for item in diagnostics] == [
        "levelAuthoringMigrationRequired",
        "levelAuthoringQuarantined",
        "levelAuthoringReviewRequired",
    ]
    assert all(item["blocking"] for item in diagnostics)
    assert sequence_workflow._artifact_integrity_diagnostics(["reviewed"]) == []


def test_stale_catalog_revision_blocks_start(monkeypatch, tmp_path):
    """P2b.1 (F-B#2, the ship-risk class): a catalog entry bound to an older
    authoring revision than the currently reviewed one is a blocking
    diagnostic — the catalog can never ship revision A while reviews bless B."""
    from levelbuilder.api import sequence_workflow
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore, bless_snapshot
    from conftest import materialize_snapshot_assets

    levels = tmp_path / "levels"
    monkeypatch.setattr(sequence_workflow.S, "LEVELS_DIR", levels)
    store = CanonicalRevisionStore(levels / "stale_bound")
    snapshot = _snapshot("stale_bound")
    materialize_snapshot_assets(levels / "stale_bound", snapshot)
    pointer = store.commit(snapshot, expected_content_revision=None)
    old_revision = pointer.content_revision
    # Content changes after the catalog bound old_revision…
    snapshot = store.read().snapshot
    snapshot["birds"][0]["hitbox"]["x"] += 7
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)
    # …and the operator re-reviews the NEW revision.
    for kind in ("hitboxes", "finalCutouts"):
        snapshot = bless_snapshot(store.read().snapshot, review_kind=kind, reviewer="human:t", reviewed_at="now")
        pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)

    entries = {"stale_bound": {"id": "stale_bound", "contentRevision": old_revision}}
    monkeypatch.setattr(sequence_workflow, "_catalog_entries_by_id", lambda: entries, raising=False)
    diagnostics = sequence_workflow._artifact_integrity_diagnostics(["stale_bound"])
    stale = [d for d in diagnostics if d.get("code") == "catalog_revision_stale"]
    assert stale and stale[0]["blocking"] is True

    entries["stale_bound"]["contentRevision"] = pointer.content_revision
    diagnostics = sequence_workflow._artifact_integrity_diagnostics(["stale_bound"])
    assert not [d for d in diagnostics if d.get("code") == "catalog_revision_stale"]
