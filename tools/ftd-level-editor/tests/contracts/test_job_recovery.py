"""R17/R18/AE8: owner recovery, resume-by-checkpoint, and stale sweep."""

from __future__ import annotations

import pytest

from ftd_editor.jobs.actions import StartJobRequest

KIND = "ftd.dog_variant_upscale"


def start(jobs_env, snapshot, request_id):
    body = StartJobRequest(
        requestId=request_id,
        sessionId=snapshot.session_id,
        revision=snapshot.revision,
        inputs={"dogKey": "dog-1"},
    )
    job, _ = jobs_env.service.start(KIND, body)
    return job


def crash_after(jobs_env, job, *, intent: bool, provider_id: str | None) -> None:
    claimed = jobs_env.jobs.claim_next_queued(owner="dead-worker", kinds=(KIND,))
    assert claimed is not None and claimed.id == job.id
    if intent:
        jobs_env.jobs.record_submission_intent(job.id)
    if provider_id is not None:
        jobs_env.jobs.record_provider_job_id(job.id, provider_id)


def test_restart_before_submission_intent_resumes_with_one_submission(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-recover-pre")
    crash_after(jobs_env, job, intent=False, provider_id=None)

    submissions: list[str] = []

    def handler(context):
        context.record_submission_intent()
        submissions.append(context.job.id)
        return {"ok": True}

    worker = jobs_env.make_worker({KIND: handler})
    # repeated restarts stay idempotent
    for _ in range(3):
        worker.recover()
    assert jobs_env.jobs.get_job(job.id).status == "queued"
    while worker.run_once():
        pass
    assert submissions == [job.id]
    assert jobs_env.jobs.get_job(job.id).status == "succeeded"


def test_restart_with_provider_checkpoint_resumes_polling(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-recover-poll")
    crash_after(jobs_env, job, intent=True, provider_id="prov-123")

    polled: list[str] = []

    def resume(context, provider_job_id):
        polled.append(provider_job_id)
        return {"providerJobId": provider_job_id}

    worker = jobs_env.make_worker({}, resume_handlers={KIND: resume})
    worker.recover()
    assert jobs_env.jobs.get_job(job.id).status == "polling"
    assert worker.run_once()
    assert polled == ["prov-123"]
    finished = jobs_env.jobs.get_job(job.id)
    assert finished.status == "succeeded"
    assert finished.result["providerJobId"] == "prov-123"


def test_restart_with_intent_but_no_provider_id_becomes_orphaned_unknown(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-recover-orphan")
    crash_after(jobs_env, job, intent=True, provider_id=None)

    worker = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    worker.recover()
    orphaned = jobs_env.jobs.get_job(job.id)
    assert orphaned.status == "orphaned_unknown"
    assert "force-new" in (orphaned.error_message or "")
    # an orphaned attempt can never be resubmitted by requeue or retry
    from ftd_editor.jobs.store import AttemptNotAllowed, TerminalJobImmutable

    with pytest.raises(TerminalJobImmutable):
        jobs_env.jobs.requeue_pre_side_effect(job.id, reason="never")
    with pytest.raises(AttemptNotAllowed):
        jobs_env.jobs.retry(job.id)
    assert not worker.run_once()


def test_heartbeat_takeover_and_periodic_stale_sweep(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-recover-sweep")
    crash_after(jobs_env, job, intent=False, provider_id=None)
    jobs_env.jobs.heartbeat(job.id, owner="dead-worker")

    worker = jobs_env.make_worker(
        {KIND: lambda context: {"ok": True}}, stale_after_seconds=60.0
    )
    # a fresh heartbeat is not stale: the sweep must not steal live work
    assert worker.sweep_stale() == []
    assert jobs_env.jobs.get_job(job.id).status == "running"

    jobs_env.clock.advance(120.0)
    swept = worker.sweep_stale()
    assert [record.id for record in swept] == [job.id]
    assert jobs_env.jobs.get_job(job.id).status == "queued"
    assert worker.run_once()
    finished = jobs_env.jobs.get_job(job.id)
    assert finished.status == "succeeded"
    assert finished.worker_owner == worker.owner_id


def test_worker_ownership_lock_is_single_owner(jobs_env) -> None:
    first = jobs_env.make_worker({})
    second = jobs_env.make_worker({})
    assert first.acquire_ownership()
    try:
        assert not second.acquire_ownership()
    finally:
        first.release_ownership()
    assert second.acquire_ownership()
    second.release_ownership()
