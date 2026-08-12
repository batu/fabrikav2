import hashlib
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
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Manual sprite",
        "width": 200,
        "height": 200,
        # Stable dog folder indices are not guaranteed to equal list offsets;
        # retired entries can leave gaps in either representation.
        "dogs": [
            {"id": "retired", "x": 5, "y": 5, "r": 5},
            {"id": "dog_00", "x": 10, "y": 20, "r": 20, "sprite": sprite},
        ],
    }))
    # The reviewed hitbox is authoritative even when the exported level and
    # prior sprite anchor are stale. This is the exact state manual placement
    # exists to repair.
    (public_dir / "hitboxes.json").write_text(json.dumps([
        {"id": "dog_00", "x": 100, "y": 100, "r": 20},
    ]))
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
        json={
            "spriteBox": [65, 75, 135, 125],
            "cleanupBox": [55, 65, 145, 145],
            "flipX": True,
            "flipY": True,
        },
    )

    assert overlay.status_code == 200
    assert overlay.headers["content-type"] == "image/png"
    assert scene_only.status_code == 200
    assert scene_only.content != overlay.content
    assert response.status_code == 200
    level = json.loads((public_dir / "level.json").read_text())
    metadata = json.loads((dog_dir / "sprite_000.json").read_text())
    assert [level["dogs"][1]["sprite"][key] for key in ("x", "y", "width", "height")] == [65, 75, 70, 50]
    assert metadata["spriteBox"] == [65, 75, 135, 125]
    assert metadata["cleanupBox"] == [55, 65, 145, 145]
    assert level["dogs"][1]["sprite"]["cleanup"] == {"x": 55, "y": 65, "width": 90, "height": 80}
    assert metadata["anchorX"] == 0.5
    assert metadata["anchorY"] == 0.5
    assert level["dogs"][1]["sprite"]["flipX"] is True
    assert level["dogs"][1]["sprite"]["flipY"] is True
    assert metadata["flipX"] is True
    assert metadata["flipY"] is True
    candidates = app_client.get(f"/api/sessions/{session_id}/sprite-candidates").json()["candidates"]
    assert candidates[0]["flipX"] is True
    assert candidates[0]["flipY"] is True
    assert placement_lock_states == [True]


def test_manual_sprite_placement_allows_human_override_away_from_current_hitbox(
    app_client, isolated_session, monkeypatch,
):
    session_id = "manual_sprite_misses_hitbox"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    dog_dir = public_dir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "color.png")
    Image.new("RGBA", (40, 40), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "spriteBox": [20, 20, 60, 60],
        "anchorX": 0.5,
        "anchorY": 0.5,
        "quality": {"pickupUsable": True},
    }))
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "width": 200,
        "height": 200,
        "dogs": [{
            "id": "dog_00", "x": 40, "y": 40, "r": 20,
            "sprite": {
                "image": f"levels/{session_id}/dogs/dog_00/sprite_000.png",
                "x": 20, "y": 20, "width": 40, "height": 40,
                "anchorX": 0.5, "anchorY": 0.5,
            },
        }],
    }))
    (public_dir / "hitboxes.json").write_text(json.dumps([
        {"id": "dog_00", "x": 150, "y": 150, "r": 20},
    ]))
    monkeypatch.setattr(isolated_session, "refresh_catalog_packages", lambda ids: {"refreshedLevels": ids})

    response = app_client.put(
        f"/api/sessions/{session_id}/sprite-candidates/dog_00:sprite_000/placement",
        json={"spriteBox": [25, 30, 70, 80]},
    )

    assert response.status_code == 200
    level = json.loads((public_dir / "level.json").read_text())
    sidecar = json.loads((dog_dir / "sprite_000.json").read_text())
    assert [level["dogs"][0]["sprite"][key] for key in ("x", "y", "width", "height")] == [25, 30, 45, 50]
    assert sidecar["spriteBox"] == [25, 30, 70, 80]


