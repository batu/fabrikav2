"""BUG-13: bulk sprite materialization must land in the canonical snapshot,
not only the legacy dog_XX folders — otherwise candidates lose their birdId
and placement saves fall into the exported-package path (live Errno 2,
2026-08-13).

The helper maps each materialized entry to its bird via the projected hitbox
id, captures job provenance, and promotes through the same canonical commit
the per-bird extract uses. Legacy sessions no-op; per-bird failures are
collected, never raised (the legacy write already happened)."""
import json
from types import SimpleNamespace


def test_promotes_each_materialized_sprite_by_hitbox_id(monkeypatch, tmp_path):
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    (tmp_path / "dogs" / "dog_00").mkdir(parents=True)
    (tmp_path / "dogs" / "dog_00" / "sprite_000.json").write_text(json.dumps({
        "spriteBox": [10, 10, 50, 50], "cleanupBox": [8, 8, 52, 52],
    }))
    (tmp_path / "dogs" / "dog_00" / "sprite_000.png").write_bytes(b"png")
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    monkeypatch.setattr(S, "dogs_dir", lambda _sid: tmp_path / "dogs")
    snapshot = {"birds": [{"birdId": "bird-a"}]}
    monkeypatch.setattr(S, "read_canonical_session", lambda _sid: SimpleNamespace(
        state=CanonicalReadState.VALID_CURRENT, snapshot=snapshot, pointer=object()))
    captured_calls = []
    monkeypatch.setattr(
        "levelbuilder.api.canonical_job_provenance.capture_bird_job_input",
        lambda snap, **kw: captured_calls.append(kw) or SimpleNamespace(
            to_dict=lambda: {"birdId": kw["bird_id"]}),
    )
    promoted = []
    def fake_promote(sid, **kw):
        promoted.append(kw)
        return object(), "committed"
    monkeypatch.setattr(S, "promote_canonical_sprite_artifact", fake_promote)

    result = S.promote_materialized_sprites_canonically(
        "sid",
        hitboxes=[{"id": "bird-a", "x": 1, "y": 2, "r": 3}],
        materialized=[{"index": 0}],
        model="test-model",
        entity="bird",
    )
    assert captured_calls[0]["bird_id"] == "bird-a"
    assert promoted and promoted[0]["metadata"]["spriteBox"] == [10, 10, 50, 50]
    assert result == {"committed": 1, "skipped": 0, "failed": []}


def test_legacy_session_is_a_noop(monkeypatch):
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    monkeypatch.setattr(S, "read_canonical_session", lambda _sid: SimpleNamespace(
        state=CanonicalReadState.MIGRATION_REQUIRED, snapshot=None, pointer=None))
    assert S.promote_materialized_sprites_canonically(
        "sid", hitboxes=[], materialized=[], model="m", entity="bird") is None


def test_per_bird_failure_is_collected_not_raised(monkeypatch, tmp_path):
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    (tmp_path / "dogs" / "dog_00").mkdir(parents=True)
    (tmp_path / "dogs" / "dog_00" / "sprite_000.json").write_text(json.dumps({
        "spriteBox": [1, 1, 2, 2], "cleanupBox": [0, 0, 3, 3]}))
    (tmp_path / "dogs" / "dog_00" / "sprite_000.png").write_bytes(b"png")
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    monkeypatch.setattr(S, "dogs_dir", lambda _sid: tmp_path / "dogs")
    monkeypatch.setattr(S, "read_canonical_session", lambda _sid: SimpleNamespace(
        state=CanonicalReadState.VALID_CURRENT, snapshot={"birds": []}, pointer=object()))
    monkeypatch.setattr(
        "levelbuilder.api.canonical_job_provenance.capture_bird_job_input",
        lambda snap, **kw: (_ for _ in ()).throw(ValueError("unknown birdId")),
    )
    result = S.promote_materialized_sprites_canonically(
        "sid", hitboxes=[{"id": "ghost"}], materialized=[{"index": 0}],
        model="m", entity="bird")
    assert result["committed"] == 0
    assert result["failed"] and "ghost" in result["failed"][0]["birdId"]


def test_resolve_regen_hitbox_maps_canonical_slots(monkeypatch):
    """BUG-14: after a wholesale re-place, candidates carry SLOT ordinals
    (dog_15+) that session.json dogs[] does not contain — the resolver must
    fall through to the canonical slot->birdId mapping instead of refusing
    with 'missing hitbox'."""
    from types import SimpleNamespace
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    hitboxes = [{"id": "bird-a", "x": 1, "y": 2, "r": 3}]
    snapshot = {"birds": [{"birdId": "bird-a", "compatibilitySlot": "dog_15"}]}
    monkeypatch.setattr(S, "read_canonical_session", lambda _sid: SimpleNamespace(
        snapshot=snapshot, pointer=object(), state=None))
    resolved = I._resolve_regen_hitbox([], hitboxes, 15, session_id="sid")
    assert resolved is hitboxes[0]
    assert I._resolve_regen_hitbox([], hitboxes, 99, session_id="sid") is None


