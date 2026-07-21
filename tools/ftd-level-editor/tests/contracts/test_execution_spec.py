"""Execution Spec immutability, Input Hash coverage, and linked attempts."""

from __future__ import annotations

import dataclasses

import pytest

from ftd_editor.jobs.actions import StartJobRequest
from ftd_editor.jobs.models import ExecutionSpec
from ftd_editor.jobs.worker import ApplicationConflict, RetryableJobError

KIND = "ftd.dog_variant_upscale"


def base_spec() -> ExecutionSpec:
    return ExecutionSpec(
        kind=KIND,
        session_id="level-01",
        source_revision="sha256:aaaa",
        inputs={"dogKey": "dog-1", "scale": 2},
        recipe_version="upscale-r1",
        policy_version="spend-p1",
        provider_options={"model": "m1"},
        source_hashes={"session.json": "sha256:bbbb"},
        target_reservation="session:level-01",
    )


FIELD_MUTATIONS = {
    "kind": "ftd.background_generate",
    "session_id": "level-02",
    "source_revision": "sha256:cccc",
    "inputs": {"dogKey": "dog-2", "scale": 2},
    "recipe_version": "upscale-r2",
    "policy_version": "spend-p2",
    "provider_options": {"model": "m2"},
    "source_hashes": {"session.json": "sha256:dddd"},
    "target_reservation": "session:level-02",
    "spec_version": 2,
}


def test_every_consumed_spec_field_is_a_dataclass_field_with_a_mutation() -> None:
    assert {f.name for f in dataclasses.fields(ExecutionSpec)} == set(FIELD_MUTATIONS)


@pytest.mark.parametrize("field_name", sorted(FIELD_MUTATIONS))
def test_every_consumed_spec_field_affects_input_hash(field_name: str) -> None:
    original = base_spec()
    mutated = dataclasses.replace(original, **{field_name: FIELD_MUTATIONS[field_name]})
    assert mutated.input_hash() != original.input_hash()


def test_spec_round_trips_and_hash_is_stable() -> None:
    spec = base_spec()
    assert ExecutionSpec.from_mapping(spec.to_mapping()).input_hash() == spec.input_hash()


def test_spec_rejects_non_json_inputs() -> None:
    spec = ExecutionSpec(
        kind=KIND,
        session_id="s",
        source_revision="r",
        inputs={"bad": object()},
        recipe_version="r1",
        policy_version="p1",
    )
    with pytest.raises(ValueError):
        spec.input_hash()


def _start(jobs_env, snapshot, request_id="req-spec-0001"):
    body = StartJobRequest(
        requestId=request_id,
        sessionId=snapshot.session_id,
        revision=snapshot.revision,
        inputs={"dogKey": "dog-1"},
    )
    return jobs_env.service.start(KIND, body)


def test_spec_and_hash_persist_before_any_side_effect(jobs_env, ftd_session) -> None:
    job, created = _start(jobs_env, ftd_session)
    assert created
    stored = jobs_env.jobs.get_job(job.id)
    assert stored.status == "queued"
    assert stored.execution_spec["kind"] == KIND
    assert stored.execution_spec["sourceRevision"] == ftd_session.revision
    assert stored.input_hash == ExecutionSpec.from_mapping(stored.execution_spec).input_hash()


def test_crash_before_submission_intent_yields_one_later_submission(
    jobs_env, ftd_session
) -> None:
    job, _ = _start(jobs_env, ftd_session)
    # A worker claimed the job and died before recording submission intent.
    claimed = jobs_env.jobs.claim_next_queued(owner="dead-worker", kinds=(KIND,))
    assert claimed is not None and claimed.id == job.id

    submissions: list[str] = []

    def handler(context):
        context.record_submission_intent()
        submissions.append(context.job.id)
        return {"ok": True}

    worker = jobs_env.make_worker({KIND: handler})
    worker.recover()
    assert jobs_env.jobs.get_job(job.id).status == "queued"
    assert worker.run_once()
    assert not worker.run_once()
    assert submissions == [job.id]
    assert jobs_env.jobs.get_job(job.id).status == "succeeded"


def test_retry_creates_linked_attempt_and_preserves_evidence(jobs_env, ftd_session) -> None:
    job, _ = _start(jobs_env, ftd_session, request_id="req-spec-retry")

    def failing(context):
        raise RetryableJobError("provider_unavailable", "scripted retryable fault")

    worker = jobs_env.make_worker({KIND: failing})
    assert worker.run_once()
    failed = jobs_env.jobs.get_job(job.id)
    assert failed.status == "failed_retryable" and failed.retryable

    attempt = jobs_env.jobs.retry(job.id)
    assert attempt.previous_attempt_id == job.id
    assert attempt.attempt_reason == "retry"
    assert attempt.execution_spec == failed.execution_spec
    superseded = jobs_env.jobs.get_job(job.id)
    assert superseded.superseded_by == attempt.id
    assert superseded.status == "failed_retryable"  # history immutable
    event_types = [event.event_type for event in jobs_env.jobs.list_events(job.id)]
    assert "job.failed_retryable" in event_types and "job.superseded" in event_types
    # replaying the original request id resolves to the newest linked attempt
    assert jobs_env.jobs.find_by_request_id(KIND, "req-spec-retry").id == attempt.id


def test_retry_never_requeues_a_successful_attempt(jobs_env, ftd_session) -> None:
    job, _ = _start(jobs_env, ftd_session, request_id="req-spec-noretry")
    worker = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    assert worker.run_once()
    from ftd_editor.jobs.store import AttemptNotAllowed

    with pytest.raises(AttemptNotAllowed):
        jobs_env.jobs.retry(job.id)


def test_stale_success_retains_artifact_with_conflict_application(
    jobs_env, ftd_session
) -> None:
    job, _ = _start(jobs_env, ftd_session, request_id="req-spec-ae11")

    def handler(context):
        context.register_artifact(
            context.job.id,
            b"paid-output-bytes",
            display_name="upscale.png",
            media_type="image/png",
        )
        raise ApplicationConflict({"note": "session moved on"})

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    finished = jobs_env.jobs.get_job(job.id)
    assert finished.status == "succeeded"
    assert finished.result["application"] == "conflict"
    artifacts = jobs_env.jobs.list_artifacts(job.id)
    assert len(artifacts) == 1
    resolved = jobs_env.artifacts.resolve_download(job.id, artifacts[0].artifact_id)
    assert resolved.path.read_bytes() == b"paid-output-bytes"