def test_manual_sprite_placement_rejects_only_invalid_geometry(
    app_client, isolated_session, monkeypatch,
):
    session_id = "manual_sprite_geometry_validation"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    dog_dir = public_dir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "color.png")
    Image.new("RGBA", (40, 40), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "spriteBox": [80, 80, 120, 120],
        "anchorX": 0.5,
        "anchorY": 0.5,
        "quality": {"pickupUsable": True},
    }))
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "width": 200,
        "height": 200,
        "dogs": [{
            "id": "dog_00", "x": 100, "y": 100, "r": 20,
            "sprite": {
                "image": f"levels/{session_id}/dogs/dog_00/sprite_000.png",
                "x": 80, "y": 80, "width": 40, "height": 40,
                "anchorX": 0.5, "anchorY": 0.5,
            },
        }],
    }))
    monkeypatch.setattr(isolated_session, "refresh_catalog_packages", lambda ids: {"refreshedLevels": ids})

    reversed_box = app_client.put(
        f"/api/sessions/{session_id}/sprite-candidates/dog_00:sprite_000/placement",
        json={"spriteBox": [100, 100, 90, 120]},
    )
    outside_scene = app_client.put(
        f"/api/sessions/{session_id}/sprite-candidates/dog_00:sprite_000/placement",
        json={"spriteBox": [180, 180, 210, 210]},
    )

    assert reversed_box.status_code == 422
    assert reversed_box.json()["detail"]["error"] == "spriteBox must have positive width and height"
    assert outside_scene.status_code == 422
    assert outside_scene.json()["detail"]["error"] == "spriteBox must stay inside the scene"


def test_auto_place_sprites_runs_best_safe_for_ready_unconfirmed_candidates(
    app_client, isolated_session, monkeypatch,
):
    from levelbuilder.api import inpaint

    candidates = [
        {"id": "dog_00:sprite_000", "dogIndex": 0, "spriteIndex": 0, "status": "ready", "humanConfirmed": False},
        {"id": "dog_01:sprite_000", "dogIndex": 1, "spriteIndex": 0, "status": "ready", "humanConfirmed": True},
        {"id": "dog_02:sprite_000", "dogIndex": 2, "spriteIndex": 0, "status": "failed", "humanConfirmed": False},
    ]
    monkeypatch.setattr(isolated_session, "sprite_animation_candidates", lambda _session_id: candidates)
    monkeypatch.setattr(isolated_session, "require_hitboxes_blessed", lambda _session_id: {"current": True})
    calls = []

    def place(session_id, dog_index, variant_index):
        calls.append((session_id, dog_index, variant_index))
        return {"method": "best", "accepted": True, "fittedBox": [10, 20, 70, 90]}

    monkeypatch.setattr(inpaint, "_auto_place_cutout_best_safe", place)

    response = app_client.post(
        "/api/sessions/auto_place_level/sprite-candidates/auto-placement",
        json={"includeHumanConfirmed": False},
    )

    assert response.status_code == 200
    assert calls == [("auto_place_level", 0, 0)]
    assert response.json() == {
        "sessionId": "auto_place_level",
        "candidates": 3,
        "attempted": 1,
        "accepted": 1,
        "rejected": 0,
        "skippedHumanConfirmed": 1,
        "skippedUnavailable": 1,
        "placements": [{
            "candidateId": "dog_00:sprite_000",
            "dogIndex": 0,
            "spriteIndex": 0,
            "method": "best",
            "accepted": True,
            "fittedBox": [10, 20, 70, 90],
        }],
    }


def test_bless_level_records_golden_snapshot_without_changing_lineup(app_client, isolated_session):
    session_id = "blessed_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    dog_dir = public_dir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (120, 120), (80, 100, 120)).save(public_dir / "color.png")
    Image.new("RGBA", (30, 30), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    sprite_path = f"levels/{session_id}/dogs/dog_00/sprite_000.png"
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Blessed level",
        "width": 120,
        "height": 120,
        "dogs": [{"id": "dog_00", "x": 50, "y": 50, "r": 15, "sprite": {
            "image": sprite_path, "x": 40, "y": 40, "width": 30, "height": 30,
            "anchorX": 0.5, "anchorY": 0.5,
        }}],
    }))
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "spriteBox": [40, 40, 70, 70],
        "quality": {"pickupUsable": True},
    }))
    (public_dir / "hitboxes.json").write_text(json.dumps([
        {"id": "dog_00", "x": 50, "y": 50, "r": 15},
    ]))

    hitbox_response = app_client.put(
        f"/api/sessions/{session_id}/hitbox-review", json={"approved": True, "humanActor": "human:test"},
    )
    assert hitbox_response.status_code == 200

    response = app_client.put(f"/api/sessions/{session_id}/golden-review", json={"approved": True})

    assert response.status_code == 200
    review = json.loads((public_dir / "golden-review.json").read_text())
    assert review["approved"] is True
    assert review["reviewStage"] == "final-cutouts"
    assert len(review["hitboxesSha256"]) == 64
    assert review["trainingEligible"] is True
    assert review["affectsLineup"] is False
    assert review["birds"][0]["dogId"] == "dog_00"
    assert len(review["birds"][0]["spriteSha256"]) == 64
    metadata = json.loads((dog_dir / "sprite_000.json").read_text())
    assert metadata["humanReview"]["confirmed"] is True
    listed = app_client.get("/api/sessions?include_public=true").json()
    session = next(item for item in listed if item["id"] == session_id)
    assert session["goldenDatasetApproved"] is True
    assert session["hitboxesBlessed"] is True
    assert session["cutoutsFinalBlessed"] is True

    metadata["spriteBox"] = [42, 40, 72, 70]
    (dog_dir / "sprite_000.json").write_text(json.dumps(metadata))
    final_status = app_client.get(f"/api/sessions/{session_id}/final-cutout-review")
    assert final_status.status_code == 200
    assert final_status.json()["approved"] is False
    assert final_status.json()["finalCutoutReview"]["stale"] is True


