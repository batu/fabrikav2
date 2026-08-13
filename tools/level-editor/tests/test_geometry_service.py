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


def test_replace_set_matches_by_id_and_prunes_explicitly(isolated_session):
    """CR-1 findings 1/3: id-carrying replace_set moves matched birds, deletes
    absent ones, adds id-less extras — never positional rebinding."""
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_idset")
    added = mutate_geometry(
        "geo_idset", "add", hitboxes=[{"x": 200, "y": 200, "r": 20}],
        expected_content_revision=pointer.content_revision, actor="machine:place",
    )
    birds = store.read().snapshot["birds"]
    second_id = next(b["birdId"] for b in birds if b["birdId"] != "bird_one")

    # Prune bird_one (absent from the set), move the second, keep identities.
    result = mutate_geometry(
        "geo_idset", "replace_set",
        hitboxes=[{"id": second_id, "x": 300, "y": 300, "r": 20}],
        expected_content_revision=added.content_revision, actor="machine:recenter",
    )
    remaining = store.read().snapshot["birds"]
    assert [b["birdId"] for b in remaining] == [second_id]
    assert remaining[0]["hitbox"]["x"] == 300
    assert result.no_op is False


def test_anonymous_replace_set_refuses_sprited_or_human_birds(isolated_session):
    """CR-1 finding 1: a pure positional set may only wholesale-replace a
    fresh (sprite-less, machine-origin) placement — otherwise it must refuse
    rather than rebind identities."""
    import pytest as _pytest

    from levelbuilder.api.canonical_bird_contract import ContractValidationError
    from levelbuilder.api.geometry_service import mutate_geometry

    _canonical_session(isolated_session, "geo_anon")
    from levelbuilder.api import session as S

    revision = S.read_canonical_session("geo_anon").pointer.content_revision
    with _pytest.raises(ContractValidationError, match="identity"):
        mutate_geometry(
            "geo_anon", "replace_set",
            hitboxes=[{"x": 1, "y": 1, "r": 5}, {"x": 2, "y": 2, "r": 5}],
            expected_content_revision=revision, actor="machine:auto-place",
        )


