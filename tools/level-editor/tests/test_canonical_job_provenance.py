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
    painted = artifact.with_name("painted.png")
    painted.write_bytes(b"new-painted-crop")
    metadata = {"spriteBox": [20, 30, 60, 80], "cleanupBox": [15, 25, 65, 85], "anchorX": 0.5, "anchorY": 0.6}

    promoted, disposition = isolated_session.promote_canonical_sprite_artifact(
        "canonical_artifact_promote",
        captured_input=captured.to_dict(),
        generation_id="job:j1",
        sprite_path=artifact,
        painted_path=painted,
        metadata=metadata,
    )
    assert disposition == "committed"
    assert promoted.content_revision != pointer.content_revision
    assert store.read().snapshot["birds"][0]["activeGeneration"]["generationId"] == "job:j1"
    assert store.read().snapshot["birds"][0]["activeGeneration"]["paintedAsset"]["path"].endswith("painted.png")

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


def test_post_provider_revision_conflict_is_retained_and_never_resubmitted(isolated_session, monkeypatch):
    from fastapi import HTTPException
    from levelbuilder.api import inpaint
    from levelbuilder.api.inpaint import RetryFailedDogsJobRequest

    _store, pointer = _canonical_session(isolated_session, "canonical_job_post_provider_stale")
    job = inpaint._start_retry_failed_dogs_job_record(
        "canonical_job_post_provider_stale",
        RetryFailedDogsJobRequest(
            birdIds=["bird_one"],
            prompt="regenerate bird",
            inpaintModel="test/model",
            cropBoxesByBirdId={"bird_one": (1, 2, 30, 40)},
            expectedContentRevision=pointer.content_revision,
        ),
    )
    submissions = []

    def provider_then_conflict(*_args, **_kwargs):
        submissions.append("submitted")
        raise HTTPException(409, detail={"code": "bird_input_changed"})

    monkeypatch.setattr(inpaint, "_run_single_dog_regen", provider_then_conflict)

    first = inpaint._run_retry_failed_dogs_job(job, inpaint.JOB_STORE)
    second = inpaint._run_retry_failed_dogs_job(job, inpaint.JOB_STORE)

    assert submissions == ["submitted"]
    assert first["stale"] == second["stale"] == 1
    child = inpaint.JOB_STORE.list_child_jobs(job.id)[0]
    assert child.status == "succeeded"
    assert child.stage == "completed_stale"
    assert child.result["disposition"] == "needs_review"
    response = inpaint._retry_failed_dogs_job_response(inpaint.JOB_STORE.get_job(job.id))
    assert response.stale == 1
    assert response.units[0].birdId == "bird_one"
    assert response.units[0].inputContentRevision == pointer.content_revision
    assert response.units[0].stage == "completed_stale"
    assert response.units[0].disposition == "needs_review"


def test_regen_promotion_commits_the_painted_scene_with_coherent_provenance(isolated_session):
    import hashlib as _hashlib
    from PIL import Image
    from levelbuilder.api.canonical_job_provenance import capture_bird_job_input
    from test_canonical_hitbox_cas import _canonical_session

    store, pointer = _canonical_session(isolated_session, "canonical_scene_commit")
    session_dir = isolated_session.LEVELS_DIR / "canonical_scene_commit"

    # Real scene pixels so the composite has something to paste into.
    scene_file = session_dir / "color.png"
    Image.new("RGB", (64, 64), (10, 120, 10)).save(scene_file)
    snapshot = store.read().snapshot
    payload = scene_file.read_bytes()
    scene_digest = _hashlib.sha256(payload).hexdigest()
    snapshot["assets"]["scene"] = {"path": "color.png", "sha256": scene_digest, "bytes": len(payload)}
    snapshot["restore"]["sourceSceneSha256"] = scene_digest
    snapshot["birds"][0]["activeGeneration"]["inputSceneSha256"] = scene_digest
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)
    snapshot = store.read().snapshot
    snapshot["reviews"] = {
        "hitboxes": {"contentRevision": pointer.content_revision, "reviewer": "human:batu", "reviewedAt": "now"},
    }
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)

    captured = capture_bird_job_input(
        store.read().snapshot,
        bird_id="bird_one",
        operation="regenerate",
        crop_box=(20, 20, 36, 36),
        model="gemini-flash",
        prompt="bird",
    )
    artifact_dir = session_dir / ".canonical" / "job-artifacts" / "regen1" / "bird_one"
    artifact_dir.mkdir(parents=True)
    sprite_path = artifact_dir / "sprite_000.png"
    Image.new("RGBA", (10, 12), (200, 40, 40, 255)).save(sprite_path)
    painted_path = artifact_dir / "variant_000.png"
    Image.new("RGB", (16, 16), (240, 20, 20)).save(painted_path)

    promoted, disposition = isolated_session.promote_canonical_sprite_artifact(
        "canonical_scene_commit",
        captured_input=captured.to_dict(),
        generation_id="job:regen1",
        sprite_path=sprite_path,
        painted_path=painted_path,
        painted_box=(20, 20, 36, 36),
        metadata={"spriteBox": [20, 24, 30, 36], "cleanupBox": [18, 18, 38, 38], "anchorX": 0.5, "anchorY": 0.5},
    )
    assert disposition == "committed"

    current = store.read().snapshot
    new_scene = current["assets"]["scene"]
    assert new_scene["sha256"] != scene_digest
    on_disk = scene_file.read_bytes()
    assert _hashlib.sha256(on_disk).hexdigest() == new_scene["sha256"]
    with Image.open(scene_file) as composed:
        assert composed.getpixel((28, 28)) == (240, 20, 20)  # painted crop landed
        assert composed.getpixel((5, 5)) == (10, 120, 10)    # rest of scene untouched
    # Every provenance pointer advances to the composed scene together.
    assert all(bird["activeGeneration"]["inputSceneSha256"] == new_scene["sha256"] for bird in current["birds"])
    assert current["restore"]["sourceSceneSha256"] == new_scene["sha256"]
    # The repaint invalidates scene-dependent human reviews.
    assert "hitboxes" not in current.get("reviews", {})
    assert any(
        entry.get("kind") == "hitboxes" and "scene" in (entry.get("invalidatedBy") or [])
        for entry in current["operational"]["reviewHistory"]
    )
