"""AE19/R19: opaque, root-confined artifact references and provider-free reuse."""

from __future__ import annotations

import os

import pytest

from ftd_editor.artifacts import ArtifactRejected
from ftd_editor.jobs.actions import StartJobRequest

KIND = "ftd.dog_variant_upscale"


def completed_job_with_artifact(jobs_env, snapshot, request_id="req-artifact-0001"):
    body = StartJobRequest(
        requestId=request_id,
        sessionId=snapshot.session_id,
        revision=snapshot.revision,
        inputs={"dogKey": "dog-1", "salt": request_id},
    )
    job, _ = jobs_env.service.start(KIND, body)

    def handler(context):
        context.register_artifact(
            context.job.id,
            b"artifact-bytes",
            display_name="up scale/../result!!.png",
            media_type="image/png",
        )
        return {"ok": True}

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()
    return jobs_env.jobs.get_job(job.id)


def test_valid_download_is_opaque_checksummed_and_nosniff(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    job = completed_job_with_artifact(jobs_env, ftd_session)
    resource = jobs_client.get(f"/api/jobs/{job.id}", headers=jobs_headers).json()
    assert len(resource["artifacts"]) == 1
    reference = resource["artifacts"][0]
    assert reference["artifactId"].startswith("artifact-")
    assert "/" not in reference["displayName"] and ".." not in reference["displayName"]
    assert reference["checksum"].startswith("sha256:")
    # no operational path leaks through the reference
    assert "path" not in reference

    download = jobs_client.get(
        f"/api/jobs/{job.id}/artifacts/{reference['artifactId']}", headers=jobs_headers
    )
    assert download.status_code == 200
    assert download.content == b"artifact-bytes"
    assert download.headers["x-content-type-options"] == "nosniff"
    assert "attachment" in download.headers["content-disposition"]


def test_guessed_cross_job_traversal_and_symlink_downloads_fail(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    job = completed_job_with_artifact(jobs_env, ftd_session)
    artifact_id = jobs_env.jobs.list_artifacts(job.id)[0].artifact_id

    # guessed id
    guessed = jobs_client.get(
        f"/api/jobs/{job.id}/artifacts/artifact-{'0' * 32}", headers=jobs_headers
    )
    assert guessed.status_code == 404

    # traversal-shaped ids never reach the filesystem
    for hostile in ("..%2f..%2fsecret", "artifact-..", "%2e%2e/session.json"):
        response = jobs_client.get(
            f"/api/jobs/{job.id}/artifacts/{hostile}", headers=jobs_headers
        )
        assert response.status_code == 404

    # cross-job: a second job cannot serve the first job's artifact
    other = completed_job_with_artifact(
        jobs_env, jobs_env.sessions.load(ftd_session.session_id), "req-artifact-0002"
    )
    cross = jobs_client.get(
        f"/api/jobs/{other.id}/artifacts/{artifact_id}", headers=jobs_headers
    )
    assert cross.status_code == 404

    # symlink swap after registration fails closed
    record = jobs_env.jobs.list_artifacts(job.id)[0]
    stored = jobs_env.artifacts.root / record.relative_path
    outside = jobs_env.settings.workspace.state / "outside-secret"
    outside.write_bytes(b"outside")
    stored.unlink()
    os.symlink(outside, stored)
    swapped = jobs_client.get(
        f"/api/jobs/{job.id}/artifacts/{artifact_id}", headers=jobs_headers
    )
    assert swapped.status_code == 404


def test_tampered_artifact_bytes_fail_the_checksum_gate(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    job = completed_job_with_artifact(jobs_env, ftd_session)
    record = jobs_env.jobs.list_artifacts(job.id)[0]
    (jobs_env.artifacts.root / record.relative_path).write_bytes(b"tampered")
    response = jobs_client.get(
        f"/api/jobs/{job.id}/artifacts/{record.artifact_id}", headers=jobs_headers
    )
    assert response.status_code == 404


def test_unlisted_media_types_are_rejected_at_registration(jobs_env, ftd_session) -> None:
    body = StartJobRequest(
        requestId="req-artifact-media",
        sessionId=ftd_session.session_id,
        revision=ftd_session.revision,
        inputs={"dogKey": "dog-1"},
    )
    job, _ = jobs_env.service.start(KIND, body)
    with pytest.raises(ArtifactRejected):
        jobs_env.artifacts.register(
            job.id, b"<html>", display_name="page.html", media_type="text/html"
        )


def test_provider_free_reuse_returns_a_real_terminal_job(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    original = completed_job_with_artifact(jobs_env, ftd_session, "req-artifact-reuse-a")

    response = jobs_client.post(
        f"/api/jobs/actions/{KIND}",
        json={
            "requestId": "req-artifact-reuse-b",
            "sessionId": ftd_session.session_id,
            "revision": ftd_session.revision,
            "inputs": {"dogKey": "dog-1", "salt": "req-artifact-reuse-a"},
        },
        headers=jobs_headers,
    )
    assert response.status_code == 200
    reused = response.json()
    assert reused["jobId"] != original.id
    assert reused["status"] == "succeeded"
    assert reused["result"]["application"] == "reused"
    assert reused["result"]["reusedFromJobId"] == original.id
    assert len(reused["artifacts"]) == 1

    # the reused job is a real readable Job with its own events and downloads
    events = jobs_client.get(
        f"/api/jobs/{reused['jobId']}/events", headers=jobs_headers
    ).json()
    assert "job.artifact_reuse" in [event["eventType"] for event in events]
    download = jobs_client.get(
        f"/api/jobs/{reused['jobId']}/artifacts/{reused['artifacts'][0]['artifactId']}",
        headers=jobs_headers,
    )
    assert download.status_code == 200 and download.content == b"artifact-bytes"
