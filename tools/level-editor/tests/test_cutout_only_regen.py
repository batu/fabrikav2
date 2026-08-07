import json

from PIL import Image


def test_cutout_extraction_prompt_supports_public_package_only_levels(app_client, isolated_session):
    session_id = "public_bird_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    public_dir.mkdir(parents=True)
    Image.new("RGB", (120, 120), (80, 100, 120)).save(public_dir / "color.png")
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Public bird level",
        "entity": "bird",
        "dogs": [{"id": "bird-0", "x": 42, "y": 57, "r": 19}],
    }))

    session_response = app_client.get(f"/api/sessions/{session_id}")
    response = app_client.get(f"/api/sessions/{session_id}/cutout-extraction-prompt")

    assert session_response.status_code == 200
    assert session_response.json()["hitboxes"] == [{"x": 42, "y": 57, "r": 19, "id": "bird-0"}]
    assert session_response.json()["dogs"][0]["id"] == "bird-0"
    assert response.status_code == 200
    assert response.json()["entity"] == "bird"
    assert "exactly ONE selected cartoon bird" in response.json()["prompt"]


def test_manual_sprite_placement_updates_public_level_and_sidecar(app_client, isolated_session, monkeypatch):
    from levelbuilder.api import sprite_eval

    session_id = "manual_sprite_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    dog_dir = public_dir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "color.png")
    Image.new("RGBA", (40, 40), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    sprite = {"image": f"levels/{session_id}/dogs/dog_00/sprite_000.png", "x": 70, "y": 70, "width": 60, "height": 60, "cleanup": {"x": 60, "y": 60, "width": 80, "height": 80}, "anchorX": 0.5, "anchorY": 0.5}
    # Panoramic exports can store hitboxes in a section-local frame while the
    # sprite geometry is global. The sprite anchor is the portable target.
    (public_dir / "level.json").write_text(json.dumps({"id": session_id, "name": "Manual sprite", "width": 200, "height": 200, "dogs": [{"id": "dog_00", "x": 10, "y": 20, "r": 20, "sprite": sprite}]}))
    (dog_dir / "sprite_000.json").write_text(json.dumps({"image": "dogs/dog_00/sprite_000.png", "spriteBox": [70, 70, 130, 130], "cleanupBox": [60, 60, 140, 140], "width": 60, "height": 60, "anchorX": 0.5, "anchorY": 0.5, "quality": {"pickupUsable": True}}))
    monkeypatch.setattr(isolated_session, "refresh_catalog_packages", lambda ids: {"refreshedLevels": ids})
    real_apply = sprite_eval.apply_match_report
    placement_lock_states = []

    def locked_apply(*args, **kwargs):
        placement_lock_states.append(isolated_session._session_lock.locked())
        return real_apply(*args, **kwargs)

    monkeypatch.setattr(sprite_eval, "apply_match_report", locked_apply)

    overlay = app_client.get(f"/api/sessions/{session_id}/sprite-candidates/dog_00:sprite_000/overlay?cropBox=50,50,150,150&spriteBox=70,70,130,130")
    scene_only = app_client.get(f"/api/sessions/{session_id}/sprite-candidates/dog_00:sprite_000/overlay?cropBox=50,50,150,150&spriteBox=70,70,130,130&sceneOnly=true")
    response = app_client.put(
        f"/api/sessions/{session_id}/sprite-candidates/dog_00:sprite_000/placement",
        json={"spriteBox": [65, 75, 135, 125], "flipX": True, "flipY": True},
    )

    assert overlay.status_code == 200
    assert overlay.headers["content-type"] == "image/png"
    assert scene_only.status_code == 200
    assert scene_only.content != overlay.content
    assert response.status_code == 200
    level = json.loads((public_dir / "level.json").read_text())
    metadata = json.loads((dog_dir / "sprite_000.json").read_text())
    assert [level["dogs"][0]["sprite"][key] for key in ("x", "y", "width", "height")] == [65, 75, 70, 50]
    assert metadata["spriteBox"] == [65, 75, 135, 125]
    assert metadata["anchorX"] == 0.5
    assert metadata["anchorY"] == 0.5
    assert level["dogs"][0]["sprite"]["flipX"] is True
    assert level["dogs"][0]["sprite"]["flipY"] is True
    assert metadata["flipX"] is True
    assert metadata["flipY"] is True
    candidates = app_client.get(f"/api/sessions/{session_id}/sprite-candidates").json()["candidates"]
    assert candidates[0]["flipX"] is True
    assert candidates[0]["flipY"] is True
    assert placement_lock_states == [True]


def test_cutout_only_regen_never_rewrites_scene_or_hitboxes(isolated_session, monkeypatch):
    from levelbuilder.api import flatkey, inpaint

    session_id = "cutout_only_test"
    sdir = isolated_session.LEVELS_DIR / session_id
    dog_dir = sdir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (200, 160), (80, 100, 120)).save(sdir / "color.png")
    Image.new("RGBA", (40, 50), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    Image.new("L", (40, 50), 255).save(dog_dir / "sprite_mask_000.png")
    Image.new("RGB", (80, 80), (80, 100, 120)).save(dog_dir / "variant_000.png")
    (sdir / "hitboxes.json").write_text(json.dumps([{"id": "bird-0", "x": 100, "y": 80, "r": 20}]))
    (sdir / "session.json").write_text(json.dumps({
        "model": "google/gemini-3.1-flash-image-preview",
        "entity": "bird",
        "dogs": [{"id": "bird-0", "index": 0, "activeVariant": 0}],
    }))
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "mask": "dogs/dog_00/sprite_mask_000.png",
        "sourceVariant": "dogs/dog_00/variant_000.png",
        "spriteBox": [80, 55, 120, 105],
        "cleanupBox": [75, 50, 125, 110],
        "quality": {"pickupUsable": True},
    }))

    color_before = (sdir / "color.png").read_bytes()
    hitboxes_before = (sdir / "hitboxes.json").read_bytes()
    variant_before = (dog_dir / "variant_000.png").read_bytes()
    monkeypatch.setattr(
        flatkey,
        "flatkey_recreate_sprite",
        lambda *_args, **_kwargs: Image.new("RGBA", (30, 45), (20, 180, 80, 255)),
    )
    placements = []
    monkeypatch.setattr(
        inpaint, "_auto_place_cutout_best_safe",
        lambda *args: placements.append(args) or {"accepted": True, "method": "color"},
    )

    result = inpaint._run_single_cutout_extraction(
        session_id, 0, crop_box=(60, 40, 140, 120),
    )

    assert result["variantIndex"] == 0
    assert result["file"] == "dogs/dog_00/sprite_000.png"
    assert placements == [(session_id, 0, 0)]
    assert (sdir / "color.png").read_bytes() == color_before
    assert (sdir / "hitboxes.json").read_bytes() == hitboxes_before
    assert (dog_dir / "variant_000.png").read_bytes() == variant_before
    metadata = json.loads((dog_dir / "sprite_000.json").read_text())
    assert metadata["technique"] == "flatkey-recreate-cutout-only-v2"
    assert metadata["sourceBox"] == [60, 40, 140, 120]
    assert metadata["cleanupBox"] == [60, 40, 140, 120]


