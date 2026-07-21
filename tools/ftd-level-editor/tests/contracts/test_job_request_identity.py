"""AE4/AE5/AE5a: Request ID replay, Input Hash conflict, and rediscovery."""

from __future__ import annotations

KIND = "ftd.dog_variant_upscale"


def start_payload(snapshot, request_id="req-identity-0001", **overrides):
    payload = {
        "requestId": request_id,
        "sessionId": snapshot.session_id,
        "revision": snapshot.revision,
        "inputs": {"dogKey": "dog-1"},
    }
    payload.update(overrides)
    return payload


def test_replaying_a_lost_start_returns_same_job_and_one_submission(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    first = jobs_client.post(
        f"/api/jobs/actions/{KIND}", json=start_payload(ftd_session), headers=jobs_headers
    )
    assert first.status_code == 200, first.text
    replay = jobs_client.post(
        f"/api/jobs/actions/{KIND}", json=start_payload(ftd_session), headers=jobs_headers
    )
    assert replay.status_code == 200
    assert replay.json()["jobId"] == first.json()["jobId"]

    submissions: list[str] = []

    def handler(context):
        context.record_submission_intent()
        submissions.append(context.job.id)
        return {"ok": True}

    worker = jobs_env.make_worker({KIND: handler})
    while worker.run_once():
        pass
    assert submissions == [first.json()["jobId"]]

    # replay after completion still returns the same, now-terminal job
    after = jobs_client.post(
        f"/api/jobs/actions/{KIND}", json=start_payload(ftd_session), headers=jobs_headers
    )
    assert after.json()["jobId"] == first.json()["jobId"]
    assert after.json()["status"] == "succeeded"


def test_same_request_id_with_changed_inputs_conflicts_before_any_submission(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    created = jobs_client.post(
        f"/api/jobs/actions/{KIND}", json=start_payload(ftd_session), headers=jobs_headers
    )
    assert created.status_code == 200
    changed = jobs_client.post(
        f"/api/jobs/actions/{KIND}",
        json=start_payload(ftd_session, inputs={"dogKey": "dog-2"}),
        headers=jobs_headers,
    )
    assert changed.status_code == 409
    detail = changed.json()["detail"]
    assert detail["code"] == "request_identity_conflict"
    assert detail["existingJobId"] == created.json()["jobId"]
    assert detail["submittedInputHash"] != detail["existingInputHash"]
    # nothing ever ran
    assert jobs_env.jobs.get_job(created.json()["jobId"]).status == "queued"


def test_same_request_id_with_changed_revision_conflicts(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    created = jobs_client.post(
        f"/api/jobs/actions/{KIND}", json=start_payload(ftd_session), headers=jobs_headers
    )
    assert created.status_code == 200
    moved = jobs_env.sessions.mutate(
        ftd_session.session_id,
        expected_revision=ftd_session.revision,
        mutation=lambda session: session.with_mapping(
            {**session.to_mapping(), "note": "moved"}
        ),
    )
    replay = jobs_client.post(
        f"/api/jobs/actions/{KIND}",
        json=start_payload(ftd_session, revision=moved.revision),
        headers=jobs_headers,
    )
    assert replay.status_code == 409
    assert replay.json()["detail"]["code"] == "request_identity_conflict"


def test_stale_revision_start_fails_synchronously(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    jobs_env.sessions.mutate(
        ftd_session.session_id,
        expected_revision=ftd_session.revision,
        mutation=lambda session: session.with_mapping(
            {**session.to_mapping(), "note": "newer"}
        ),
    )
    stale = jobs_client.post(
        f"/api/jobs/actions/{KIND}",
        json=start_payload(ftd_session, requestId="req-identity-stale"),
        headers=jobs_headers,
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "session_revision_conflict"


def test_reload_with_only_request_id_rediscovers_job_at_every_phase(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    request_id = "req-identity-ae5a"

    # before insertion: lookup finds nothing, so the client can safely resend
    empty = jobs_client.get(
        "/api/jobs", params={"requestId": request_id}, headers=jobs_headers
    )
    assert empty.status_code == 200 and empty.json() == []

    created = jobs_client.post(
        f"/api/jobs/actions/{KIND}",
        json=start_payload(ftd_session, requestId=request_id),
        headers=jobs_headers,
    )
    job_id = created.json()["jobId"]

    # after insertion, before any worker wake-up
    found = jobs_client.get(
        "/api/jobs", params={"requestId": request_id}, headers=jobs_headers
    )
    assert [job["jobId"] for job in found.json()] == [job_id]

    # after worker wake-up and completion
    worker = jobs_env.make_worker({KIND: lambda context: {"ok": True}})
    while worker.run_once():
        pass
    after = jobs_client.get(
        "/api/jobs", params={"requestId": request_id}, headers=jobs_headers
    )
    assert [job["jobId"] for job in after.json()] == [job_id]
    assert after.json()[0]["status"] == "succeeded"

    # session-scoped listing also rediscovers it
    by_session = jobs_client.get(
        "/api/jobs", params={"sessionId": ftd_session.session_id}, headers=jobs_headers
    )
    assert job_id in [job["jobId"] for job in by_session.json()]
