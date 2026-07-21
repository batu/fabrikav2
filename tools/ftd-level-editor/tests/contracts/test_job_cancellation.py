"""R16/AE8a: explicit, distinguishable cancellation semantics."""

from __future__ import annotations

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


def test_queued_cancel_is_immediate(jobs_env, ftd_session, jobs_client, jobs_headers) -> None:
    job = start(jobs_env, ftd_session, "req-cancel-queued")
    response = jobs_client.post(f"/api/jobs/{job.id}/cancel", headers=jobs_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert response.json()["stage"] == "cancelled_before_start"
    worker = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    assert not worker.run_once()


def test_submitted_cancel_reconciles_through_the_worker(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-cancel-submitted")

    def handler(context):
        context.record_submission_intent()
        # cancellation arrives while the provider call is in flight
        jobs_env.jobs.request_cancel(context.job.id)
        assert jobs_env.jobs.get_job(context.job.id).status == "cancel_requested"
        context.raise_if_cancel_requested()
        raise AssertionError("unreachable")

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    cancelled = jobs_env.jobs.get_job(job.id)
    assert cancelled.status == "cancelled"
    event_types = [event.event_type for event in jobs_env.jobs.list_events(job.id)]
    assert "job.cancel_requested" in event_types
    assert "job.cancelled" in event_types


def test_cancel_racing_success_retains_but_does_not_apply_output(
    jobs_env, ftd_session
) -> None:
    job = start(jobs_env, ftd_session, "req-cancel-race")

    def handler(context):
        context.record_submission_intent()
        context.register_artifact(
            context.job.id,
            b"late-provider-output",
            display_name="late.png",
            media_type="image/png",
        )
        # the cancel lands after the provider finished but before commit
        jobs_env.jobs.request_cancel(context.job.id)
        return {"providerFinished": True}

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    finished = jobs_env.jobs.get_job(job.id)
    assert finished.status == "cancelled"
    assert finished.result["lateOutput"] == "retained"
    assert finished.result["application"] == "withheld"
    artifacts = jobs_env.jobs.list_artifacts(job.id)
    assert len(artifacts) == 1
    resolved = jobs_env.artifacts.resolve_download(job.id, artifacts[0].artifact_id)
    assert resolved.path.read_bytes() == b"late-provider-output"


def test_cancel_of_terminal_job_is_a_distinguishable_no_op(jobs_env, ftd_session) -> None:
    job = start(jobs_env, ftd_session, "req-cancel-terminal")
    worker = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    assert worker.run_once()
    result = jobs_env.jobs.request_cancel(job.id)
    assert result.status == "succeeded"
    event_types = [event.event_type for event in jobs_env.jobs.list_events(job.id)]
    assert "job.cancel_requested" not in event_types