def test_cutout_retry_accepts_public_package_without_session_or_hitboxes_file(isolated_session, monkeypatch):
    from levelbuilder.api import flatkey, inpaint

    session_id = "public_cutout_retry"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    dog_dir = public_dir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "color.png")
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "bg_00.png")
    Image.new("RGBA", (40, 50), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "spriteBox": [80, 55, 120, 105],
        "cleanupBox": [75, 50, 125, 110],
        "quality": {"pickupUsable": True},
    }))
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Public cutout retry",
        "width": 200,
        "height": 200,
        "dogs": [{
            "id": "bird-0", "x": 100, "y": 80, "r": 20,
            "sprite": {"image": f"levels/{session_id}/dogs/dog_00/sprite_000.png"},
        }],
    }))

    request = inpaint.RetryFailedDogsJobRequest(
        dogIndices=[0],
        prompt="Extract and duplicate the selected bird only.",
        inpaintModel="google/gemini-3.1-flash-lite-image",
        cropBoxes={0: (60, 40, 140, 120)},
        cutoutOnly=True,
    )

    job = inpaint._start_retry_failed_dogs_job_record(session_id, request)

    assert job.session_id == session_id
    assert job.metadata["dogIndices"] == [0]
    assert job.metadata["model"] == "google/gemini-3.1-flash-lite-image"
    assert job.metadata["cropBoxes"] == {"0": [60, 40, 140, 120]}
    assert isolated_session.ensure_session_json(session_id)["dogs"][0]["activeVariant"] == 0

    used_models = []
    monkeypatch.setattr(
        flatkey,
        "flatkey_recreate_sprite",
        lambda *_args, **kwargs: used_models.append(kwargs["model"]) or Image.new("RGBA", (30, 45), (20, 180, 80, 255)),
    )
    result = inpaint._run_single_cutout_extraction(
        session_id, 0, crop_box=(60, 40, 140, 120),
        inpaint_model=job.metadata["model"],
    )

    assert result["variantIndex"] == 0
    assert result["file"] == "dogs/dog_00/sprite_000.png"
    assert used_models
    assert set(used_models) == {"google/gemini-3.1-flash-lite-image"}
    assert not (public_dir / "session.json").exists()