def test_hitbox_blessing_becomes_stale_when_geometry_changes(app_client, isolated_session):
    session_id = "hitbox_review_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    public_dir.mkdir(parents=True)
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id, "name": "Hitbox review", "dogs": [],
    }))
    hitboxes_path = public_dir / "hitboxes.json"
    hitboxes_path.write_text(json.dumps([{"id": "dog_00", "x": 40, "y": 50, "r": 12}]))

    response = app_client.put(f"/api/sessions/{session_id}/hitbox-review", json={"approved": True, "humanActor": "human:test"})
    assert response.status_code == 200
    assert response.json()["hitboxReview"]["current"] is True

    hitboxes_path.write_text(json.dumps([{"id": "dog_00", "x": 44, "y": 50, "r": 12}]))
    status = app_client.get(f"/api/sessions/{session_id}/hitbox-review")
    assert status.status_code == 200
    assert status.json()["approved"] is False
    assert status.json()["hitboxReview"]["stale"] is True


def test_legacy_golden_review_without_hitboxes_file_preserves_both_blessings(
    app_client, isolated_session,
):
    session_id = "legacy_blessed_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    public_dir.mkdir(parents=True)
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Legacy blessed",
        "width": 120,
        "height": 120,
        "dogs": [{"id": "dog_00", "x": 50, "y": 60, "r": 15}],
    }))
    (public_dir / "golden-review.json").write_text(json.dumps({
        "schemaVersion": 1,
        "approved": True,
        "blessed": True,
        "reviewedAt": "2026-08-01T00:00:00+00:00",
    }))

    listed = app_client.get("/api/sessions?include_public=true").json()
    session = next(item for item in listed if item["id"] == session_id)
    assert session["hitboxesBlessed"] is True
    assert session["cutoutsFinalBlessed"] is True


def test_exported_legacy_review_is_stale_when_editable_level_changed(
    app_client, isolated_session,
):
    session_id = "changed_legacy_blessed_level"
    active_dir = isolated_session.LEVELS_DIR / session_id
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    active_dir.mkdir(parents=True)
    public_dir.mkdir(parents=True)
    public_level = {
        "id": session_id,
        "name": "Reviewed export",
        "width": 120,
        "height": 120,
        "dogs": [{"id": "dog_00", "x": 50, "y": 60, "r": 15}],
    }
    active_level = {
        **public_level,
        "name": "Changed editable session",
        "dogs": [{"id": "dog_00", "x": 75, "y": 60, "r": 15}],
    }
    public_level_path = public_dir / "level.json"
    public_level_path.write_text(json.dumps(public_level))
    (active_dir / "level.json").write_text(json.dumps(active_level))
    (active_dir / "hitboxes.json").write_text(json.dumps(active_level["dogs"]))
    (public_dir / "golden-review.json").write_text(json.dumps({
        "schemaVersion": 1,
        "approved": True,
        "blessed": True,
        "reviewedAt": "2026-08-01T00:00:00+00:00",
        "levelSha256": hashlib.sha256(public_level_path.read_bytes()).hexdigest(),
    }))

    listed = app_client.get("/api/sessions?include_public=true").json()
    session = next(item for item in listed if item["id"] == session_id)
    assert session["hitboxesBlessed"] is False
    assert session["hitboxesBlessingStale"] is True
    assert session["cutoutsFinalBlessed"] is False
    assert session["cutoutsFinalBlessingStale"] is True


