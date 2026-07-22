"""Every registered FTD paid kind passes the same durable spend-safety matrix.

Scripted providers only: request-identity reuse, input-hash conflict,
retryable failure and retry, ambiguous post-submit orphaning behind the
force-new grant, cancellation, resumable polling restart, and the
source-inventory scan proving no request-owned provider call or sprite
JSON mini-ledger survives in the migrated tree.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from conftest import PaidEnv, make_mp4, make_png
from ftd_editor.approvals import expected_acknowledgement
from ftd_editor.generation.boundary import TransportResponse
from ftd_editor.generation.paid import ProviderSubmission, ProviderPoll
from ftd_editor.jobs.actions import FTD_ACTION_KINDS, ForceNewJobRequest, StartJobRequest
from ftd_editor.jobs.store import AttemptNotAllowed, RequestIdentityConflict

HITBOX = {"x": 10, "y": 12, "w": 20, "h": 24}

DOG_INTENT = {"style": "clean_old_cartoon"}

GOOD_INPUTS: dict[str, dict] = {
    "ftd.dog_variant_upscale": {
        "target": "dog_variant",
        "dogId": "dog-1",
        "hitbox": HITBOX,
        "model": "fal-ai/esrgan",
    },
    "ftd.background_generate": {"sceneIntent": {"scene": "istanbul_market"}},
    "ftd.sprite_animate": {
        "dogId": "dog-1",
        "sourceCandidateId": "cand-1",
        "motionPreset": "idle",
    },
    "ftd.crop_inpaint": {"dogId": "dog-1", "hitbox": HITBOX, "dogIntent": DOG_INTENT},
    "ftd.retry_failed_dogs": {
        "dogs": [
            {"dogId": "dog-1", "hitbox": HITBOX, "dogIntent": DOG_INTENT},
            {"dogId": "dog-2", "hitbox": HITBOX, "dogIntent": {"style": "old_pixel_art"}},
        ]
    },
    "ftd.band_generate": {
        "side": "top",
        "nativeWidth": 1000,
        "nativeHeight": 1000,
        "sceneMeta": {"setting": "farm"},
    },
    "ftd.sequence_workflow": {"scenes": ["farm_barn"]},
    "ftd.multi_scene_generate": {"scenes": ["farm_barn", "farm_field"]},
    "ftd.magenta_inpaint": {"dogIntent": DOG_INTENT},
    "ftd.dog_regenerate": {"dogId": "dog-1", "hitbox": HITBOX, "dogIntent": {"style": "old_pixel_art"}},
}

ALL_KINDS = tuple(GOOD_INPUTS)

IMAGE_URL = "https://fal.media/outputs/result.png"
LAYER_URL = "https://media.app.layer.ai/outputs/animation.mp4"


def expected_spend(kind: str) -> int:
    if kind == "ftd.retry_failed_dogs":
        return len(GOOD_INPUTS[kind]["dogs"])
    if kind in ("ftd.sequence_workflow", "ftd.multi_scene_generate"):
        return len(GOOD_INPUTS[kind]["scenes"])
    return 1


def script_happy(paid: PaidEnv, kind: str) -> None:
    spend = expected_spend(kind)
    if kind == "ftd.sprite_animate":
        paid.layer.submit_script.append(ProviderSubmission(provider_job_id="layer-job-1"))
        paid.layer.poll_script.extend(
            [ProviderPoll(status="running"), ProviderPoll(status="succeeded", output_url=LAYER_URL)]
        )
        paid.transport.responses[LAYER_URL] = lambda: TransportResponse(
            status=200, media_type="video/mp4", chunks=[make_mp4()]
        )
        return
    paid.image.script.extend([ProviderSubmission(output_url=IMAGE_URL)] * spend)
    paid.transport.responses[IMAGE_URL] = lambda: TransportResponse(
        status=200, media_type="image/png", chunks=[make_png(640, 640)]
    )


def start(paid: PaidEnv, session, kind: str, request_id: str, inputs: dict | None = None):
    body = StartJobRequest(
        requestId=request_id,
        sessionId=session.session_id,
        revision=session.revision,
        inputs=inputs if inputs is not None else GOOD_INPUTS[kind],
        providerOptions={},
    )
    job, created = paid.service.start(kind, body)
    return job, created


def run_all(worker) -> int:
    steps = 0
    while worker.run_once():
        steps += 1
        if steps > 50:
            raise AssertionError("worker did not drain")
    return steps


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_request_identity_reuse_and_single_spend(paid_env, paid_session, kind):
    script_happy(paid_env, kind)
    first, created = start(paid_env, paid_session, kind, f"req-{kind}")
    assert created
    again, created_again = start(paid_env, paid_session, kind, f"req-{kind}")
    assert not created_again and again.id == first.id
    worker = paid_env.make_worker()
    run_all(worker)
    final = paid_env.env.jobs.get_job(first.id)
    assert final.status == "succeeded"
    # A replayed start after completion still returns the same canonical job.
    replay, replay_created = start(paid_env, paid_session, kind, f"req-{kind}")
    assert not replay_created and replay.id == first.id
    if kind == "ftd.sprite_animate":
        assert not paid_env.layer.submit_script
    else:
        assert len(paid_env.image.submissions) == expected_spend(kind)
    assert paid_env.env.jobs.list_artifacts(first.id)


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_changed_inputs_same_request_id_conflict(paid_env, paid_session, kind):
    start(paid_env, paid_session, kind, f"req-{kind}")
    changed = dict(GOOD_INPUTS[kind])
    changed["unrelatedDelta"] = "changed"
    with pytest.raises(RequestIdentityConflict):
        start(paid_env, paid_session, kind, f"req-{kind}", inputs=changed)


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_queued_cancel_is_immediate_and_free(paid_env, paid_session, kind):
    job, _ = start(paid_env, paid_session, kind, f"req-{kind}")
    paid_env.env.jobs.request_cancel(job.id)
    worker = paid_env.make_worker()
    run_all(worker)
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "cancelled"
    assert not paid_env.image.submissions and not paid_env.layer.polls


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_pre_side_effect_failure_is_retryable_then_retries(paid_env, paid_session, kind):
    from ftd_editor.app import FailClosedProviders

    job, _ = start(paid_env, paid_session, kind, f"req-{kind}")
    # A worker whose provider registry fails closed dies before any intent.
    broken = paid_env.env.make_worker(
        dict(paid_env.make_worker().handlers),
        providers=FailClosedProviders(),
        owner_id="broken-worker",
    )
    run_all(broken)
    failed = paid_env.env.jobs.get_job(job.id)
    assert failed.status == "failed_retryable" and failed.retryable
    assert not failed.metadata.get("providerSubmissionStarted")
    retried = paid_env.env.jobs.retry(job.id)
    script_happy(paid_env, kind)
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(retried.id)
    assert final.status == "succeeded"
    assert final.previous_attempt_id == job.id
    assert paid_env.env.jobs.get_job(job.id).superseded_by == retried.id


@pytest.mark.parametrize("kind", ALL_KINDS)
def test_ambiguous_post_submit_failure_requires_grant(paid_env, paid_session, kind):
    if kind == "ftd.sprite_animate":
        paid_env.layer.submit_script.append(RuntimeError("connection torn mid-submit"))
    else:
        paid_env.image.script.append(RuntimeError("connection torn mid-submit"))
    job, _ = start(paid_env, paid_session, kind, f"req-{kind}")
    run_all(paid_env.make_worker())
    orphaned = paid_env.env.jobs.get_job(job.id)
    assert orphaned.status == "orphaned_unknown"
    assert orphaned.metadata.get("providerSubmissionStarted")
    # Grant-free retry is forbidden for ambiguous spend.
    with pytest.raises(AttemptNotAllowed):
        paid_env.env.jobs.retry(job.id)
    # Force-new with a valid single-use grant creates one linked attempt.
    session = paid_env.env.sessions.load(paid_session.session_id)
    grant = paid_env.env.approvals.mint(
        actor="tester",
        action_kind=f"force_new:{kind}",
        request_binding=f"job:{job.id}",
        source_revision=session.revision,
        acknowledgement=expected_acknowledgement(f"force_new:{kind}", f"job:{job.id}"),
    )
    body = ForceNewJobRequest(
        requestId=f"req-{kind}-forced",
        sessionId=session.session_id,
        revision=session.revision,
        inputs=GOOD_INPUTS[kind],
        providerOptions={},
        grantId=grant.grant_id,
        actor="tester",
    )
    forced = paid_env.service.force_new(kind, job.id, body)
    script_happy(paid_env, kind)
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(forced.id)
    assert final.status == "succeeded"
    assert final.attempt_reason == "force_new"
    assert paid_env.env.jobs.get_job(job.id).superseded_by == forced.id


def test_sprite_restart_resumes_polling_without_resubmission(paid_env, paid_session):
    kind = "ftd.sprite_animate"
    paid_env.layer.submit_script.append(ProviderSubmission(provider_job_id="layer-job-9"))
    paid_env.layer.poll_script.append(RuntimeError("api restarted mid-poll"))
    job, _ = start(paid_env, paid_session, kind, "req-resume")
    worker = paid_env.make_worker()
    assert worker.run_once()
    parked = paid_env.env.jobs.get_job(job.id)
    assert parked.status == "polling"
    assert parked.metadata.get("providerJobId") == "layer-job-9"
    # The same owner resumes by provider identity: poll only, never resubmit.
    paid_env.layer.poll_script.append(ProviderPoll(status="succeeded", output_url=LAYER_URL))
    paid_env.transport.responses[LAYER_URL] = TransportResponse(
        status=200, media_type="video/mp4", chunks=[make_mp4()]
    )
    run_all(worker)
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "succeeded"
    assert not paid_env.layer.submit_script  # exactly one submission ever scripted
    assert len(paid_env.layer.polls) == 2


def test_restart_before_intent_runs_exactly_once(paid_env, paid_session):
    kind = "ftd.background_generate"
    job, _ = start(paid_env, paid_session, kind, "req-restart")
    # Simulate a worker that claimed the job and crashed before any intent.
    claimed = paid_env.env.jobs.claim_next_queued(owner="dead-worker", kinds=(kind,))
    assert claimed is not None and claimed.id == job.id
    script_happy(paid_env, kind)
    survivor = paid_env.make_worker(owner_id="survivor", stale_after_seconds=30.0)
    paid_env.env.clock.advance(120.0)
    requeued = survivor.sweep_stale()
    assert [record.id for record in requeued] == [job.id]
    run_all(survivor)
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "succeeded"
    assert len(paid_env.image.submissions) == 1


def test_mid_batch_failure_never_respends_completed_items(paid_env, paid_session):
    kind = "ftd.retry_failed_dogs"
    paid_env.transport.responses[IMAGE_URL] = lambda: TransportResponse(
        status=200, media_type="image/png", chunks=[make_png(640, 640)]
    )
    # dog-1 succeeds and is durably published; dog-2's submission tears mid-call.
    paid_env.image.script.extend(
        [ProviderSubmission(output_url=IMAGE_URL), RuntimeError("connection torn mid-batch")]
    )
    job, _ = start(paid_env, paid_session, kind, "req-mid-batch")
    run_all(paid_env.make_worker())
    orphaned = paid_env.env.jobs.get_job(job.id)
    assert orphaned.status == "orphaned_unknown"
    assert len(paid_env.image.submissions) == 2
    # Recovery via granted force-new must reuse dog-1's checkpoint: exactly one
    # more paid submission, never len(dogs) again.
    session = paid_env.env.sessions.load(paid_session.session_id)
    grant = paid_env.env.approvals.mint(
        actor="tester",
        action_kind=f"force_new:{kind}",
        request_binding=f"job:{job.id}",
        source_revision=session.revision,
        acknowledgement=expected_acknowledgement(f"force_new:{kind}", f"job:{job.id}"),
    )
    forced = paid_env.service.force_new(
        kind,
        job.id,
        ForceNewJobRequest(
            requestId="req-mid-batch-forced",
            sessionId=session.session_id,
            revision=session.revision,
            inputs=GOOD_INPUTS[kind],
            providerOptions={},
            grantId=grant.grant_id,
            actor="tester",
        ),
    )
    paid_env.image.script.append(ProviderSubmission(output_url=IMAGE_URL))
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(forced.id)
    assert final.status == "succeeded"
    assert len(paid_env.image.submissions) == 3
    applications = {entry["dogId"]: entry["application"] for entry in final.result["dogs"]}
    assert applications == {"dog-1": "reused_prior_attempt", "dog-2": "applied"}


def test_unknown_kind_start_is_rejected(paid_env, paid_session):
    with pytest.raises(KeyError):
        start(paid_env, paid_session, "ftd.not_a_kind", "req-unknown", inputs={})


def test_all_registered_kinds_have_handlers(paid_env):
    handlers = paid_env.make_worker().handlers
    assert set(handlers) == {action.kind for action in FTD_ACTION_KINDS}


def test_spend_safety_matrix_covers_every_registered_kind():
    # A kind added to the registry without a GOOD_INPUTS entry must fail
    # loudly here instead of silently dropping out of the paid matrix.
    assert set(ALL_KINDS) == {action.kind for action in FTD_ACTION_KINDS}


def test_source_inventory_no_request_owned_provider_call_or_mini_ledger():
    root = Path(__file__).resolve().parents[2]
    forbidden = (
        "animations/jobs",
        "_animation_job_path",
        "save_sprite_animation_job",
        "merceka_core",
        "fal.run/",
        "api.openai.com/v1",
    )
    route_owned_provider_markers = (
        "providers.require",
        "httpx",
        "aiohttp",
        "urllib.request",
        "http.client",
        "import requests",
        "from requests",
    )
    scanned = 0
    for path in sorted((root / "backend").rglob("*.py")) + sorted(
        (root / "ui" / "src").rglob("*.ts*")
    ):
        text = path.read_text(encoding="utf-8")
        scanned += 1
        for marker in forbidden:
            if marker == "fal.run/" and path.name == "boundary.py":
                continue  # the allowlist itself names provider hosts
            assert marker not in text, f"{path}: forbidden marker {marker!r}"
        # Provider execution lives only under generation/ and app composition;
        # no route/session module may own a provider call or HTTP client.
        if path.suffix == ".py" and "generation" not in path.parts and path.name != "app.py":
            for marker in route_owned_provider_markers:
                assert marker not in text, f"{path}: request-owned provider marker {marker!r}"
    assert scanned > 20
