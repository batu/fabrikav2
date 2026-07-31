"""RED: queue any subset of the three inpaint approaches and compare results.

Design: each selected mode runs in a CLONE of the session (shared background +
hitboxes, isolated dogs/color output), so approaches never clobber each other
and the comparison is three complete images. Magenta gains a durable job kind
in the process (it was SSE-request-owned since the fork).
"""

import json

import pytest


def _seed_session(sess, session_id: str) -> None:
    from PIL import Image

    sdir = sess.LEVELS_DIR / session_id
    sdir.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 96), "green").save(sdir / "bg_00.png")
    (sdir / "hitboxes.json").write_text(json.dumps(
        [{"x": 32, "y": 48, "r": 10, "id": "hb-0"}]))
    (sdir / "session.json").write_text(json.dumps({
        "model": "test/model", "inpaint_model": "test/model", "style": "lineart",
        "setting": "japan", "scene": "japan_morning_market", "entity": "bird",
        "view": "isometric", "dog_prompt": "add exactly one bird",
        "selected_bg": 0, "n_dogs": 1,
        "dogs": [],
    }))


def test_clone_copies_inputs_but_not_outputs(isolated_session):
    from levelbuilder.api.session import clone_session_for_comparison

    sess = isolated_session
    _seed_session(sess, "cmp_seed_01")
    (sess.LEVELS_DIR / "cmp_seed_01" / "dogs" / "dog_00").mkdir(parents=True)
    (sess.LEVELS_DIR / "cmp_seed_01" / "color.png").write_bytes(b"old output")

    clone_id = clone_session_for_comparison("cmp_seed_01", "magenta")
    clone_dir = sess.LEVELS_DIR / clone_id
    assert clone_id != "cmp_seed_01" and "magenta" in clone_id
    assert (clone_dir / "bg_00.png").is_file()
    assert (clone_dir / "hitboxes.json").is_file()
    assert not (clone_dir / "dogs").exists(), "dog outputs must not be cloned"
    assert not (clone_dir / "color.png").exists(), "composited output must not be cloned"
    raw = json.loads((clone_dir / "session.json").read_text())
    assert raw["comparison_of"] == "cmp_seed_01"
    assert raw["comparison_mode"] == "magenta"
    assert raw.get("dogs") == []  # the clone paints its own


def test_reclone_same_mode_replaces_previous(isolated_session):
    from levelbuilder.api.session import clone_session_for_comparison

    sess = isolated_session
    _seed_session(sess, "cmp_seed_02")
    first = clone_session_for_comparison("cmp_seed_02", "crop")
    (sess.LEVELS_DIR / first / "stale.marker").write_bytes(b"")
    second = clone_session_for_comparison("cmp_seed_02", "crop")
    assert second == first
    assert not (sess.LEVELS_DIR / first / "stale.marker").exists()