def test_final_cutout_blessing_requires_current_hitbox_blessing(app_client, isolated_session):
    session_id = "ordered_review_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    public_dir.mkdir(parents=True)
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id, "name": "Ordered review", "dogs": [],
    }))
    (public_dir / "hitboxes.json").write_text(json.dumps([
        {"id": "dog_00", "x": 40, "y": 50, "r": 12},
    ]))

    response = app_client.put(
        f"/api/sessions/{session_id}/final-cutout-review", json={"approved": True, "humanActor": "human:test"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "hitboxes_not_blessed"
    assert "Bless the current hitboxes first" in response.json()["detail"]["error"]


def test_cutout_job_rejects_unblessed_hitboxes(app_client, isolated_session):
    session_id = "unblessed_cutout_job"
    sdir = isolated_session.LEVELS_DIR / session_id
    sdir.mkdir(parents=True)
    (sdir / "session.json").write_text(json.dumps({
        "model": "google/gemini-3.1-flash-image-preview",
        "dogs": [{"id": "dog_00", "index": 0, "activeVariant": 0}],
    }))
    (sdir / "hitboxes.json").write_text(json.dumps([
        {"id": "dog_00", "x": 50, "y": 50, "r": 12},
    ]))

    response = app_client.post(f"/api/sessions/{session_id}/dogs/retry-inpaint/jobs", json={
        "dogIndices": [0],
        "prompt": "Extract the bird",
        "cutoutOnly": True,
    })

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "hitboxes_not_blessed"


def test_unblessed_paint_records_pending_metadata_without_cutout(isolated_session):
    from levelbuilder.api import inpaint
    from levelbuilder.hitboxes import Hitbox

    dog_dir = isolated_session.LEVELS_DIR / "pending_cutout" / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    metadata = inpaint._save_pending_sprite_metadata(
        dog_dir=dog_dir,
        variant_idx=0,
        hitbox=Hitbox(x=50, y=60, radius=12),
        box=(20, 30, 90, 100),
    )

    assert metadata["technique"] == "pending-hitbox-blessing"
    assert metadata["quality"]["pendingHitboxBlessing"] is True
    assert (dog_dir / "sprite_000.json").is_file()
    assert not (dog_dir / "sprite_000.png").exists()


def test_bless_level_confirms_existing_workspace_and_public_sidecars(app_client, isolated_session):
    session_id = "dual_store_blessed_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    workspace_dir = isolated_session.LEVELS_DIR / session_id
    for base in (workspace_dir, public_dir):
        dog_dir = base / "dogs" / "dog_00"
        dog_dir.mkdir(parents=True)
        Image.new("RGB", (120, 120), (80, 100, 120)).save(base / "color.png")
        Image.new("RGBA", (30, 30), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
        (dog_dir / "sprite_000.json").write_text(json.dumps({
            "image": "dogs/dog_00/sprite_000.png",
            "spriteBox": [40, 40, 70, 70],
        }))
    level = {
        "id": session_id,
        "name": "Dual store blessed level",
        "dogs": [{"id": "dog_00", "sprite": {
            "image": f"levels/{session_id}/dogs/dog_00/sprite_000.png",
        }}],
    }
    (workspace_dir / "level.json").write_text(json.dumps(level))
    (public_dir / "level.json").write_text(json.dumps(level))
    for base in (workspace_dir, public_dir):
        (base / "hitboxes.json").write_text(json.dumps([
            {"id": "dog_00", "x": 50, "y": 50, "r": 15},
        ]))

    hitbox_response = app_client.put(
        f"/api/sessions/{session_id}/hitbox-review", json={"approved": True, "humanActor": "human:test"},
    )
    assert hitbox_response.status_code == 200

    response = app_client.put(f"/api/sessions/{session_id}/golden-review", json={"approved": True})

    assert response.status_code == 200
    for base in (workspace_dir, public_dir):
        metadata = json.loads((base / "dogs" / "dog_00" / "sprite_000.json").read_text())
        assert metadata["humanReview"]["confirmed"] is True


def test_bless_level_validates_all_birds_before_confirming_any(app_client, isolated_session):
    session_id = "incomplete_blessed_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    first_dir = public_dir / "dogs" / "dog_00"
    first_dir.mkdir(parents=True)
    Image.new("RGB", (120, 120), (80, 100, 120)).save(public_dir / "color.png")
    Image.new("RGBA", (30, 30), (200, 80, 30, 255)).save(first_dir / "sprite_000.png")
    first_metadata = {"image": "dogs/dog_00/sprite_000.png", "spriteBox": [40, 40, 70, 70]}
    first_sidecar = first_dir / "sprite_000.json"
    first_sidecar.write_text(json.dumps(first_metadata))
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Incomplete blessed level",
        "dogs": [
            {"id": "dog_00", "sprite": {"image": f"levels/{session_id}/dogs/dog_00/sprite_000.png"}},
            {"id": "dog_01", "sprite": {"image": f"levels/{session_id}/dogs/dog_01/sprite_000.png"}},
        ],
    }))
    (public_dir / "hitboxes.json").write_text(json.dumps([
        {"id": "dog_00", "x": 50, "y": 50, "r": 15},
        {"id": "dog_01", "x": 90, "y": 90, "r": 15},
    ]))
    hitbox_response = app_client.put(
        f"/api/sessions/{session_id}/hitbox-review", json={"approved": True, "humanActor": "human:test"},
    )
    assert hitbox_response.status_code == 200
    before = first_sidecar.read_bytes()

    response = app_client.put(f"/api/sessions/{session_id}/golden-review", json={"approved": True})

    assert response.status_code == 422
    assert "dog_01" in response.json()["detail"]["error"]
    assert first_sidecar.read_bytes() == before


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
    isolated_session.set_hitbox_review(session_id, True, source="test")
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
        "quality": {
            "pickupUsable": True,
            "repairReason": "oversized_or_scene_mask",
            "backgroundFallback": True,
        },
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
    assert metadata["quality"] == {"pickupUsable": True}


