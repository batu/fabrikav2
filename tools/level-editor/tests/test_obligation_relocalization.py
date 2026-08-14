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

    # Operator ruling 2026-08-14 ("human action doesn't need gates"): the
    # gate protects AUTOMATED blessings — delegated actors still refuse.
    with pytest.raises(ContractValidationError, match="re-localiz"):
        S.set_canonical_hitbox_review_if_present(
            "relocalize_case",
            True,
            expected_content_revision=store.read().pointer.content_revision,
            reviewer="human:batu-delegated:overnight",
        )


def test_direct_human_bless_discharges_relocalization(tmp_path, monkeypatch):
    """Operator ruling 2026-08-14: a real human blessing hitboxes IS the
    localization authority — their eyes on the current paint beat any stamp.
    The bless must succeed and discharge the obligation in the same commit.
    Delegated actors (human:*-delegated:*) still hit the gate."""
    from levelbuilder.api import session as S
    from levelbuilder.api.artifact_dag import pending_obligations

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
    S.set_canonical_hitbox_review_if_present(
        "relocalize_case",
        True,
        expected_content_revision=store.read().pointer.content_revision,
        reviewer="human:editor",
    )
    after = store.read().snapshot
    assert not [o for o in pending_obligations(after)
                if o["obligation"] == "relocalize-hitboxes"], "obligation survived a human bless"
    assert (after.get("operational") or {}).get("hitboxLocalization", {}).get("method") == "human-review"


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
    monkeypatch.setattr(I, "localize_hitboxes_from_detections",
                        lambda sid: calls.append("localize") or {"detected": 1})
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
    job = SimpleNamespace(id="job-x", session_id="sid_x", metadata={})
    summary = I._run_magenta_inpaint_job(job, store=None)
    assert calls[0] == "paint"
    assert {"localize", "adopt", "stamp"} <= set(calls), calls
    assert summary.get("relocalization") is not None or summary.get("relocalizationFailed") is None


def test_sse_lane_delegates_to_the_job_handler(monkeypatch):
    """T2 (one-path plan): the job handler is THE paint executor; the SSE
    wrapper only books the job and streams — it must not carry its own copy
    of the core call (that copy is how the obligation stage got skipped)."""
    from types import SimpleNamespace
    from levelbuilder.api import inpaint as I

    executed = []
    monkeypatch.setattr(I, "_run_magenta_inpaint_job",
                        lambda job, store: executed.append(job.id) or {"ok": True})
    class Store:
        def list_jobs_by_status(self, statuses): return []
        def create_job(self, **kw): return SimpleNamespace(id="job-1", metadata=kw.get("metadata") or {})
        def transition_job(self, jid, **kw): return None
        def update_metadata(self, jid, meta): return None
    monkeypatch.setattr(I, "JOB_STORE", Store())
    summary = I.run_magenta_inpaint_durably(
        "sid", hitbox_list=[{"x": 1, "y": 2, "r": 3}], dog_prompt="p", model="m")
    assert executed == ["job-1"]
    assert summary == {"ok": True}


def test_failed_localization_does_not_stamp(monkeypatch):
    """Codex P1 (2026-08-14): a localization error or an empty detection set
    must NOT adopt or stamp — stamping clears pendingRelocalization and lets
    stale hitboxes proceed toward blessing."""
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    calls = []
    monkeypatch.setattr(S, "adopt_canonical_if_ready",
                        lambda sid: calls.append("adopt"))
    monkeypatch.setattr(S, "stamp_hitbox_localization",
                        lambda sid, method: calls.append("stamp"))

    monkeypatch.setattr(I, "localize_hitboxes_from_detections",
                        lambda sid: (_ for _ in ()).throw(RuntimeError("vlm down")))
    summary = I._discharge_paint_obligations("sid_x", {})
    assert "localizationFailed" in summary
    assert calls == [], f"stamped after a failed localization: {calls}"

    monkeypatch.setattr(I, "localize_hitboxes_from_detections",
                        lambda sid: {"detected": 0, "skipped": "no_detections"})
    summary = I._discharge_paint_obligations("sid_x", {})
    assert calls == [], f"stamped after an empty detection set: {calls}"
