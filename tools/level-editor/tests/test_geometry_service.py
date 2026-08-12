"""P1.6: one CAS-aware service for every geometry mutation. Typed operations,
no-op saves preserve approvals (P2e.3), machine lanes refuse human-origin
geometry without itemized consent (R7), add/delete are real bird create/delete
(CL-3)."""
import pytest

from test_canonical_hitbox_cas import _canonical_session


def _bless(store, pointer, kind="hitboxes"):
    from levelbuilder.api.canonical_bird_contract import bless_snapshot

    snapshot = bless_snapshot(store.read().snapshot, review_kind=kind, reviewer="human:t", reviewed_at="now")
    return store.commit(snapshot, expected_content_revision=pointer.content_revision)


def test_identical_move_is_noop_preserving_reviews(isolated_session):
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_noop")
    pointer = _bless(store, pointer)
    same = [{"id": "bird_one", "x": 10, "y": 20, "r": 5}]
    result = mutate_geometry(
        "geo_noop", "move", hitboxes=same,
        expected_content_revision=pointer.content_revision, actor="human:t",
    )
    assert result.no_op is True
    assert result.content_revision == pointer.content_revision
    assert isinstance(store.read().snapshot["reviews"].get("hitboxes"), dict)


def test_move_stamps_human_origin_and_machine_refuses_it(isolated_session):
    from levelbuilder.api.geometry_service import HumanAuthorityError, mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_r7")
    result = mutate_geometry(
        "geo_r7", "move", hitboxes=[{"id": "bird_one", "x": 33, "y": 44, "r": 9}],
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    bird = store.read().snapshot["birds"][0]
    assert bird["geometryOrigin"] == "human:batu"

    with pytest.raises(HumanAuthorityError, match="bird_one"):
        mutate_geometry(
            "geo_r7", "move", hitboxes=[{"id": "bird_one", "x": 1, "y": 1, "r": 5}],
            expected_content_revision=result.content_revision, actor="machine:recenter",
        )
    # With itemized consent the machine may proceed.
    consented = mutate_geometry(
        "geo_r7", "move", hitboxes=[{"id": "bird_one", "x": 2, "y": 2, "r": 5}],
        expected_content_revision=result.content_revision, actor="machine:recenter",
        override_human=["bird_one"],
    )
    assert consented.no_op is False


def test_add_and_delete_are_real_bird_lifecycle(isolated_session):
    from levelbuilder.api.geometry_service import mutate_geometry
    from levelbuilder.api.artifact_dag import pending_obligations

    store, pointer = _canonical_session(isolated_session, "geo_lifecycle")
    added = mutate_geometry(
        "geo_lifecycle", "add", hitboxes=[{"x": 100, "y": 120, "r": 24}],
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    snapshot = store.read().snapshot
    assert len(snapshot["birds"]) == 2
    new_bird = next(b for b in snapshot["birds"] if b["birdId"] != "bird_one")
    assert new_bird["compatibilitySlot"] == "dog_01"
    assert "sprite" not in new_bird or not (new_bird.get("sprite") or {}).get("asset")
    kinds = {o["obligation"] for o in pending_obligations(snapshot)}
    assert "extract" in kinds

    deleted = mutate_geometry(
        "geo_lifecycle", "delete", bird_ids=[new_bird["birdId"]],
        expected_content_revision=added.content_revision, actor="human:batu",
    )
    assert [b["birdId"] for b in store.read().snapshot["birds"]] == ["bird_one"]
    assert deleted.no_op is False


def test_clear_and_scale(isolated_session):
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_bulk")
    scaled = mutate_geometry(
        "geo_bulk", "scale", factor=2.0,
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    assert store.read().snapshot["birds"][0]["hitbox"]["r"] == 10
    cleared = mutate_geometry(
        "geo_bulk", "clear",
        expected_content_revision=scaled.content_revision, actor="human:batu",
    )
    assert store.read().snapshot["birds"] == []
    assert cleared.no_op is False


def test_stale_revision_is_typed_conflict(isolated_session):
    from levelbuilder.api.canonical_bird_contract import RevisionConflictError
    from levelbuilder.api.geometry_service import mutate_geometry

    _canonical_session(isolated_session, "geo_conflict")
    with pytest.raises(RevisionConflictError):
        mutate_geometry(
            "geo_conflict", "move", hitboxes=[{"id": "bird_one", "x": 1, "y": 1, "r": 1}],
            expected_content_revision="sha256:" + "0" * 64, actor="human:t",
        )
