"""Paid work completes and commits readable bundles with zero observers.

No handler may depend on an HTTP request, an event stream, or a mounted UI:
jobs started over the wire finish through the worker alone, and the result
is discoverable afterwards by request identity with full artifacts.
"""

from __future__ import annotations

import pytest

from conftest import PaidEnv
from test_paid_job_kinds import ALL_KINDS, GOOD_INPUTS, run_all, script_happy, start


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_observer_free_completion_commits_readable_output(paid_env, paid_session, kind):
    script_happy(paid_env, kind)
    job, _ = start(paid_env, paid_session, kind, f"req-free-{kind}")
    # No reads, no events subscription, no UI: only the worker runs.
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "succeeded"
    artifacts = paid_env.env.jobs.list_artifacts(job.id)
    assert artifacts
    for record in artifacts:
        resolved = paid_env.env.artifacts.resolve_download(job.id, record.artifact_id)
        assert resolved.record.checksum == record.checksum
        assert len(resolved.content) == record.size


def test_dog_bundle_is_complete_and_discoverable_after_completion(paid_env, paid_session):
    kind = "ftd.crop_inpaint"
    script_happy(paid_env, kind)
    job, _ = start(paid_env, paid_session, kind, "req-bundle")
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "succeeded"
    assert final.result["application"] == "applied"
    manifest = paid_env.env.sessions.bundles.resolve_manifest(
        f"sessions/{paid_session.session_id}/dogs/dog-1/current"
    )
    members = {member["path"] for member in manifest["members"]}
    assert {
        "dogs/dog-1/variant_000.png",
        "dogs/dog-1/variant_000.box.json",
        "dogs/dog-1/sprite_000.png",
        "dogs/dog-1/sprite_000.json",
        "session.json",
    } <= members


def test_late_observer_rediscovers_by_request_identity(paid_env, paid_session):
    kind = "ftd.magenta_inpaint"
    script_happy(paid_env, kind)
    job, _ = start(paid_env, paid_session, kind, "req-late-observer")
    run_all(paid_env.make_worker())
    found = paid_env.env.jobs.find_by_request_id(kind, "req-late-observer")
    assert found is not None and found.id == job.id and found.status == "succeeded"
    events = paid_env.env.jobs.list_events(job.id)
    assert events, "durable events must exist for a completed paid job"
