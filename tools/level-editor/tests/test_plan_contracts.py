"""Executable defect ledger for the canonical-first plan.

Each test asserts the INTENDED behavior from
docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md
and is marked strict-xfail while the defect exists: it FAILS the suite if the
defect quietly disappears (finding was wrong or got fixed without flipping the
test) and flips to a hard assertion the moment the plan phase lands.
Findings reference docs/reports/2026-08-12-ftb-editor-codex-review/.
"""
import json

import pytest
from PIL import Image


def _job_store(tmp_path):
    from levelbuilder.api.job_store import JobStore
    return JobStore(tmp_path / "jobs.sqlite3")


# FLIPPED 2026-08-13 (P2c.2): succeeded (paid) units survive parent retries.
def test_background_retry_retains_succeeded_children(tmp_path):
    from levelbuilder.api import inpaint

    store = _job_store(tmp_path)
    parent = store.create_job(kind="background_generation", session_id="s1", idempotency_key="p1")
    child = store.create_job(
        kind="background_generation_unit", session_id="s1", parent_job_id=parent.id,
        idempotency_key=f"{parent.id}:background:0", metadata={"index": 0, "model": "m"},
    )
    store.transition_job(child.id, status="running", stage="generating")
    store.transition_job(child.id, status="succeeded", stage="done", result={"file": "bg_00.png", "paid": True})

    prepared = inpaint._prepare_background_generation_unit_jobs(parent, store, n_options=1, model="m")

    # Intended: a succeeded (paid) unit survives a parent retry untouched.
    refreshed = store.get_job(prepared[0].id)
    assert refreshed.status == "succeeded"
    assert refreshed.result.get("file") == "bg_00.png"


# FLIPPED 2026-08-13 (P2c.3): requeue refuses non-terminal jobs.
def test_requeue_refuses_running_jobs(tmp_path):
    store = _job_store(tmp_path)
    job = store.create_job(kind="background_generation", session_id="s1", idempotency_key="p2")
    store.transition_job(job.id, status="running", stage="generating")

    with pytest.raises(Exception):
        store.requeue_job(job.id, reason="second client retry")
    # The crash-recovery lane (verified-stale, pre-provider) may override.
    recovered = store.requeue_job(job.id, reason="worker restart recovery", allow_stale_running=True)
    assert recovered.status == "queued"


# FLIPPED 2026-08-12 overnight (P1.6/P2e.3): no-op saves preserve approvals.
def test_identical_hitbox_save_preserves_review(isolated_session):
    from test_canonical_hitbox_cas import _canonical_session
    from levelbuilder.api.canonical_bird_contract import bless_snapshot

    store, pointer = _canonical_session(isolated_session, "contract_noop_save")
    snapshot = bless_snapshot(store.read().snapshot, review_kind="hitboxes", reviewer="human:batu", reviewed_at="now")
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)
    same_geometry = [
        {"id": bird["birdId"], "x": bird["hitbox"]["x"], "y": bird["hitbox"]["y"], "r": bird["hitbox"]["r"]}
        for bird in store.read().snapshot["birds"]
    ]

    isolated_session.save_canonical_hitboxes_if_present(
        "contract_noop_save", same_geometry, expected_content_revision=pointer.content_revision,
    )

    # Intended (policy #11): unchanged governed content keeps its approval.
    assert isinstance(store.read().snapshot.get("reviews", {}).get("hitboxes"), dict)


# FLIPPED 2026-08-12 overnight (P1.6): auto-placement commits canonically.
def test_auto_placement_updates_canonical_geometry(app_client, isolated_session, monkeypatch):
    from levelbuilder.api import routes
    from test_canonical_hitbox_cas import _canonical_session

    monkeypatch.setattr(routes.S, "LEVELS_DIR", isolated_session.LEVELS_DIR)
    monkeypatch.setattr(routes.S, "GAME_PUBLIC_LEVELS", isolated_session.GAME_PUBLIC_LEVELS)
    store, pointer = _canonical_session(isolated_session, "contract_autoplace")
    sdir = isolated_session.LEVELS_DIR / "contract_autoplace"
    Image.new("RGB", (768, 1376), "green").save(sdir / "bg_00.png")
    raw = json.loads((sdir / "session.json").read_text())
    raw.update({"selected_bg": 0, "bg_width": 768, "bg_height": 1376})
    (sdir / "session.json").write_text(json.dumps(raw))

    before = store.read().snapshot["birds"]
    response = app_client.post("/api/sessions/contract_autoplace/auto-hitboxes", json={"nDogs": 3})

    # Intended: one truth — either the canonical snapshot reflects the
    # geometry the wizard now displays, or the write is REFUSED cleanly on a
    # VALID_CURRENT session (here: sprited bird => anonymous replace would
    # rebind identity, so the service refuses; CR-1 finding 1).
    if response.status_code == 200:
        persisted = json.loads((sdir / "hitboxes.json").read_text())
        assert len(store.read().snapshot["birds"]) == len(persisted)
    else:
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "identity_refused"
        assert store.read().snapshot["birds"] == before  # nothing mutated


