"""AE18/AE21: single-use bound Approval Grants and durable-error secret scans."""

from __future__ import annotations

import pytest

from ftd_editor.approvals import expected_acknowledgement
from ftd_editor.jobs.actions import StartJobRequest
from ftd_editor.jobs.worker import RetryableJobError

from conftest import CANARY_SECRET

KIND = "ftd.dog_variant_upscale"


def orphaned_job(jobs_env, snapshot, request_id="req-grant-orphan"):
    body = StartJobRequest(
        requestId=request_id,
        sessionId=snapshot.session_id,
        revision=snapshot.revision,
        inputs={"dogKey": "dog-1"},
    )
    job, _ = jobs_env.service.start(KIND, body)
    claimed = jobs_env.jobs.claim_next_queued(owner="dead-worker", kinds=(KIND,))
    assert claimed.id == job.id
    jobs_env.jobs.record_submission_intent(job.id)
    worker = jobs_env.make_worker({})
    worker.recover()
    assert jobs_env.jobs.get_job(job.id).status == "orphaned_unknown"
    return job


def mint(jobs_client, jobs_headers, job, revision, **overrides):
    payload = {
        "actor": "human:batu",
        "actionKind": f"force_new:{KIND}",
        "requestBinding": f"job:{job.id}",
        "sourceRevision": revision,
        "acknowledgement": expected_acknowledgement(f"force_new:{KIND}", f"job:{job.id}"),
    }
    payload.update(overrides)
    return jobs_client.post("/api/approvals", json=payload, headers=jobs_headers)


def force_new(jobs_client, jobs_headers, job, snapshot, grant_id, **overrides):
    payload = {
        "requestId": "req-grant-forcenew",
        "sessionId": snapshot.session_id,
        "revision": snapshot.revision,
        "inputs": {"dogKey": "dog-1"},
        "grantId": grant_id,
        "actor": "human:batu",
    }
    payload.update(overrides)
    return jobs_client.post(
        f"/api/jobs/{job.id}/force-new/{KIND}", json=payload, headers=jobs_headers
    )