def test_replace_set_identical_is_noop_before_any_guard(isolated_session):
    """CR-1 finding 2: byte-identical machine saves after human placement are
    no-ops, not HumanAuthorityError."""
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_noop_machine")
    human = mutate_geometry(
        "geo_noop_machine", "move", hitboxes=[{"id": "bird_one", "x": 50, "y": 60, "r": 7}],
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    result = mutate_geometry(
        "geo_noop_machine", "replace_set",
        hitboxes=[{"id": "bird_one", "x": 50, "y": 60, "r": 7}],
        expected_content_revision=human.content_revision, actor="machine:magenta",
    )
    assert result.no_op is True


def test_deleted_slots_are_never_reused(isolated_session):
    """CR-1 finding 6: a deleted bird's compatibility slot is retired — a new
    bird never inherits the old slot's on-disk sprite directory."""
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_slots")
    added = mutate_geometry(
        "geo_slots", "add", hitboxes=[{"x": 9, "y": 9, "r": 9}],
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    new_id = next(b["birdId"] for b in store.read().snapshot["birds"] if b["birdId"] != "bird_one")
    deleted = mutate_geometry(
        "geo_slots", "delete", bird_ids=[new_id],
        expected_content_revision=added.content_revision, actor="human:batu",
    )
    readded = mutate_geometry(
        "geo_slots", "add", hitboxes=[{"x": 8, "y": 8, "r": 8}],
        expected_content_revision=deleted.content_revision, actor="human:batu",
    )
    slots = [b["compatibilitySlot"] for b in store.read().snapshot["birds"]]
    assert "dog_01" not in slots  # retired with the deleted bird
    assert sorted(slots) == ["dog_00", "dog_02"]


def test_quarantined_sessions_refuse_legacy_sidecar_writes(isolated_session):
    """Merge-review F1: a quarantined store never falls through to the legacy
    sidecar writer — the chokepoint fails closed, end to end."""
    import pytest as _pytest

    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_assets import LaneSelectionError

    store, _ = _canonical_session(isolated_session, "geo_quarantined_write")
    store.pointer_path.write_text("not json")
    with _pytest.raises(LaneSelectionError):
        S.save_hitboxes("geo_quarantined_write", [{"x": 1, "y": 1, "r": 5}])


def test_delete_projects_legacy_removal(isolated_session):
    """Merge-review F2: deleting a bird also removes it from the legacy
    surfaces (session.json dogs[], dogs/<slot>/ renamed away) so a rollback
    cannot resurrect a ghost."""
    import json as _json

    from levelbuilder.api import session as S
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_ghost")
    sdir = isolated_session.session_dir("geo_ghost")
    slot_dir = sdir / "dogs" / "dog_00"
    slot_dir.mkdir(parents=True, exist_ok=True)
    (slot_dir / "variant_000.png").write_bytes(b"old-painting")
    raw = _json.loads((sdir / "session.json").read_text())
    raw["dogs"] = [{"index": 0, "id": "bird_one", "status": "done", "activeVariant": 0}]
    (sdir / "session.json").write_text(_json.dumps(raw))

    mutate_geometry(
        "geo_ghost", "delete", bird_ids=["bird_one"],
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    assert not (sdir / "dogs" / "dog_00").exists()
    raw_after = _json.loads((sdir / "session.json").read_text())
    assert all(d.get("id") != "bird_one" for d in raw_after.get("dogs", []))
    assert 0 in raw_after.get("deleted_dog_indices", [])


def test_rollback_converter_removes_draft_birds(isolated_session, monkeypatch, capsys):
    """Merge-review F3: the rollback converter deletes pre-extraction birds so
    old validators accept every remaining snapshot."""
    import importlib.util
    from pathlib import Path

    from levelbuilder.api import session as S
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_rollback")
    mutate_geometry(
        "geo_rollback", "add", hitboxes=[{"x": 3, "y": 3, "r": 3}],
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    assert any(not (b.get("sprite") or {}).get("asset") for b in store.read().snapshot["birds"])

    spec = importlib.util.spec_from_file_location(
        "rollback_spriteless_birds",
        Path(__file__).resolve().parents[1] / "scripts" / "rollback_spriteless_birds.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr("sys.argv", ["rollback_spriteless_birds.py", "--apply"])
    module.main()
    birds = store.read().snapshot["birds"]
    assert all((b.get("sprite") or {}).get("asset") for b in birds)


def test_replace_set_adopts_client_minted_ids_as_adds(isolated_session):
    """CR-t1 P0-4: the canvas add gesture sends the whole array with a
    client-minted uuid — replace_set adopts it as a real bird add instead of
    rejecting the identity change."""
    import uuid as _uuid

    from levelbuilder.api import session as S
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_client_add")
    minted = str(_uuid.uuid4())
    result = mutate_geometry(
        "geo_client_add", "replace_set",
        hitboxes=[
            {"id": "bird_one", "x": 10, "y": 20, "r": 5},
            {"id": minted, "x": 70, "y": 80, "r": 22},
        ],
        expected_content_revision=pointer.content_revision, actor="human:editor",
    )
    birds = {b["birdId"]: b for b in store.read().snapshot["birds"]}
    assert set(birds) == {"bird_one", minted}
    assert birds[minted]["hitbox"] == {"x": 70, "y": 80, "r": 22}
    assert "sprite" not in birds[minted]
    assert result.no_op is False


def test_grow_then_shrink_round_trips_for_corpus_radii(isolated_session):
    """CR-t1 P1-5: ±10% must round-trip for realistic radii (24-60) so
    repeated grow/shrink doesn't silently drift hitbox sizes."""
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_roundtrip")
    for start in (24, 30, 38, 42, 57, 60):
        rev = store.read().pointer.content_revision
        mutate_geometry("geo_roundtrip", "move",
            hitboxes=[{"id": "bird_one", "x": 10, "y": 20, "r": start}],
            expected_content_revision=rev, actor="human:t")
        rev = store.read().pointer.content_revision
        grown = mutate_geometry("geo_roundtrip", "scale", factor=1.1,
            expected_content_revision=rev, actor="human:t")
        shrunk = mutate_geometry("geo_roundtrip", "scale", factor=1/1.1,
            expected_content_revision=grown.content_revision, actor="human:t")
        final = store.read().snapshot["birds"][0]["hitbox"]["r"]
        assert final == start, f"drift: {start} -> {final}"


def test_sprite_revert_restores_previous_extraction(isolated_session):
    """CL-14: revert = promote pointed backward — the prior sprite descriptor
    recommits from history; its bytes still live in the CAS."""
    import hashlib as _hashlib

    from levelbuilder.api import session as S
    from levelbuilder.api.sprite_history import revert_bird_sprite, sprite_history

    store, pointer = _canonical_session(isolated_session, "geo_revert")
    sdir = isolated_session.session_dir("geo_revert")
    original_sha = store.read().snapshot["birds"][0]["sprite"]["asset"]["sha256"]

    # A new extraction lands: different bytes, committed.
    new_bytes = b"the-new-extraction"
    (sdir / "sprite.png").write_bytes(new_bytes)
    snapshot = store.read().snapshot
    sprite = snapshot["birds"][0]["sprite"]
    sprite["asset"] = {"path": "sprite.png",
                      "sha256": _hashlib.sha256(new_bytes).hexdigest(),
                      "bytes": len(new_bytes)}
    snapshot["birds"][0]["cleanup"]["sourceSpriteSha256"] = sprite["asset"]["sha256"]
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)

    history = sprite_history("geo_revert", "bird_one")
    assert len(history) >= 2
    assert history[0]["sha256"] != original_sha  # current first
    previous = next(h for h in history if h["sha256"] == original_sha)

    result = revert_bird_sprite(
        "geo_revert", "bird_one",
        to_content_revision=previous["contentRevision"],
        expected_content_revision=pointer.content_revision,
        actor="human:batu",
    )
    current = store.read().snapshot["birds"][0]
    assert current["sprite"]["asset"]["sha256"] == original_sha
    # The path projection is restored from the CAS.
    on_disk = (sdir / current["sprite"]["asset"]["path"]).read_bytes()
    assert _hashlib.sha256(on_disk).hexdigest() == original_sha
    assert result.content_revision != pointer.content_revision


def test_human_corrections_of_machine_geometry_record_golden_pairs(isolated_session):
    """P2e.4: a human moving MACHINE-placed geometry auto-records the
    before/after pair — corrections become eval data without a ritual.
    Human-over-human edits and no-ops record nothing."""
    import json as _json

    from levelbuilder.api import session as S
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "geo_golden")
    machine = mutate_geometry(
        "geo_golden", "replace_set",
        hitboxes=[{"id": "bird_one", "x": 40, "y": 40, "r": 8}],
        expected_content_revision=pointer.content_revision, actor="machine:auto-place",
    )
    corrected = mutate_geometry(
        "geo_golden", "move",
        hitboxes=[{"id": "bird_one", "x": 52, "y": 44, "r": 8}],
        expected_content_revision=machine.content_revision, actor="human:batu",
    )
    ledger = S.WORKSPACE_ROOT / "state" / "golden-geometry-pairs.jsonl"
    assert ledger.is_file()
    rows = [_json.loads(line) for line in ledger.read_text().splitlines()]
    assert len(rows) == 1
    row = rows[0]
    assert row["birdId"] == "bird_one"
    assert row["machine"] == {"x": 40, "y": 40, "r": 8}
    assert row["human"] == {"x": 52, "y": 44, "r": 8}
    assert row["machineActor"] == "machine:auto-place"

    # Human refining their own placement is not a machine correction.
    mutate_geometry(
        "geo_golden", "move",
        hitboxes=[{"id": "bird_one", "x": 53, "y": 44, "r": 8}],
        expected_content_revision=corrected.content_revision, actor="human:batu",
    )
    rows = [_json.loads(line) for line in ledger.read_text().splitlines()]
    assert len(rows) == 1