def test_best_safe_auto_placement_updates_sprite_sidecar_and_public_level(isolated_session, monkeypatch):
    from levelbuilder.api import inpaint, sprite_eval

    session_id = "auto_place_public"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    dog_dir = public_dir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "bg_00.png")
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "color.png")
    Image.new("RGBA", (40, 50), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "sourceBox": [50, 40, 150, 140],
        "spriteBox": [80, 55, 120, 105],
        "cleanupBox": [75, 50, 125, 110],
        "quality": {"pickupUsable": True},
    }))
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id, "name": "Auto placement", "width": 200, "height": 200,
        "dogs": [{
            "id": "bird-0", "x": 100, "y": 80, "r": 20,
            "sprite": {"image": f"levels/{session_id}/dogs/dog_00/sprite_000.png"},
        }],
    }))
    monkeypatch.setattr(sprite_eval, "match_cutout", lambda *_args, **_kwargs: {"best": {
        "accepted": True, "method": "color", "score": 0.91,
        "fittedBox": [70, 45, 130, 115],
    }})

    result = inpaint._auto_place_cutout_best_safe(session_id, 0, 0)

    assert result["accepted"] is True
    metadata = json.loads((dog_dir / "sprite_000.json").read_text())
    level = json.loads((public_dir / "level.json").read_text())
    assert metadata["spriteBox"] == [70, 45, 130, 115]
    assert metadata["autoPlacement"]["method"] == "color"
    assert [level["dogs"][0]["sprite"][key] for key in ("x", "y", "width", "height")] == [70, 45, 60, 70]


def test_regeneration_cuts_sprite_then_runs_best_safe_placement(isolated_session, monkeypatch):
    from levelbuilder.api import inpaint

    session_id = "regen_auto_place"
    sdir = isolated_session.LEVELS_DIR / session_id
    sdir.mkdir(parents=True)
    Image.new("RGB", (160, 160), (80, 100, 120)).save(sdir / "bg_00.png")
    (sdir / "hitboxes.json").write_text(json.dumps([{"id": "bird-0", "x": 80, "y": 80, "r": 20}]))
    (sdir / "session.json").write_text(json.dumps({
        "model": "google/gemini-3.1-flash-image-preview",
        "inpaint_model": "google/gemini-3.1-flash-image-preview",
        "selected_bg": 0,
        "entity": "bird",
        "dogs": [{"id": "bird-0", "index": 0, "activeVariant": None}],
    }))
    monkeypatch.setattr(
        inpaint, "edit_image",
        lambda source, *_args, **_kwargs: Image.new("RGB", source.size, (200, 80, 30)),
    )
    sprite_cuts = []
    monkeypatch.setattr(
        inpaint, "_save_sprite_assets",
        lambda **kwargs: sprite_cuts.append(kwargs["variant_idx"]) or {"quality": {"pickupUsable": True}},
    )
    placements = []
    monkeypatch.setattr(
        inpaint, "_auto_place_cutout_best_safe",
        lambda *args, **kwargs: placements.append((args, kwargs)) or {"accepted": True, "method": "hybrid"},
    )

    result = inpaint._run_single_dog_regen(
        session_id, 0, prompt="Paint one bird", padding=2.75,
        inpaint_model="google/gemini-3.1-flash-image-preview", defer_composite=True,
    )

    assert sprite_cuts == [0]
    assert placements[0][0] == (session_id, 0, 0)
    assert placements[0][1]["painted_box"] == (25, 25, 135, 135)
    assert placements[0][1]["painted_crop"].size == (110, 110)
    assert result["placement"] == {"accepted": True, "method": "hybrid"}
