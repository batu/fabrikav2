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