def test_mint_requires_the_exact_server_derived_acknowledgement(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    job = orphaned_job(jobs_env, ftd_session)
    wrong = mint(
        jobs_client, jobs_headers, job, ftd_session.revision, acknowledgement="yes do it"
    )
    assert wrong.status_code == 403
    minted = mint(jobs_client, jobs_headers, job, ftd_session.revision)
    assert minted.status_code == 201
    assert minted.json()["grantId"].startswith("grant-")


def test_force_new_requires_a_valid_grant_and_consumes_it_once(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    job = orphaned_job(jobs_env, ftd_session)

    # caller-fabricated grant ids are not authority
    spoofed = force_new(jobs_client, jobs_headers, job, ftd_session, "grant-forged")
    assert spoofed.status_code == 403

    grant_id = mint(jobs_client, jobs_headers, job, ftd_session.revision).json()["grantId"]
    accepted = force_new(jobs_client, jobs_headers, job, ftd_session, grant_id)
    assert accepted.status_code == 200, accepted.text
    attempt = accepted.json()
    assert attempt["attempt"]["reason"] == "force_new"
    assert attempt["attempt"]["previousAttemptId"] == job.id
    assert attempt["requestId"] == "req-grant-forcenew"

    # replaying the consumed grant fails before any side effect
    replay = force_new(
        jobs_client, jobs_headers, job, ftd_session, grant_id,
        requestId="req-grant-replay",
    )
    assert replay.status_code in (403, 409)


def test_grant_bindings_are_enforced(jobs_env, ftd_session, jobs_client, jobs_headers) -> None:
    job = orphaned_job(jobs_env, ftd_session)

    # wrong actor
    grant_id = mint(jobs_client, jobs_headers, job, ftd_session.revision).json()["grantId"]
    wrong_actor = force_new(
        jobs_client, jobs_headers, job, ftd_session, grant_id, actor="agent:claude"
    )
    assert wrong_actor.status_code == 403

    # wrong revision binding
    grant_id = mint(jobs_client, jobs_headers, job, "sha256:other").json()["grantId"]
    wrong_revision = force_new(jobs_client, jobs_headers, job, ftd_session, grant_id)
    assert wrong_revision.status_code == 403

    # wrong action kind
    other_kind_ack = expected_acknowledgement("publish", f"job:{job.id}")
    grant_id = mint(
        jobs_client, jobs_headers, job, ftd_session.revision,
        actionKind="publish", acknowledgement=other_kind_ack,
    ).json()["grantId"]
    wrong_action = force_new(jobs_client, jobs_headers, job, ftd_session, grant_id)
    assert wrong_action.status_code == 403

    # wrong job binding
    other_binding_ack = expected_acknowledgement(f"force_new:{KIND}", "job:someone-else")
    grant_id = mint(
        jobs_client, jobs_headers, job, ftd_session.revision,
        requestBinding="job:someone-else", acknowledgement=other_binding_ack,
    ).json()["grantId"]
    wrong_binding = force_new(jobs_client, jobs_headers, job, ftd_session, grant_id)
    assert wrong_binding.status_code == 403

    # nothing was ever superseded by a rejected grant
    assert jobs_env.jobs.get_job(job.id).superseded_by is None


def test_expired_grant_fails(jobs_env, ftd_session, jobs_client, jobs_headers) -> None:
    job = orphaned_job(jobs_env, ftd_session)
    grant_id = mint(jobs_client, jobs_headers, job, ftd_session.revision).json()["grantId"]
    jobs_env.clock.advance(3600.0)
    expired = force_new(jobs_client, jobs_headers, job, ftd_session, grant_id)
    assert expired.status_code == 403
    assert "expired" in expired.json()["detail"]


def test_late_completion_of_a_superseded_attempt_cannot_win(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    job = orphaned_job(jobs_env, ftd_session)
    grant_id = mint(jobs_client, jobs_headers, job, ftd_session.revision).json()["grantId"]
    attempt = force_new(jobs_client, jobs_headers, job, ftd_session, grant_id).json()

    from ftd_editor.jobs.store import TerminalJobImmutable

    with pytest.raises(TerminalJobImmutable):
        jobs_env.jobs.transition_job(job.id, status="succeeded", result={"late": True})
    assert jobs_env.jobs.get_job(job.id).status == "orphaned_unknown"
    assert jobs_env.jobs.get_job(job.id).superseded_by == attempt["jobId"]


def test_canary_secrets_never_reach_durable_or_client_surfaces(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    body = StartJobRequest(
        requestId="req-grant-canary",
        sessionId=ftd_session.session_id,
        revision=ftd_session.revision,
        inputs={"dogKey": "dog-1"},
    )
    job, _ = jobs_env.service.start(KIND, body)

    def leaky(context):
        raise RetryableJobError(
            "provider_error", f"provider rejected credential {CANARY_SECRET}"
        )

    worker = jobs_env.make_worker({KIND: leaky})
    assert worker.run_once()

    resource = jobs_client.get(f"/api/jobs/{job.id}", headers=jobs_headers)
    events = jobs_client.get(f"/api/jobs/{job.id}/events", headers=jobs_headers)
    assert CANARY_SECRET not in resource.text
    assert CANARY_SECRET not in events.text
    assert resource.json()["error"]["code"] == "provider_error"

    ledger_bytes = jobs_env.jobs.db_path.read_bytes()
    for sidecar in ("-wal", "-shm"):
        extra = jobs_env.jobs.db_path.with_name(jobs_env.jobs.db_path.name + sidecar)
        if extra.exists():
            ledger_bytes += extra.read_bytes()
    assert CANARY_SECRET.encode() not in ledger_bytes

    jobs_env.redactor.assert_tree_clean(jobs_env.artifacts.root)