def test_cutout_retry_accepts_blessed_public_package_without_session_file(isolated_session, monkeypatch):
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
        "anchorX": 0.5,
        "anchorY": 0.5,
        "quality": {"pickupUsable": True},
    }))
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Public cutout retry",
        "width": 200,
        "height": 200,
        "dogs": [{
            "id": "bird-0", "x": 10, "y": 20, "r": 20,
            "sprite": {"image": f"levels/{session_id}/dogs/dog_00/sprite_000.png"},
        }],
    }))
    (public_dir / "hitboxes.json").write_text(json.dumps([
        {"id": "bird-0", "x": 100, "y": 80, "r": 20},
    ]))
    isolated_session.set_hitbox_review(session_id, True, source="test")

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


def test_scene_regen_accepts_blessed_public_package_without_session_file(isolated_session, monkeypatch):
    from levelbuilder.api import inpaint

    session_id = "cozy_interiors_public_bakery_bird_7ba7"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    dog_dir = public_dir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "bg_00.png")
    Image.new("RGB", (200, 200), (80, 100, 120)).save(public_dir / "color.png")
    Image.new("RGBA", (40, 50), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": f"Level {session_id} (clean_old_cartoon)",
        "width": 200,
        "height": 200,
        "dogs": [{
            "id": "bird-0", "x": 100, "y": 100, "r": 20,
            "sprite": {"image": f"levels/{session_id}/dogs/dog_00/sprite_000.png"},
        }],
    }))
    (public_dir / "hitboxes.json").write_text(json.dumps([
        {"id": "bird-0", "x": 100, "y": 100, "r": 20},
    ]))
    isolated_session.set_hitbox_review(session_id, True, source="test")

    provider_calls = []

    def fake_provider(_fn, source, *_args, **_kwargs):
        provider_calls.append(source.size)
        return Image.new("RGB", source.size, (200, 80, 30))

    monkeypatch.setattr(inpaint, "_with_retries_and_timeout", fake_provider)
    monkeypatch.setattr(inpaint, "write_generation_sidecar", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(inpaint, "_save_sprite_assets", lambda **_kwargs: {"pickupUsable": True})
    monkeypatch.setattr(
        inpaint,
        "_auto_place_cutout_best_safe",
        lambda *_args, **_kwargs: {"accepted": True, "method": "best"},
    )

    result = inpaint._run_single_dog_regen(
        session_id,
        0,
        prompt="Regenerate this bird without changing the surrounding scene.",
        padding=2.75,
        crop_box=(60, 60, 140, 140),
        inpaint_model="google/gemini-3.1-flash-image-preview",
        defer_composite=True,
    )

    assert result["variantIndex"] == 0
    assert result["file"] == "dogs/dog_00/variant_000.png"
    assert provider_calls == [(80, 80)]
    assert inpaint.compose_with_mask(session_id) is not None
    synthesized = isolated_session.ensure_session_json(session_id)
    assert synthesized["entity"] == "bird"
    assert synthesized["style"] == "clean_old_cartoon"
    assert "bird" in synthesized["dog_prompt"].lower()
    assert "dog" not in synthesized["dog_prompt"].lower()
    assert not (public_dir / "session.json").exists()
    assert (public_dir / "hitboxes.json").is_file()


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
    isolated_session.set_hitbox_review(session_id, True, source="test")
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