def test_compare_endpoint_starts_a_job_per_mode(app_client):
    from levelbuilder.api import session as sess

    _seed_session(sess, "cmp_api_01")
    response = app_client.post(
        "/api/sessions/cmp_api_01/compare-inpaint",
        json={"modes": ["crop", "crop_reference", "magenta"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert {entry["mode"] for entry in body["comparisons"]} == {"crop", "crop_reference", "magenta"}
    for entry in body["comparisons"]:
        assert entry["sessionId"].startswith("cmp_api_01")
        assert entry["jobId"]


def test_compare_endpoint_rejects_unknown_mode(app_client):
    from levelbuilder.api import session as sess

    _seed_session(sess, "cmp_api_02")
    response = app_client.post(
        "/api/sessions/cmp_api_02/compare-inpaint", json={"modes": ["crop", "van_gogh"]})
    assert response.status_code == 422


def test_compare_endpoint_requires_background(app_client):
    from levelbuilder.api import session as sess

    session_id = "cmp_api_03"
    sdir = sess.LEVELS_DIR / session_id
    sdir.mkdir(parents=True, exist_ok=True)
    (sdir / "session.json").write_text(json.dumps({"dogs": []}))
    response = app_client.post(
        f"/api/sessions/{session_id}/compare-inpaint", json={"modes": ["crop"]})
    assert response.status_code == 409


def test_run_magenta_inpaint_writes_full_output(isolated_session, monkeypatch):
    from PIL import Image

    from levelbuilder.api import inpaint as inp

    sess = isolated_session
    _seed_session(sess, "cmp_mag_01")
    monkeypatch.setattr(
        inp, "_with_retries_and_timeout",
        lambda fn, *a, **k: Image.new("RGB", (64, 96), "purple"),
    )
    result = inp.run_magenta_inpaint(
        "cmp_mag_01",
        hitbox_list=[{"x": 32, "y": 48, "r": 10, "id": "hb-0"}],
        dog_prompt="add exactly one bird",
        model="test/model",
    )
    sdir = sess.LEVELS_DIR / "cmp_mag_01"
    for name in ("color.png", "inpainted.png", "magenta_overlay.png", "bw.png", "eval.png", "level.json"):
        assert (sdir / name).is_file(), f"missing {name}"
    assert result["colorFile"] == "color.png"
    raw = json.loads((sdir / "session.json").read_text())
    assert raw["inpaint_mode"] == "magenta"
    assert all(d.get("status") == "done" for d in raw["dogs"])
    # and it must leave a generation sidecar like every other paid call
    assert (sdir / "inpainted.gen.json").is_file()


def test_durable_inpaint_request_accepts_magenta_mode():
    from levelbuilder.api import inpaint as inp

    request = inp.CropInpaintJobRequest(
        hitboxes=[{"x": 64, "y": 64, "r": 20}],
        dogPrompt="a small bird",
        inpaintModel="google/gemini-3.1-flash-image-preview",
        inpaintMode="magenta",
        hardDogPercent=0,
    )

    assert request.inpaintMode == "magenta"


def test_magenta_recompose_preserves_base_and_applies_repaired_variant(
    isolated_session,
):
    from PIL import Image

    from levelbuilder.api import inpaint as inp

    sess = isolated_session
    sess.create_session(
        "magenta_repair_01",
        scene_prompt="scene",
        dog_prompt="bird",
        style="clean_old_cartoon",
        model="test/model",
        n_options=1,
        n_dogs=1,
    )
    sdir = sess.session_dir("magenta_repair_01")
    Image.new("RGB", (64, 64), "white").save(sdir / "bg_00.png")
    Image.new("RGB", (64, 64), "green").save(sdir / "color.png")
    hitbox = sess.save_hitboxes(
        "magenta_repair_01", [{"x": 32, "y": 32, "r": 8}]
    )[0]
    sess.update_session_field(
        "magenta_repair_01",
        selected_bg=0,
        bg_width=64,
        bg_height=64,
        inpaint_mode="magenta",
        dogs=[{
            "id": hitbox["id"],
            "index": 0,
            "status": "done",
            "activeVariant": 0,
        }],
    )
    dog_dir = sess.dogs_dir("magenta_repair_01") / "dog_00"
    dog_dir.mkdir(parents=True)
    variant = Image.new("RGB", (32, 32), "white")
    for x in range(12, 20):
        for y in range(12, 20):
            variant.putpixel((x, y), (0, 0, 255))
    variant_path = dog_dir / "variant_000.png"
    variant.save(variant_path)
    inp._save_variant_box(variant_path, (16, 16, 48, 48))

    result = inp.compose_with_mask("magenta_repair_01")

    assert result is not None
    assert result.getpixel((0, 0)) == (0, 128, 0)
    assert result.getpixel((32, 32)) == (0, 0, 255)
    result.close()


def test_cli_compare_waits_on_every_mode(monkeypatch, capsys):
    from tests.test_cli_errors import _StubClient, _run

    stub = _StubClient({
        "/api/sessions/s1/compare-inpaint": {"sessionId": "s1", "comparisons": [
            {"mode": "crop", "sessionId": "s1__cmp_crop", "jobId": "j1"},
            {"mode": "magenta", "sessionId": "s1__cmp_magenta", "jobId": "j2"},
        ]},
        "/api/jobs/j1": {"status": "succeeded", "id": "j1"},
        "/api/jobs/j2": {"status": "failed_terminal", "id": "j2", "errorMessage": "provider said no"},
    })
    code, out = _run(monkeypatch, capsys, stub,
                     ["compare", "s1", "--modes", "crop,magenta", "--wait", "--force-disk"])
    assert code == 0
    body = json.loads(out)
    by_mode = {c["mode"]: c for c in body["comparisons"]}
    assert by_mode["crop"]["status"] == "succeeded"
    assert by_mode["magenta"]["error"] == "provider said no"


def test_compare_endpoint_clones_one_magenta_input_per_model(app_client, monkeypatch):
    from PIL import Image

    from levelbuilder.api import inpaint as inp
    from levelbuilder.api import session as sess

    sess.create_session(
        "cmp_models_01",
        scene_prompt="scene",
        dog_prompt="bird",
        style="clean_old_cartoon",
        model="google/gemini-3.1-flash-image-preview",
        bg_model="google/gemini-3.1-flash-image-preview",
        inpaint_model="google/gemini-3.1-flash-image-preview",
        n_options=1,
        n_dogs=1,
    )
    sdir = sess.session_dir("cmp_models_01")
    Image.new("RGB", (64, 96), "green").save(sdir / "bg_00.png")
    sess.update_session_field("cmp_models_01", selected_bg_index=0)
    sess.save_hitboxes("cmp_models_01", [{"x": 32, "y": 48, "r": 10}])
    monkeypatch.setattr(inp, "INPAINT_MODEL_IDS", {
        "google/gemini-3.1-flash-image-preview",
        "openai/gpt-image-2",
    })

    response = app_client.post("/api/sessions/cmp_models_01/compare-inpaint", json={
        "modes": ["magenta"],
        "models": [
            "google/gemini-3.1-flash-image-preview",
            "openai/gpt-image-2",
        ],
        "hardDogPercent": 0,
    })

    assert response.status_code == 200, response.text
    comparisons = response.json()["comparisons"]
    assert [item["model"] for item in comparisons] == [
        "google/gemini-3.1-flash-image-preview",
        "openai/gpt-image-2",
    ]
    assert len({item["sessionId"] for item in comparisons}) == 2


def test_reference_sheet_keeps_scene_aspect_ratio():
    from PIL import Image

    from levelbuilder.api.inpaint import Hitbox, _build_reference_crop_sheet

    scene = Image.new("RGB", (768, 1376), "white")
    crop = Image.new("RGB", (164, 164), "blue")
    sheet, _ = _build_reference_crop_sheet(
        scene,
        crop,
        [Hitbox(x=384, y=688, radius=30)],
        (302, 606, 466, 770),
    )

    assert sheet.width * scene.height == sheet.height * scene.width


def test_reference_panel_extraction_scales_coordinates_with_provider_output():
    from PIL import Image

    from levelbuilder.api.inpaint import _extract_reference_crop_panel

    original_sheet = Image.new("RGB", (100, 200), "black")
    original_sheet.paste(Image.new("RGB", (40, 40), "lime"), (30, 140))
    provider_output = original_sheet.resize((200, 400), Image.Resampling.NEAREST)

    crop = _extract_reference_crop_panel(
        provider_output,
        (30, 140, 70, 180),
        (40, 40),
        source_sheet_size=original_sheet.size,
    )

    assert crop.getpixel((20, 20)) == (0, 255, 0)


def test_broad_reference_diff_requires_subject_only_mask(monkeypatch):
    from PIL import Image, ImageDraw

    from levelbuilder.api import inpaint

    broad = Image.new("L", (100, 100), 255)
    repaired = Image.new("L", (100, 100), 0)
    ImageDraw.Draw(repaired).ellipse((35, 25, 65, 70), fill=255)
    monkeypatch.setattr(
        inpaint,
        "_sam2_sprite_alpha",
        lambda *args, **kwargs: repaired.copy(),
    )

    result = inpaint._subject_only_composite_mask(
        clean_crop=Image.new("RGB", (100, 100), "white"),
        painted=Image.new("RGB", (100, 100), "blue"),
        dog_mask=broad,
        hitbox=inpaint.Hitbox(x=50, y=50, radius=20),
        box=(0, 0, 100, 100),
    )

    assert result.getbbox() == (35, 25, 66, 71)


def test_broad_reference_diff_fails_closed_when_subject_cannot_be_isolated(monkeypatch):
    from PIL import Image

    from levelbuilder.api import inpaint

    for name in (
        "_sam2_sprite_alpha",
        "_semantic_sprite_alpha",
        "_color_seeded_sprite_alpha",
        "_sam_sprite_alpha",
        "_seeded_grabcut_sprite_alpha",
        "_localized_hitbox_sprite_alpha",
    ):
        monkeypatch.setattr(inpaint, name, lambda *args, **kwargs: None)

    result = inpaint._subject_only_composite_mask(
        clean_crop=Image.new("RGB", (100, 100), "white"),
        painted=Image.new("RGB", (100, 100), "blue"),
        dog_mask=Image.new("L", (100, 100), 255),
        hitbox=inpaint.Hitbox(x=50, y=50, radius=20),
        box=(0, 0, 100, 100),
    )

    assert result is None
