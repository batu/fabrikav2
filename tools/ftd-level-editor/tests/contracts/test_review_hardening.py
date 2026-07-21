"""Review-driven hardening: duplicate-spend fences, cancel atomicity, wire 409s."""

from __future__ import annotations

import pytest

from ftd_editor.approvals import expected_acknowledgement
from ftd_editor.artifacts import ArtifactNotFound
from ftd_editor.jobs.actions import ForceNewJobRequest, StartJobRequest
from ftd_editor.jobs.store import (
    AttemptNotAllowed,
    OwnershipLost,
    RequestIdentityConflict,
)
from ftd_editor.jobs.worker import RetryableJobError, TerminalJobError

KIND = "ftd.dog_variant_upscale"


def start(jobs_env, snapshot, request_id, inputs=None):
    body = StartJobRequest(
        requestId=request_id,
        sessionId=snapshot.session_id,
        revision=snapshot.revision,
        inputs=inputs or {"dogKey": "dog-1"},
    )
    job, _ = jobs_env.service.start(KIND, body)
    return job


# -- F1: post-intent crash must never reclassify to grant-free retryable ------


def test_unexpected_error_after_submission_intent_orphans_not_retries(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-hard-f1")

    def handler(context):
        context.record_submission_intent()
        raise RuntimeError("provider socket dropped mid-submit")

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    crashed = jobs_env.jobs.get_job(job.id)
    assert crashed.status == "orphaned_unknown"
    with pytest.raises(AttemptNotAllowed):
        jobs_env.jobs.retry(job.id)


def test_unexpected_error_before_submission_intent_stays_retryable(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-hard-f1-pre")

    def handler(context):
        raise RuntimeError("crashed before any side effect")

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    crashed = jobs_env.jobs.get_job(job.id)
    assert crashed.status == "failed_retryable"
    assert crashed.error_code == "unexpected_job_error"
    assert jobs_env.jobs.retry(job.id).attempt_reason == "retry"


def test_retry_rejects_retryable_attempt_with_ambiguous_intent(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-hard-f1-guard")
    claimed = jobs_env.jobs.claim_next_queued(owner="w1", kinds=(KIND,))
    assert claimed is not None
    jobs_env.jobs.record_submission_intent(job.id, owner="w1")
    jobs_env.jobs.transition_job(
        job.id, status="failed_retryable", retryable=True, error_code="mislabelled"
    )
    with pytest.raises(AttemptNotAllowed):
        jobs_env.jobs.retry(job.id)


# -- F13: terminal-error and crash-containment coverage ------------------------


def test_terminal_job_error_lands_failed_terminal(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-hard-terminal")

    def handler(context):
        raise TerminalJobError("bad_input_geometry", "the dog polygon is degenerate")

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    finished = jobs_env.jobs.get_job(job.id)
    assert finished.status == "failed_terminal"
    assert finished.error_code == "bad_input_geometry"
    assert finished.error_message == "the dog polygon is degenerate"


def test_late_output_after_terminal_transition_is_retained_not_applied(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-hard-late")
    claimed = jobs_env.jobs.claim_next_queued(owner="w1", kinds=(KIND,))
    assert claimed is not None
    jobs_env.jobs.transition_job(job.id, status="failed_terminal", error_code="timed_out")
    assert jobs_env.jobs.complete_success(job.id, result={"late": True}, owner="w1") is None
    events = [event.event_type for event in jobs_env.jobs.list_events(job.id)]
    assert "job.late_output_retained" in events
    assert jobs_env.jobs.get_job(job.id).status == "failed_terminal"


# -- F4: cancel landing mid-completion wins atomically -------------------------


def test_cancel_between_work_and_completion_is_never_overwritten(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-hard-f4")
    claimed = jobs_env.jobs.claim_next_queued(owner="w1", kinds=(KIND,))
    assert claimed is not None
    jobs_env.jobs.request_cancel(job.id)
    finished = jobs_env.jobs.complete_success(job.id, result={"output": "x"}, owner="w1")
    assert finished is not None
    assert finished.status == "cancelled"
    assert finished.result["application"] == "withheld"
    assert finished.result["lateOutput"] == "retained"


# -- F5: owner fencing stops a swept-but-alive worker --------------------------


def test_swept_worker_cannot_checkpoint_or_finish(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-hard-f5")
    claimed = jobs_env.jobs.claim_next_queued(owner="slow-worker", kinds=(KIND,))
    assert claimed is not None
    jobs_env.jobs.heartbeat(job.id, owner="slow-worker")

    sweeper = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    jobs_env.clock.advance(120.0)
    assert [record.id for record in sweeper.sweep_stale()] == [job.id]
    assert jobs_env.jobs.get_job(job.id).status == "queued"

    # the resurrected first worker's fenced writes are all rejected
    with pytest.raises(OwnershipLost):
        jobs_env.jobs.record_submission_intent(job.id, owner="slow-worker")
    with pytest.raises(OwnershipLost):
        jobs_env.jobs.record_provider_job_id(job.id, "prov-9", owner="slow-worker")
    with pytest.raises(OwnershipLost):
        jobs_env.jobs.complete_success(job.id, result={"ok": True}, owner="slow-worker")

    # the sweeper still runs the job exactly once
    assert sweeper.run_once()
    assert jobs_env.jobs.get_job(job.id).status == "succeeded"


# -- F2: reuse-by-hash commits atomically with job creation --------------------


def test_reuse_by_hash_never_exposes_a_claimable_queued_job(jobs_env, ftd_session) -> None:
    first = start(jobs_env, ftd_session, "req-hard-f2-a", inputs={"dogKey": "same"})

    def handler(context):
        context.register_artifact(
            context.job.id, b"pixels", display_name="dog.png", media_type="image/png"
        )
        return {"ok": True}

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    assert jobs_env.jobs.get_job(first.id).status == "succeeded"

    second = start(jobs_env, ftd_session, "req-hard-f2-b", inputs={"dogKey": "same"})
    # already terminal at creation: no queued state a worker could ever claim
    assert second.status == "succeeded"
    assert second.stage == "reused"
    assert second.result["application"] == "reused"
    assert second.result["reusedFromJobId"] == first.id
    assert [a.artifact_id for a in jobs_env.jobs.list_artifacts(second.id)] == [
        a.artifact_id for a in jobs_env.jobs.list_artifacts(first.id)
    ]
    assert not worker.run_once()


# -- F9: restart recovery honors a pending cancel over resume ------------------


def test_recovery_prefers_pending_cancel_over_resume_polling(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-hard-f9")
    claimed = jobs_env.jobs.claim_next_queued(owner="dead-worker", kinds=(KIND,))
    assert claimed is not None
    jobs_env.jobs.record_submission_intent(job.id)
    jobs_env.jobs.record_provider_job_id(job.id, "prov-42")
    jobs_env.jobs.request_cancel(job.id)

    worker = jobs_env.make_worker(
        {}, resume_handlers={KIND: lambda context, provider_id: {"ok": True}}
    )
    worker.recover()
    recovered = jobs_env.jobs.get_job(job.id)
    assert recovered.status == "cancelled"


# -- F10: force-new requestId collision is a 409, and replay is safe -----------


def force_new_body(jobs_env, snapshot, request_id, grant_id):
    return ForceNewJobRequest(
        requestId=request_id,
        sessionId=snapshot.session_id,
        revision=snapshot.revision,
        inputs={"dogKey": "dog-1"},
        grantId=grant_id,
        actor="batu",
    )


def mint_grant(jobs_env, job_id, revision):
    action_kind = f"force_new:{KIND}"
    request_binding = f"job:{job_id}"
    return jobs_env.approvals.mint(
        actor="batu",
        action_kind=action_kind,
        request_binding=request_binding,
        source_revision=revision,
        acknowledgement=expected_acknowledgement(action_kind, request_binding),
    )


def test_force_new_with_foreign_request_id_raises_identity_conflict(
    jobs_env, ftd_session
) -> None:
    orphan = start(jobs_env, ftd_session, "req-hard-f10-orphan")
    jobs_env.jobs.claim_next_queued(owner="w1", kinds=(KIND,))
    jobs_env.jobs.record_submission_intent(job_id=orphan.id)
    other = start(jobs_env, ftd_session, "req-hard-f10-other", inputs={"dogKey": "dog-2"})
    grant = mint_grant(jobs_env, orphan.id, ftd_session.revision)
    body = force_new_body(jobs_env, ftd_session, "req-hard-f10-other", grant.grant_id)
    with pytest.raises(RequestIdentityConflict) as excinfo:
        jobs_env.service.force_new(KIND, orphan.id, body)
    assert excinfo.value.existing.id == other.id


def test_force_new_replay_with_same_request_id_returns_same_attempt(
    jobs_env, ftd_session
) -> None:
    orphan = start(jobs_env, ftd_session, "req-hard-f10-replay")
    grant = mint_grant(jobs_env, orphan.id, ftd_session.revision)
    body = force_new_body(jobs_env, ftd_session, "req-hard-f10-new", grant.grant_id)
    attempt = jobs_env.service.force_new(KIND, orphan.id, body)
    replay = jobs_env.service.force_new(KIND, orphan.id, body)
    assert replay.id == attempt.id


# -- G1: heartbeat and set_stage are owner-fenced -------------------------------


def test_swept_worker_heartbeat_and_stage_writes_are_fenced(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-hard-g1")
    claimed = jobs_env.jobs.claim_next_queued(owner="slow-worker", kinds=(KIND,))
    assert claimed is not None
    jobs_env.jobs.heartbeat(job.id, owner="slow-worker")

    sweeper = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    jobs_env.clock.advance(120.0)
    assert [record.id for record in sweeper.sweep_stale()] == [job.id]
    requeued = jobs_env.jobs.get_job(job.id)
    assert requeued.status == "queued"
    assert requeued.worker_owner is None

    # the zombie can neither refresh the lease nor steal ownership back
    with pytest.raises(OwnershipLost):
        jobs_env.jobs.heartbeat(job.id, owner="slow-worker")
    assert jobs_env.jobs.get_job(job.id).worker_owner is None
    with pytest.raises(OwnershipLost):
        jobs_env.jobs.transition_job(
            job.id,
            status="running",
            worker_owner="slow-worker",
            expect_owner="slow-worker",
        )


# -- G2: a recorded provider submission is resumed, never re-run ---------------


def test_retryable_error_after_provider_checkpoint_resumes_not_retries(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-hard-g2")
    submissions: list[str] = []
    polls: list[str] = []

    def handler(context):
        context.record_submission_intent()
        submissions.append(context.job.id)
        context.record_provider_job_id("prov-g2")
        raise RetryableJobError("provider_poll_timeout", "poll timed out mid-flight")

    def resume(context, provider_job_id):
        polls.append(provider_job_id)
        return {"ok": True, "resumed": provider_job_id}

    worker = jobs_env.make_worker({KIND: handler}, resume_handlers={KIND: resume})
    assert worker.run_once()
    checkpointed = jobs_env.jobs.get_job(job.id)
    assert checkpointed.status == "polling"
    assert checkpointed.stage == "resume_polling"

    # a grant-free fresh retry of the paid submission is refused
    with pytest.raises(AttemptNotAllowed):
        jobs_env.jobs.retry(job.id)

    # the resume path finishes the already-paid provider job: one submission only
    assert worker.run_once()
    finished = jobs_env.jobs.get_job(job.id)
    assert finished.status == "succeeded"
    assert submissions == [job.id]
    assert polls == ["prov-g2"]


# -- G3: sweep survives jobs that move mid-pass and never steals a live lease --


def test_sweep_skips_job_that_moved_and_continues_the_pass(jobs_env, ftd_session) -> None:
    moved = start(jobs_env, ftd_session, "req-hard-g3-a", inputs={"dogKey": "dog-a"})
    stale = start(jobs_env, ftd_session, "req-hard-g3-b", inputs={"dogKey": "dog-b"})
    for record in (moved, stale):
        assert jobs_env.jobs.claim_next_queued(owner="dead-worker", kinds=(KIND,)) is not None

    sweeper = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    snapshot = jobs_env.jobs.list_active_jobs()
    jobs_env.clock.advance(120.0)
    # the first job finishes after the snapshot was taken (owner still live)
    jobs_env.jobs.transition_job(
        moved.id, status="failed_terminal", error_code="finished_late"
    )
    swept = [sweeper._reconcile_contained(job) for job in snapshot]

    # the moved job is skipped, the genuinely stale one is still recovered
    assert swept[0] is None
    assert swept[1] is not None and swept[1].status == "queued"
    events = [event.event_type for event in jobs_env.jobs.list_events(moved.id)]
    assert "job.sweep_skipped" in events


def test_sweep_takeover_is_lease_conditional(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-hard-g3-lease")
    assert jobs_env.jobs.claim_next_queued(owner="live-worker", kinds=(KIND,)) is not None
    sweeper = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    snapshot = jobs_env.jobs.list_active_jobs()
    jobs_env.clock.advance(120.0)
    # the live worker heartbeats between the sweep snapshot and the takeover
    jobs_env.jobs.heartbeat(job.id, owner="live-worker")
    assert sweeper._reconcile_contained(snapshot[0]) is None
    assert jobs_env.jobs.get_job(job.id).worker_owner == "live-worker"


# -- G4: a pending cancel wins over every late outcome --------------------------


def test_cancel_wins_over_retryable_error_and_conflict_outcomes(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-hard-g4")

    def handler(context):
        jobs_env.jobs.request_cancel(context.job.id)
        raise RetryableJobError("late_failure", "failed after cancel landed")

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    cancelled = jobs_env.jobs.get_job(job.id)
    assert cancelled.status == "cancelled"
    assert not cancelled.retryable

    conflicted = start(jobs_env, ftd_session, "req-hard-g4-conflict", inputs={"dogKey": "d2"})
    claimed = jobs_env.jobs.claim_next_queued(owner="w-g4", kinds=(KIND,))
    assert claimed is not None
    jobs_env.jobs.request_cancel(conflicted.id)
    finished = jobs_env.jobs.transition_job(
        conflicted.id,
        status="succeeded",
        result={"application": "conflict"},
        worker_owner="w-g4",
        expect_owner="w-g4",
        cancel_wins=True,
    )
    assert finished.status == "cancelled"
    assert finished.result["application"] == "withheld"
    assert finished.result["lateOutput"] == "retained"


# -- F11: swapped artifact bytes are never served ------------------------------


def test_artifact_download_serves_only_verified_bytes(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-hard-f11")
    record = jobs_env.artifacts.register(
        job.id, b"real pixels", display_name="dog.png", media_type="image/png"
    )
    resolved = jobs_env.artifacts.resolve_download(job.id, record.artifact_id)
    assert resolved.content == b"real pixels"

    (jobs_env.artifacts.root / record.relative_path).write_bytes(b"swapped bytes")
    with pytest.raises(ArtifactNotFound):
        jobs_env.artifacts.resolve_download(job.id, record.artifact_id)
