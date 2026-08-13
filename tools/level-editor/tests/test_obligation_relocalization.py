"""Obligation edge (plan §Obligation edges): paint → hitbox re-localization.

Contract per the plan's three mechanisms:
(a) the happy path discharges the obligation (localization stamp matches the
    scene the birds live in);
(b) an interrupted flow leaves the pending marker visible;
(c) blessing refuses while the obligation is pending.

Grandfather rule: snapshots that predate the mechanism (no stamp, no pending
marker) owe nothing — the obligation arms when a paint/regenerate commit marks
`operational.pendingRelocalization`, or when a recorded stamp no longer
matches the scene digest.
"""
from conftest import materialize_snapshot_assets


def _store(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore
    from test_canonical_hitbox_cas import _snapshot

    root = tmp_path / "session"
    store = CanonicalRevisionStore(root)
    snapshot = _snapshot("relocalize_case")
    materialize_snapshot_assets(root, snapshot)
    store.commit(snapshot, expected_content_revision=None)
    return store


def _kinds(snapshot):
    from levelbuilder.api.artifact_dag import pending_obligations

    return {o["obligation"] for o in pending_obligations(snapshot)}


def test_legacy_snapshot_owes_no_relocalization(tmp_path):
    store = _store(tmp_path)
    assert "relocalize-hitboxes" not in _kinds(store.read().snapshot)


def test_paint_commit_arms_the_obligation(tmp_path):
    store = _store(tmp_path)
    snapshot = dict(store.read().snapshot)
    snapshot.setdefault("operational", {})["pendingRelocalization"] = True
    assert "relocalize-hitboxes" in _kinds(snapshot)


def test_matching_stamp_discharges_the_obligation(tmp_path):
    store = _store(tmp_path)
    snapshot = dict(store.read().snapshot)
    operational = snapshot.setdefault("operational", {})
    operational["pendingRelocalization"] = True
    operational["hitboxLocalization"] = {
        "sceneSha256": snapshot["assets"]["scene"]["sha256"],
        "method": "local-diff-recenter",
    }
    # A stamp matching the current scene discharges even if the pending flag
    # survived a crash between the two commits (interrupted-flow tolerance).
    assert "relocalize-hitboxes" not in _kinds(snapshot)


def test_stale_stamp_rearms_the_obligation(tmp_path):
    store = _store(tmp_path)
    snapshot = dict(store.read().snapshot)
    snapshot.setdefault("operational", {})["hitboxLocalization"] = {
        "sceneSha256": "sha-of-some-older-paint",
        "method": "vlm-snap",
    }
    assert "relocalize-hitboxes" in _kinds(snapshot)


def test_bless_refuses_while_relocalization_pending(tmp_path, monkeypatch):
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import ContractValidationError

    store = _store(tmp_path)
    snapshot = dict(store.read().snapshot)
    snapshot.setdefault("operational", {})["pendingRelocalization"] = True
    pointer = store.read().pointer
    store.commit(
        snapshot,
        expected_content_revision=pointer.content_revision,
        expected_operational_revision=pointer.operational_revision,
    )
    monkeypatch.setattr(S, "canonical_session_store", lambda _sid: store)
    import pytest

    with pytest.raises(ContractValidationError, match="re-localiz"):
        S.set_canonical_hitbox_review_if_present(
            "relocalize_case",
            True,
            expected_content_revision=store.read().pointer.content_revision,
            reviewer="human:test",
        )


def test_stamp_helper_discharges_via_store(tmp_path, monkeypatch):
    from levelbuilder.api import session as S

    store = _store(tmp_path)
    snapshot = dict(store.read().snapshot)
    snapshot.setdefault("operational", {})["pendingRelocalization"] = True
    pointer = store.read().pointer
    store.commit(
        snapshot,
        expected_content_revision=pointer.content_revision,
        expected_operational_revision=pointer.operational_revision,
    )
    monkeypatch.setattr(S, "canonical_session_store", lambda _sid: store)
    monkeypatch.setattr(S, "read_canonical_session", lambda _sid: store.read())
    S.stamp_hitbox_localization("relocalize_case", method="local-diff-recenter")
    current = store.read().snapshot
    assert "relocalize-hitboxes" not in _kinds(current)
    stamp = current["operational"]["hitboxLocalization"]
    assert stamp["sceneSha256"] == current["assets"]["scene"]["sha256"]
    assert current["operational"].get("pendingRelocalization") is not True


def test_job_lane_magenta_also_discharges_obligations(monkeypatch):
    """The paint obligations (recenter + canonical adoption + stamp) must run
    in EVERY magenta lane — the CLI job path skipped them on first live run
    (walled_gardens stress test, 2026-08-13: level left migration_required)."""
    from types import SimpleNamespace
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    calls = []
    monkeypatch.setattr(I, "run_magenta_inpaint",
                        lambda sid, **kw: calls.append("paint") or {"ok": True})
    monkeypatch.setattr(I, "recenter_hitboxes_local_diff",
                        lambda sid: calls.append("recenter") or {"moved": []})
    monkeypatch.setattr(S, "adopt_canonical_if_ready",
                        lambda sid: calls.append("adopt") or "migrate")
    monkeypatch.setattr(S, "stamp_hitbox_localization",
                        lambda sid, method: calls.append("stamp"))
    monkeypatch.setattr(S, "load_session_raw", lambda sid: {"dog_prompt": "p", "inpaint_model": "m"})
    monkeypatch.setattr(S, "session_dir", lambda sid, __p=S.session_dir: __p(sid))
    import json as _json, pathlib, tempfile
    tmp = pathlib.Path(tempfile.mkdtemp())
    (tmp / "hitboxes.json").write_text(_json.dumps([{"x": 1, "y": 2, "r": 3}]))
    monkeypatch.setattr(S, "session_dir", lambda sid: tmp)
    job = SimpleNamespace(session_id="sid_x", metadata={})
    summary = I._run_magenta_inpaint_job(job, store=None)
    assert calls[0] == "paint"
    assert {"recenter", "adopt", "stamp"} <= set(calls), calls
    assert summary.get("relocalization") is not None or summary.get("relocalizationFailed") is None