def test_promotion_runs_best_safe_placement_unless_human_confirmed(monkeypatch, tmp_path):
    """Obligation edge: extract -> sprite placement runs structurally inside
    the promotion loop; human-confirmed candidates keep their geometry."""
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    for slot in ("dog_00", "dog_01"):
        d = tmp_path / "dogs" / slot
        d.mkdir(parents=True)
        (d / "sprite_000.json").write_text(json.dumps({
            "spriteBox": [10, 10, 50, 50], "cleanupBox": [8, 8, 52, 52]}))
        (d / "sprite_000.png").write_bytes(b"png")
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    monkeypatch.setattr(S, "dogs_dir", lambda _sid: tmp_path / "dogs")
    snapshot = {
        "birds": [{"birdId": "bird-a"}, {"birdId": "bird-b"}],
        "operational": {"candidateReviews": {"bird-b": {"confirmed": True}}},
    }
    monkeypatch.setattr(S, "read_canonical_session", lambda _sid: SimpleNamespace(
        state=CanonicalReadState.VALID_CURRENT, snapshot=snapshot, pointer=object()))
    fitted = []
    monkeypatch.setattr(I, "_auto_place_cutout_best_safe",
                        lambda sid, idx, var: fitted.append(idx))
    monkeypatch.setattr(
        "levelbuilder.api.canonical_job_provenance.capture_bird_job_input",
        lambda snap, **kw: SimpleNamespace(to_dict=lambda: {}))
    monkeypatch.setattr(S, "promote_canonical_sprite_artifact",
                        lambda sid, **kw: (object(), "committed"))
    result = S.promote_materialized_sprites_canonically(
        "sid",
        hitboxes=[{"id": "bird-a"}, {"id": "bird-b"}],
        materialized=[{"index": 0}, {"index": 1}],
        model="m", entity="bird")
    assert fitted == [0]  # bird-b (index 1) is human-confirmed: no refit
    assert result["committed"] == 2


def test_promotion_consumes_each_birds_own_folder(monkeypatch, tmp_path):
    """T3 replaced the staged-bytes workaround: writer and projection share
    ONE folder per bird (the bird's dog index == slot ordinal), so the
    BUG-15 clobber is structurally impossible. Assert the invariant: each
    promotion reads exactly its bird's folder and bytes."""
    from types import SimpleNamespace
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    for idx, payload in ((10, b"bird-A-pixels"), (11, b"bird-B-pixels")):
        d = tmp_path / "dogs" / f"dog_{idx:02d}"
        d.mkdir(parents=True)
        (d / "sprite_000.json").write_text(json.dumps({
            "spriteBox": [10, 10, 50, 50], "cleanupBox": [8, 8, 52, 52]}))
        (d / "sprite_000.png").write_bytes(payload)
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    monkeypatch.setattr(S, "dogs_dir", lambda _sid: tmp_path / "dogs")
    monkeypatch.setattr(S, "load_session_raw", lambda _sid: {"dogs": [
        {"id": "bird-a", "index": 10}, {"id": "bird-b", "index": 11}]})
    snapshot = {"birds": [{"birdId": "bird-a"}, {"birdId": "bird-b"}], "operational": {}}
    monkeypatch.setattr(S, "read_canonical_session", lambda _sid: SimpleNamespace(
        state=CanonicalReadState.VALID_CURRENT, snapshot=snapshot, pointer=object()))
    monkeypatch.setattr(
        "levelbuilder.api.canonical_job_provenance.capture_bird_job_input",
        lambda snap, **kw: SimpleNamespace(to_dict=lambda: {}))
    consumed = []
    monkeypatch.setattr(S, "promote_canonical_sprite_artifact",
        lambda sid, *, sprite_path, **kw: consumed.append((sprite_path.name, sprite_path.parent.name, sprite_path.read_bytes())) or (object(), "committed"))
    result = S.promote_materialized_sprites_canonically(
        "sid",
        hitboxes=[{"id": "bird-a"}, {"id": "bird-b"}],
        materialized=[{"index": 0}, {"index": 1}],
        model="m", entity="bird")
    assert result["committed"] == 2
    assert consumed[0][1] == "dog_10" and consumed[0][2] == b"bird-A-pixels"
    assert consumed[1][1] == "dog_11" and consumed[1][2] == b"bird-B-pixels"