def test_sprite_only_compose_is_opt_in(monkeypatch):
    """The sticker lane was rejected (2026-08-01) yet stayed default-ON and
    rebuilt italy_tuscan as pasted cutouts (2026-08-12). Default must be OFF."""
    from levelbuilder.api import inpaint

    monkeypatch.delenv("FTD_SPRITE_ONLY_COMPOSE", raising=False)
    assert inpaint._sprite_only_compose_enabled() is False
    monkeypatch.setenv("FTD_SPRITE_ONLY_COMPOSE", "1")
    assert inpaint._sprite_only_compose_enabled() is True


def test_provider_attempt_cap_env_clamps_retries(monkeypatch):
    """CR-2 NO-GO item: FTD_PROVIDER_ATTEMPT_CAP=1 makes every provider call
    single-attempt — the paid-shakedown precondition, runtime-enforced."""
    from levelbuilder.api import inpaint

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        raise TimeoutError("provider transient")

    monkeypatch.setenv("FTD_PROVIDER_ATTEMPT_CAP", "1")
    with pytest.raises(Exception):
        inpaint._with_retries_and_timeout(flaky)
    assert calls["n"] == 1

    monkeypatch.delenv("FTD_PROVIDER_ATTEMPT_CAP", raising=False)
    calls["n"] = 0
    with pytest.raises(Exception):
        inpaint._with_retries_and_timeout(flaky)
    assert calls["n"] == inpaint._MAX_ATTEMPTS


def test_kill9_drill_leaves_no_stuck_or_double_billable_state(tmp_path):
    """Failure-class ledger row 6 proof: a worker dying mid-batch (kill -9
    equivalent: running jobs with dead heartbeats) recovers with no stuck
    jobs and no double-billable state — paid attempts become orphaned_unknown
    (never auto-retried), pre-provider attempts requeue, succeeded units keep
    their results."""
    from datetime import datetime, timedelta, timezone

    from levelbuilder.api.job_store import JobStore
    from levelbuilder.api.job_worker import JobWorker

    store = JobStore(tmp_path / "jobs.sqlite3")
    stale = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

    paid = store.create_job(kind="k", session_id="s", idempotency_key="paid-1")
    store.transition_job(paid.id, status="running", stage="calling")
    store.update_metadata(paid.id, {"providerSubmissionStarted": True})
    pre = store.create_job(kind="k", session_id="s", idempotency_key="pre-1",
                           metadata={"safeToRequeue": True})
    store.transition_job(pre.id, status="running", stage="preparing")
    done = store.create_job(kind="k", session_id="s", idempotency_key="done-1")
    store.transition_job(done.id, status="running", stage="calling")
    store.transition_job(done.id, status="succeeded", stage="done", result={"paid": True})

    import sqlite3
    with sqlite3.connect(tmp_path / "jobs.sqlite3") as conn:
        conn.execute("UPDATE jobs SET heartbeat_at = ? WHERE status = 'running'", (stale,))

    worker = JobWorker(store=store, lock_path=tmp_path / 'worker.lock')
    worker.recover_stale_jobs()

    refreshed = {j.idempotency_key: j for j in (store.get_job(paid.id), store.get_job(pre.id), store.get_job(done.id))}
    assert refreshed["paid-1"].status == "orphaned_unknown"   # never re-billed
    assert refreshed["pre-1"].status == "queued"              # safely requeued
    assert refreshed["done-1"].status == "succeeded"          # result intact
    assert refreshed["done-1"].result.get("paid") is True
    # No job left permanently running.
    assert not store.list_jobs_by_status(("running",))


