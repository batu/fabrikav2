"""BUG-8 mutation scrub (built OFF by default, 2026-08-14 overnight; operator
gate: morning before/after review decides if it ever enters the lane).

Pure function: given clean bg, painted scene, and hitbox discs, revert every
changed component that does not intersect a (dilated) disc. Birds stay;
redecoration is undone by construction. Nothing here writes to any level."""
import numpy as np


def _scene(w=100, h=100):
    return np.full((h, w, 3), 100, dtype=np.uint8)


def test_scrub_reverts_offdisc_mutations_and_keeps_birds():
    from levelbuilder.api.mutation_scrub import scrub_scene

    clean = _scene()
    painted = clean.copy()
    painted[20:30, 20:30] = 200     # "bird" at disc (25,25)
    painted[70:80, 70:80] = 250     # prop swap far from any disc
    result = scrub_scene(painted, clean, hitboxes=[{"x": 25, "y": 25, "r": 8}])
    out = result.scene
    assert (out[20:30, 20:30] == 200).all(), "bird paint must survive"
    assert (out[70:80, 70:80] == 100).all(), "off-disc mutation must revert"
    assert result.stats["keptComponents"] == 1
    assert result.stats["revertedComponents"] == 1
    assert result.stats["revertedPixels"] == 100


def test_scrub_keeps_components_touching_the_dilated_disc():
    from levelbuilder.api.mutation_scrub import scrub_scene

    clean = _scene()
    painted = clean.copy()
    # Bird spills beyond its disc (painted birds render ~2x the disc).
    painted[10:40, 10:40] = 220
    result = scrub_scene(painted, clean, hitboxes=[{"x": 25, "y": 25, "r": 8}])
    assert (result.scene[10:40, 10:40] == 220).all(), "spilling bird must survive whole"
    assert result.stats["revertedPixels"] == 0


def test_scrub_noop_when_nothing_changed():
    from levelbuilder.api.mutation_scrub import scrub_scene

    clean = _scene()
    result = scrub_scene(clean.copy(), clean, hitboxes=[{"x": 25, "y": 25, "r": 8}])
    assert result.stats["revertedPixels"] == 0 and result.stats["keptComponents"] == 0


def test_job_worker_sets_attribution_for_every_handler(monkeypatch):
    """BUG-5 root fix: attribution lives at chokepoints, not per-wrapper —
    the worker sets it for EVERY job so no handler can forget."""
    from types import SimpleNamespace
    from levelbuilder.api.job_worker import JobWorker
    from merceka_core import costs

    seen = {}
    def handler(job, store):
        seen["ambient"] = costs._attribution_var.get()
        return {"ok": True}
    worker = JobWorker.__new__(JobWorker)
    job = SimpleNamespace(id="j1", kind="probe", session_id="sess-1", metadata={})
    worker.store = SimpleNamespace(
        transition_job=lambda *a, **k: None,
        append_event=lambda *a, **k: None,
        update_heartbeat=lambda *a, **k: job,
        get_job=lambda *a, **k: None,
    )
    worker.owner_id = "test-worker"
    worker.handlers = {"probe": handler}
    try:
        JobWorker._execute_job(worker, job)
    except Exception:
        pass  # store stub may lack methods the tail needs; ambient is captured first
    assert seen.get("ambient", {}).get("sessionId") == "sess-1"
    assert seen["ambient"].get("operation") == "probe"


