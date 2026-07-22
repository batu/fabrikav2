"""Paid outputs survive races: stale apply retains, cancel retains, never applies.

Covers the U6 conflict scenarios: a session revision that moved after
submission keeps the paid bundle and the current session; a cancellation
racing a late provider output retains the artifact without applying it;
same-dog concurrent paid actions produce distinct complete bundles.
"""

from __future__ import annotations

from test_paid_job_kinds import GOOD_INPUTS, run_all, script_happy, start


def _bump_session(paid_env, session_id):
    snapshot = paid_env.env.sessions.load(session_id)
    return paid_env.env.sessions.mutate(
        session_id,
        expected_revision=snapshot.revision,
        mutation=lambda current: current.with_mapping(
            {**current.to_mapping(), "note": "moved on"}
        ),
    )


def test_stale_apply_preserves_paid_bundle_and_current_session(paid_env, paid_session):
    kind = "ftd.background_generate"
    script_happy(paid_env, kind)
    job, _ = start(paid_env, paid_session, kind, "req-stale")
    moved = _bump_session(paid_env, paid_session.session_id)
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(job.id)
    # The job still succeeds: the spend is real and the artifact is retained.
    assert final.status == "succeeded"
    assert final.result["application"] == "conflict"
    assert paid_env.env.jobs.list_artifacts(job.id)
    current = paid_env.env.sessions.load(paid_session.session_id)
    assert current.revision == moved.revision
    assert "background" not in current.session.to_mapping()


def test_stale_dog_apply_retains_artifact_without_bundle(paid_env, paid_session):
    kind = "ftd.crop_inpaint"
    script_happy(paid_env, kind)
    job, _ = start(paid_env, paid_session, kind, "req-stale-dog")
    _bump_session(paid_env, paid_session.session_id)
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "succeeded"
    assert final.result["application"] == "conflict"
    assert paid_env.env.jobs.list_artifacts(job.id)
    try:
        paid_env.env.sessions.bundles.resolve_manifest(
            f"sessions/{paid_session.session_id}/dogs/dog-1/current"
        )
        raise AssertionError("no bundle may be published against a stale revision")
    except FileNotFoundError:
        pass


def test_cancel_racing_late_output_retains_but_never_applies(paid_env, paid_session):
    kind = "ftd.background_generate"
    script_happy(paid_env, kind)
    job, _ = start(paid_env, paid_session, kind, "req-cancel-race")
    # The cancel lands while the provider output is being downloaded.
    paid_env.transport.on_get = lambda url: paid_env.env.jobs.request_cancel(job.id)
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "cancelled"
    artifacts = paid_env.env.jobs.list_artifacts(job.id)
    assert artifacts, "the late paid output must be retained"
    current = paid_env.env.sessions.load(paid_session.session_id)
    assert "background" not in current.session.to_mapping()
    assert current.revision == paid_session.revision


def test_same_dog_sequential_paid_actions_allocate_distinct_bundles(paid_env, paid_session):
    kind = "ftd.crop_inpaint"
    script_happy(paid_env, kind)
    first, _ = start(paid_env, paid_session, kind, "req-dog-a")
    run_all(paid_env.make_worker())
    assert paid_env.env.jobs.get_job(first.id).status == "succeeded"
    # A second, genuinely different paid action against the same dog at the
    # still-current revision (identical inputs would hit U4 artifact reuse).
    script_happy(paid_env, kind)
    session = paid_env.env.sessions.load(paid_session.session_id)
    changed = {**GOOD_INPUTS[kind], "prompt": "a different pose"}
    second, _ = start(paid_env, session, kind, "req-dog-b", inputs=changed)
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(second.id)
    assert final.status == "succeeded"
    assert final.result["variantIndex"] == 1
    manifest = paid_env.env.sessions.bundles.resolve_manifest(
        f"sessions/{paid_session.session_id}/dogs/dog-1/current"
    )
    members = {member["path"] for member in manifest["members"]}
    assert "dogs/dog-1/variant_001.png" in members
