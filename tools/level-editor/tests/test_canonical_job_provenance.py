from __future__ import annotations

from copy import deepcopy

from test_canonical_bird_contract import _snapshot
from test_canonical_hitbox_cas import _canonical_session


def test_job_input_key_binds_identity_pixels_geometry_and_provider_parameters():
    from levelbuilder.api.canonical_job_provenance import capture_bird_job_input

    baseline = capture_bird_job_input(
        _snapshot(),
        bird_id="bird_018f4f34-cc65-7c21-b59d-9b44c8c02a33",
        operation="cutout-extraction",
        crop_box=(1, 2, 30, 40),
        model="gemini-flash",
        prompt="extract only the bird",
    )
    changed_crop = capture_bird_job_input(
        _snapshot(),
        bird_id=baseline.bird_id,
        operation="cutout-extraction",
        crop_box=(1, 2, 31, 40),
        model="gemini-flash",
        prompt="extract only the bird",
    )
    changed_prompt = capture_bird_job_input(
        _snapshot(),
        bird_id=baseline.bird_id,
        operation="cutout-extraction",
        crop_box=(1, 2, 30, 40),
        model="gemini-flash",
        prompt="different",
    )

    assert baseline.idempotency_key != changed_crop.idempotency_key
    assert baseline.idempotency_key != changed_prompt.idempotency_key
    assert baseline.to_dict()["birdId"] == baseline.bird_id


def test_job_input_revalidation_ignores_operational_order_but_rejects_stale_content():
    from levelbuilder.api.canonical_job_provenance import capture_bird_job_input, verify_bird_job_input

    snapshot = _snapshot()
    captured = capture_bird_job_input(
        snapshot,
        bird_id="bird_018f4f34-cc65-7c21-b59d-9b44c8c02a33",
        operation="regenerate",
        crop_box=(1, 2, 30, 40),
        model="gemini-flash",
        prompt="bird",
    )
    reordered = deepcopy(snapshot)
    reordered["birds"][0]["presentationOrder"] = 9
    assert verify_bird_job_input(reordered, captured).current is True

    moved = deepcopy(snapshot)
    moved["birds"][0]["hitbox"]["x"] += 1
    stale = verify_bird_job_input(moved, captured)
    assert stale.current is False
    assert stale.code == "bird_input_changed"

    deleted = deepcopy(snapshot)
    deleted["birds"] = []
    assert verify_bird_job_input(deleted, captured).code == "bird_missing"


def test_sibling_promotion_does_not_stale_unchanged_bird_input():
    from levelbuilder.api.canonical_job_provenance import capture_bird_job_input, verify_bird_job_input

    snapshot = _snapshot()
    sibling = deepcopy(snapshot["birds"][0])
    sibling["birdId"] = "bird_sibling"
    sibling["compatibilitySlot"] = "dog_01"
    sibling["presentationOrder"] = 1
    snapshot["birds"].append(sibling)
    captured = capture_bird_job_input(
        snapshot,
        bird_id=snapshot["birds"][0]["birdId"],
        operation="cutout-extraction",
        crop_box=(1, 2, 30, 40),
        model="gemini-flash",
        prompt="bird",
    )

    sibling_changed = deepcopy(snapshot)
    sibling_changed["birds"][1]["sprite"]["flipX"] = True
    assert verify_bird_job_input(sibling_changed, captured).current is True