def test_bulk_extract_job_handler_derives_detections_and_materializes(monkeypatch):
    """Durable Extract All (goal 3e): the job handler derives padded-square
    detections from the session's hitboxes (each hitbox IS the bird) and
    runs the bulk materialize — client disconnects can no longer orphan the
    work (the sync request lost 26 billed singles, 2026-08-14)."""
    from types import SimpleNamespace
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    monkeypatch.setattr(S, "load_session_raw", lambda sid: {
        "hitboxes_ignored": True})
    import json as _json, pathlib, tempfile
    tmp = pathlib.Path(tempfile.mkdtemp())
    (tmp / "hitboxes.json").write_text(_json.dumps([{"id": "b1", "x": 100, "y": 100, "r": 50}]))
    monkeypatch.setattr(S, "session_dir", lambda sid: tmp)
    seen = {}
    monkeypatch.setattr(S, "materialize_detection_sprites",
        lambda sid, *, detections, minimum_confidence, force: seen.update(
            {"detections": detections, "force": force}) or {"materialized": 1})
    job = SimpleNamespace(id="j1", session_id="s1", metadata={"force": True, "padFactor": 1.6})
    result = I._run_bulk_extract_job(job, store=None)
    assert result == {"materialized": 1}
    det = seen["detections"][0]
    assert det["x"] == 20 and det["y"] == 20 and det["width"] == 160  # 100±(50*1.6)
    assert seen["force"] is True


def test_bulk_extract_flips_requeue_safety_before_spending(monkeypatch):
    """Codex P1 (2026-08-14): a crash after provider submission must not be
    classified pre-provider and silently replayed — that duplicates paid
    calls. The handler flips safeToRequeue/providerSubmissionStarted through
    the store BEFORE the first paid call."""
    from types import SimpleNamespace
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S
    import hashlib, json as _json, pathlib, tempfile

    tmp = pathlib.Path(tempfile.mkdtemp())
    hb = [{"id": "b1", "x": 100, "y": 100, "r": 50}]
    (tmp / "hitboxes.json").write_text(_json.dumps(hb))
    monkeypatch.setattr(S, "session_dir", lambda sid: tmp)
    order = []

    class _Store:
        def update_metadata(self, job_id, patch):
            order.append(("meta", dict(patch)))

    monkeypatch.setattr(S, "materialize_detection_sprites",
        lambda sid, **kw: order.append(("spend", None)) or {"materialized": 1})
    sha = hashlib.sha256((tmp / "hitboxes.json").read_bytes()).hexdigest()
    job = SimpleNamespace(id="j1", session_id="s1",
                          metadata={"force": False, "padFactor": 1.6, "hitboxesSha": sha})
    I._run_bulk_extract_job(job, store=_Store())
    assert order and order[0][0] == "meta", f"spend happened before the safety flip: {order}"
    assert order[0][1].get("safeToRequeue") is False
    assert order[0][1].get("providerSubmissionStarted") is True


def test_bulk_extract_refuses_when_hitboxes_changed_since_booking(monkeypatch):
    """Codex P1 (2026-08-14): hitbox edits between booking and execution must
    abort BEFORE spend — otherwise old detections pair with new/reordered
    birds and wrong sprites get canonically promoted."""
    from types import SimpleNamespace
    import pytest
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S
    import json as _json, pathlib, tempfile

    tmp = pathlib.Path(tempfile.mkdtemp())
    (tmp / "hitboxes.json").write_text(_json.dumps([{"id": "b1", "x": 1, "y": 2, "r": 3}]))
    monkeypatch.setattr(S, "session_dir", lambda sid: tmp)
    monkeypatch.setattr(S, "materialize_detection_sprites",
        lambda sid, **kw: pytest.fail("spent despite stale booking"))
    job = SimpleNamespace(id="j1", session_id="s1",
                          metadata={"force": False, "padFactor": 1.6,
                                    "hitboxesSha": "0" * 64})
    with pytest.raises(RuntimeError, match="changed since booking"):
        I._run_bulk_extract_job(job, store=None)


def test_single_extraction_pre_extraction_bird_gets_variant_zero():
    """Operator hit a 500 re-extracting in venice (2026-08-14): a
    pre-extraction bird has activeVariant=None, which reached the output
    filename format ('sprite_{None:03d}'). The fallback must pin variant 0."""
    import inspect
    from levelbuilder.api import inpaint as I

    src = inspect.getsource(I._run_single_cutout_extraction)
    fallback = src.split("Pre-extraction bird", 1)[1].split("expected_hitboxes", 1)[0]
    assert "variant_index = 0" in fallback
