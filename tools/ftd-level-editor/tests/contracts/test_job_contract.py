"""R13/R33: canonical Job resource contract and pinned contract drift checks."""

from __future__ import annotations

import json
from pathlib import Path

from ftd_editor.contracts import generate_typescript, openapi_bytes
from ftd_editor.jobs.actions import StartJobRequest

TOOL_ROOT = Path(__file__).resolve().parent.parent.parent
KIND = "ftd.dog_variant_upscale"


def test_start_returns_a_canonical_job_resource(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    response = jobs_client.post(
        f"/api/jobs/actions/{KIND}",
        json={
            "requestId": "req-contract-0001",
            "sessionId": ftd_session.session_id,
            "revision": ftd_session.revision,
            "inputs": {"dogKey": "dog-1"},
        },
        headers=jobs_headers,
    )
    assert response.status_code == 200, response.text
    resource = response.json()
    assert set(resource) == {
        "jobId", "kind", "sessionId", "requestId", "inputHash", "status", "stage",
        "retryable", "error", "result", "attempt", "artifacts", "createdAt",
        "updatedAt", "completedAt",
    }
    assert resource["status"] == "queued"
    assert resource["inputHash"].startswith("sha256:")
    assert resource["attempt"] == {
        "reason": "initial", "previousAttemptId": None, "supersededBy": None,
    }

    events = jobs_client.get(
        f"/api/jobs/{resource['jobId']}/events", headers=jobs_headers
    ).json()
    assert [event["eventType"] for event in events] == ["job.created"]
    # the event cursor is monotonic and resumable
    after = jobs_client.get(
        f"/api/jobs/{resource['jobId']}/events",
        params={"after": events[-1]["id"]},
        headers=jobs_headers,
    ).json()
    assert after == []


def test_unknown_action_kind_is_rejected(jobs_client, jobs_headers, ftd_session) -> None:
    response = jobs_client.post(
        "/api/jobs/actions/ftd.not_a_thing",
        json={
            "requestId": "req-contract-nokind",
            "sessionId": ftd_session.session_id,
            "revision": ftd_session.revision,
        },
        headers=jobs_headers,
    )
    assert response.status_code == 404


def test_unregistered_handler_kind_fails_terminally_without_livelock(
    jobs_env, ftd_session
) -> None:
    body = StartJobRequest(
        requestId="req-contract-nohandler",
        sessionId=ftd_session.session_id,
        revision=ftd_session.revision,
        inputs={"dogKey": "dog-1"},
    )
    job, _ = jobs_env.service.start("ftd.background_generate", body)
    # a claimed kind whose handler entry is missing must fail terminally, not spin
    worker = jobs_env.make_worker({"ftd.background_generate": None})
    assert worker.run_once()
    finished = jobs_env.jobs.get_job(job.id)
    assert finished.status == "failed_terminal"
    assert not worker.run_once()


def test_jobs_are_absent_from_unauthorized_requests(jobs_client) -> None:
    assert jobs_client.get("/api/jobs").status_code in (401, 403)


def test_openapi_document_is_pinned_without_drift() -> None:
    committed = (TOOL_ROOT / "openapi.json").read_bytes()
    assert committed == openapi_bytes(), (
        "openapi.json drifted; regenerate with scripts/generate_contracts.py"
    )


def test_generated_typescript_is_derived_without_drift() -> None:
    committed = (TOOL_ROOT / "ui" / "src" / "api" / "generated.ts").read_text()
    document = json.loads((TOOL_ROOT / "openapi.json").read_text())
    assert committed == generate_typescript(document), (
        "ui/src/api/generated.ts drifted; regenerate with scripts/generate_contracts.py"
    )


def test_openapi_pins_operation_ids_and_durability_extensions() -> None:
    document = json.loads((TOOL_ROOT / "openapi.json").read_text())
    operations = {
        operation.get("operationId"): operation
        for methods in document["paths"].values()
        for operation in methods.values()
        if isinstance(operation, dict)
    }
    for required in (
        "startFtdDurableAction",
        "getDurableJob",
        "listDurableJobs",
        "listDurableJobEvents",
        "cancelDurableJob",
        "retryDurableJob",
        "forceNewDurableJob",
        "mintApprovalGrant",
        "downloadDurableJobArtifact",
    ):
        assert required in operations, f"missing pinned operation {required}"
    assert operations["startFtdDurableAction"]["x-ftd-durability"] == "durable-job"
    assert operations["forceNewDurableJob"]["x-ftd-approval"] == "single-use-grant"
    assert operations["mintApprovalGrant"]["x-ftd-authorization"] == "human-approval"