def test_canonical_retry_job_records_bird_identity_and_rejects_stale_revision(isolated_session):
    from fastapi import HTTPException
    from levelbuilder.api.inpaint import RetryFailedDogsJobRequest, _start_retry_failed_dogs_job_record

    _store, pointer = _canonical_session(isolated_session, "canonical_job_capture")
    request = RetryFailedDogsJobRequest(
        birdIds=["bird_one"],
        prompt="regenerate bird",
        inpaintModel="test/model",
        cropBoxesByBirdId={"bird_one": (1, 2, 30, 40)},
        expectedContentRevision=pointer.content_revision,
    )
    job = _start_retry_failed_dogs_job_record("canonical_job_capture", request)
    assert job.metadata["birdInputs"][0]["birdId"] == "bird_one"
    assert job.metadata["birdInputs"][0]["contentRevision"] == pointer.content_revision
    assert job.metadata["dogIndices"] == [0]

    stale = request.model_copy(update={"expectedContentRevision": "sha256:" + "0" * 64})
    try:
        _start_retry_failed_dogs_job_record("canonical_job_capture", stale)
    except HTTPException as error:
        assert error.status_code == 409
        assert error.detail["code"] == "content_revision_conflict"
    else:  # pragma: no cover - fail closed is the assertion
        raise AssertionError("stale canonical job request was accepted")


def test_stale_job_is_rejected_before_provider_submission(isolated_session, monkeypatch):
    from levelbuilder.api import inpaint
    from levelbuilder.api.inpaint import RetryFailedDogsJobRequest

    store, pointer = _canonical_session(isolated_session, "canonical_job_stale_worker")
    job = inpaint._start_retry_failed_dogs_job_record(
        "canonical_job_stale_worker",
        RetryFailedDogsJobRequest(
            birdIds=["bird_one"],
            prompt="regenerate bird",
            inpaintModel="test/model",
            cropBoxesByBirdId={"bird_one": (1, 2, 30, 40)},
            expectedContentRevision=pointer.content_revision,
        ),
    )
    isolated_session.save_canonical_hitboxes_if_present(
        "canonical_job_stale_worker",
        [{"id": "bird_one", "x": 11, "y": 20, "r": 5}],
        expected_content_revision=pointer.content_revision,
    )
    monkeypatch.setattr(
        inpaint,
        "_run_single_dog_regen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider submitted")),
    )

    result = inpaint._run_retry_failed_dogs_job(job, inpaint.JOB_STORE)

    assert result["succeeded"] == 0
    assert result["stale"] == 1
    child = inpaint.JOB_STORE.list_child_jobs(job.id)[0]
    assert child.stage == "completed_stale"
    assert child.result["disposition"] == "needs_review"


def test_unattached_sprite_promotes_only_while_target_input_is_current(isolated_session):
    from levelbuilder.api.canonical_job_provenance import capture_bird_job_input

    store, pointer = _canonical_session(isolated_session, "canonical_artifact_promote")
    captured = capture_bird_job_input(
        store.read().snapshot,
        bird_id="bird_one",
        operation="cutout-extraction",
        crop_box=(1, 2, 30, 40),
        model="gemini-flash",
        prompt="bird",
    )
    artifact = isolated_session.LEVELS_DIR / "canonical_artifact_promote" / ".canonical" / "job-artifacts" / "j1" / "bird_one" / "sprite.png"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"new-sprite")
    metadata = {"spriteBox": [20, 30, 60, 80], "cleanupBox": [15, 25, 65, 85], "anchorX": 0.5, "anchorY": 0.6}

    promoted, disposition = isolated_session.promote_canonical_sprite_artifact(
        "canonical_artifact_promote",
        captured_input=captured.to_dict(),
        generation_id="job:j1",
        sprite_path=artifact,
        metadata=metadata,
    )
    assert disposition == "committed"
    assert promoted.content_revision != pointer.content_revision
    assert store.read().snapshot["birds"][0]["activeGeneration"]["generationId"] == "job:j1"

    stale_artifact = artifact.with_name("stale.png")
    stale_artifact.write_bytes(b"stale-sprite")
    rejected, disposition = isolated_session.promote_canonical_sprite_artifact(
        "canonical_artifact_promote",
        captured_input=captured.to_dict(),
        generation_id="job:stale",
        sprite_path=stale_artifact,
        metadata=metadata,
    )
    assert rejected is None
    assert disposition == "bird_input_changed"
    assert store.read().snapshot["birds"][0]["activeGeneration"]["generationId"] == "job:j1"
