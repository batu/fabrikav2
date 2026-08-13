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


def test_promotion_reads_all_folders_before_any_projection_clobber(monkeypatch, tmp_path):
    """BUG-15: dogs/dog_NN is hitbox-index namespace to the cutter but SLOT
    namespace to the compatibility projection. Promoting bird A (slot dog_01)
    projects its sprite into dogs/dog_01 — which is also position 1's folder.
    The loop must stage every position's bytes BEFORE the first promotion, or
    position 1's bird adopts bird A's pixels (live dup, france 2026-08-13)."""
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    for index, payload in ((0, b"bird-A-pixels"), (1, b"bird-B-pixels")):
        d = tmp_path / "dogs" / f"dog_{index:02d}"
        d.mkdir(parents=True)
        (d / "sprite_000.json").write_text(json.dumps({
            "spriteBox": [10, 10, 50, 50], "cleanupBox": [8, 8, 52, 52]}))
        (d / "sprite_000.png").write_bytes(payload)
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    monkeypatch.setattr(S, "dogs_dir", lambda _sid: tmp_path / "dogs")
    snapshot = {"birds": [{"birdId": "bird-a"}, {"birdId": "bird-b"}], "operational": {}}
    monkeypatch.setattr(S, "read_canonical_session", lambda _sid: SimpleNamespace(
        state=CanonicalReadState.VALID_CURRENT, snapshot=snapshot, pointer=object()))
    monkeypatch.setattr(
        "levelbuilder.api.canonical_job_provenance.capture_bird_job_input",
        lambda snap, **kw: SimpleNamespace(to_dict=lambda: {}))
    adopted_bytes = []
    def fake_promote(sid, *, captured_input, generation_id, sprite_path, metadata, **kw):
        adopted_bytes.append(sprite_path.read_bytes())
        # Simulate the compatibility projection: promoting the first bird
        # clobbers dogs/dog_01 (its slot folder) with its own pixels.
        if len(adopted_bytes) == 1:
            (tmp_path / "dogs" / "dog_01" / "sprite_000.png").write_bytes(b"bird-A-pixels")
        return object(), "committed"
    monkeypatch.setattr(S, "promote_canonical_sprite_artifact", fake_promote)
    result = S.promote_materialized_sprites_canonically(
        "sid",
        hitboxes=[{"id": "bird-a"}, {"id": "bird-b"}],
        materialized=[{"index": 0}, {"index": 1}],
        model="m", entity="bird")
    assert result["committed"] == 2
    assert adopted_bytes[1] == b"bird-B-pixels", "position 1 adopted bird-a's projected pixels"