def test_cutter_files_by_bird_dog_index_not_array_position(monkeypatch, tmp_path):
    """T3 core (one-path plan): the cutter must write dogs/dog_<dogIndex> —
    the bird's own registry index (== its compatibility slot ordinal by
    construction) — never the hitbox ARRAY position. The position/slot
    collision is what duplicated a bird (BUG-15) and orphaned the panel."""
    from levelbuilder.api import session as S

    dogs = [
        {"id": "bird-a", "index": 20, "status": "done", "activeVariant": None},
        {"id": "bird-b", "index": 21, "status": "done", "activeVariant": None},
    ]
    hitboxes = [
        {"id": "bird-a", "x": 1, "y": 2, "r": 3},   # array position 0, dog index 20
        {"id": "bird-b", "x": 4, "y": 5, "r": 3},
    ]
    resolved = S.cutter_folder_indices(dogs, hitboxes)
    assert resolved == {0: 20, 1: 21}
    # Legacy id-less hitboxes fall back to array position.
    assert S.cutter_folder_indices([], [{"x": 1, "y": 2, "r": 3}]) == {0: 0}


def test_dog_registry_rebuild_preserves_slot_identity_after_deletion():
    """Codex P1 (2026-08-14): the post-materialize dogs[] rebuild keyed
    existing dogs by hitbox ARRAY POSITION and stamped position as index.
    After a deletion/reorder, bird C (slot 2, folder dog_02) sitting at
    position 0 was rebuilt as index 0 — promotion then read dog_00 and
    adopted another bird's pixels. Rebuild must key by stable bird id and
    preserve each bird's slot ordinal."""
    from levelbuilder.api.session import rebuild_dog_registry

    existing = [
        {"id": "bird-A", "index": 0, "promptOverride": "a"},
        {"id": "bird-B", "index": 1},
        {"id": "bird-C", "index": 2, "promptOverride": "c"},
    ]
    # B deleted; order now [C, A]
    hitboxes = [{"id": "bird-C", "x": 1, "y": 1, "r": 5},
                {"id": "bird-A", "x": 9, "y": 9, "r": 5}]
    folder_index = {0: 2, 1: 0}  # position -> slot, from cutter_folder_indices
    dogs = rebuild_dog_registry(
        hitboxes=hitboxes, existing_dogs=existing,
        folder_index=folder_index, succeeded_positions={0},
    )
    assert [d["id"] for d in dogs] == ["bird-C", "bird-A"]
    assert [d["index"] for d in dogs] == [2, 0], "slot ordinals must survive reorder"
    assert dogs[0]["status"] == "done" and dogs[0]["promptOverride"] == "c"
    assert dogs[1]["status"] == "failed" and dogs[1]["promptOverride"] == "a"


def test_cutter_folder_indices_never_collide_for_new_birds():
    """Firehouse live corruption (2026-08-14, operator-visible): a VLM-added
    bird (id unknown to the registry) fell back to its ARRAY POSITION as its
    folder — colliding with an existing bird whose slot ordinal equals that
    position. Two birds then shared one folder and promoted identical
    sprites. Unknown ids must get fresh folders above every claimed slot."""
    from levelbuilder.api.session import cutter_folder_indices

    dogs = [{"id": "keep-A", "index": 0}, {"id": "keep-B", "index": 1}]
    hitboxes = [
        {"id": "new-1", "x": 1, "y": 1, "r": 5},   # position 0 — collides with keep-A's slot
        {"id": "keep-A", "x": 2, "y": 2, "r": 5},
        {"id": "new-2", "x": 3, "y": 3, "r": 5},
        {"id": "keep-B", "x": 4, "y": 4, "r": 5},
    ]
    out = cutter_folder_indices(dogs, hitboxes)
    assert out[1] == 0 and out[3] == 1, "existing birds keep their slots"
    values = list(out.values())
    assert len(values) == len(set(values)), f"folder collision: {out}"
    assert out[0] >= 2 and out[2] >= 2, f"new birds must get fresh slots: {out}"


def test_promotion_skip_requires_consistent_asset_record():
    """Export-gate failures 2026-08-14 ('sprite byte size does not match its
    revision'): the idempotency skip compared the sha to the CUTTER's file
    but never checked that the snapshot's recorded path/bytes agree — birds
    pointing at another slot's overwritten file skipped forever. The skip
    condition must include record path + byte-size consistency."""
    import inspect
    from levelbuilder.api import session as S

    src = inspect.getsource(S.promote_materialized_sprites_canonically)
    guard = src.split("Idempotency:", 1)[1].split("captured = ", 1)[0]
    assert "expected_rel" in guard and "bytes" in guard, guard