def test_one_active_paid_job_per_bird_guard(app_client, isolated_session, monkeypatch):
    """A6: a second retry-inpaint job targeting a bird with an ACTIVE job is
    refused even with a fresh attemptNonce — nonce dedupes accidental
    retries; this guard closes deliberate cross-client double spend."""
    from levelbuilder.api import inpaint as I
    from test_canonical_hitbox_cas import _canonical_session

    _store, pointer = _canonical_session(isolated_session, "double_spend")
    monkeypatch.setattr(I, "get_default_job_worker", lambda: type("W", (), {
        "register_handler": lambda *a, **k: None, "start": lambda self: None,
    })(), raising=False)

    first = app_client.post(
        "/api/sessions/double_spend/dogs/retry-inpaint/jobs",
        json={"birdIds": ["bird_one"], "prompt": "bird",
              "expectedContentRevision": pointer.content_revision,
              "attemptNonce": "nonce-aaaa"},
    )
    assert first.status_code == 200, first.text

    second = app_client.post(
        "/api/sessions/double_spend/dogs/retry-inpaint/jobs",
        json={"birdIds": ["bird_one"], "prompt": "bird",
              "expectedContentRevision": pointer.content_revision,
              "attemptNonce": "nonce-bbbb"},
    )
    assert second.status_code == 409, second.text
    assert second.json()["detail"]["code"] == "bird_job_active"


def test_paid_unit_spend_is_session_attributed(app_client, isolated_session, monkeypatch, tmp_path):
    """P2d.3/R9: provider cost recorded during a retry unit carries
    session/bird/operation attribution in the merceka ledger."""
    import json as _json

    from levelbuilder.api import inpaint as I
    from test_canonical_hitbox_cas import _canonical_session

    monkeypatch.setenv("MERCEKA_COST_LEDGER", str(tmp_path / "ledger.jsonl"))
    _store, pointer = _canonical_session(isolated_session, "attributed_spend")

    def fake_extraction(session_id, dog_index, **kwargs):
        from merceka_core import costs

        costs.record(source="test-provider", model="m", usage={}, usd=0.05)
        return {"dogIndex": dog_index, "status": "succeeded"}

    monkeypatch.setattr(I, "_run_single_cutout_extraction", fake_extraction)
    monkeypatch.setattr(I, "_run_single_dog_regen", fake_extraction)

    job = I._start_retry_failed_dogs_job_record(
        "attributed_spend",
        I.RetryFailedDogsJobRequest(
            birdIds=["bird_one"], prompt="bird",
            expectedContentRevision=pointer.content_revision,
            attemptNonce="attr-nonce-1",
        ),
    )
    try:
        I._run_retry_failed_dogs_job(I.JOB_STORE.get_job(job.id), I.JOB_STORE)
    except Exception:
        pass  # the stub result lacks epilogue fields; the spend already landed
    rows = [_json.loads(line) for line in (tmp_path / "ledger.jsonl").read_text().splitlines()]
    tagged = [r for r in rows if r.get("meta", {}).get("sessionId") == "attributed_spend"]
    assert tagged, rows
    meta = tagged[0]["meta"]
    assert meta["birdId"] == "bird_one"
    assert meta["operation"] in ("dog_regen", "cutout_extraction")
    assert meta["app"] == "ftb-level-editor"


def test_sse_magenta_run_leaves_a_durable_job_record(isolated_session, monkeypatch):
    """P2c.5: the SSE magenta lane books its run in the durable job store —
    a disconnect/crash mid-run leaves a claimed record with provider state,
    never an untracked side effect."""
    from levelbuilder.api import inpaint as I

    isolated_session.create_session(
        "magenta_durable", scene_prompt="s", dog_prompt="d", style="clean_old_cartoon",
        model="m", n_options=1, n_dogs=1,
    )

    def fake_core(session_id, **kwargs):
        return {"ok": True, "session": session_id}

    monkeypatch.setattr(I, "run_magenta_inpaint", fake_core)
    summary = I.run_magenta_inpaint_durably(
        "magenta_durable",
        hitbox_list=[{"x": 1, "y": 1, "r": 5}],
        dog_prompt="d",
        model="m",
        magenta_override=None,
        bg_index=0,
    )
    assert summary["ok"] is True
    jobs = [j for j in I.JOB_STORE.list_jobs_by_status(("succeeded",))
            if j.kind == "magenta_inpaint" and j.session_id == "magenta_durable"]
    assert jobs, "no durable record for the SSE magenta run"
    assert jobs[0].metadata.get("providerSubmissionStarted") is True
