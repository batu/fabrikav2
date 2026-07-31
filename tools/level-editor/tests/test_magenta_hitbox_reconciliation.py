import json


def test_reconcile_magenta_hitboxes_uses_one_detection_each(workspace_roots):
    from levelbuilder.api import session as sess

    sess.create_session(
        "magenta_reconcile_01",
        scene_prompt="scene",
        dog_prompt="bird",
        style="clean_old_cartoon",
        model="test/model",
        n_options=1,
        n_dogs=3,
    )
    original = sess.save_hitboxes("magenta_reconcile_01", [
        {"x": 100, "y": 100, "r": 30},
        {"x": 300, "y": 300, "r": 30},
        {"x": 500, "y": 500, "r": 30},
    ])
    detections = [
        {"x": 470, "y": 450, "width": 60, "height": 100, "confidence": 0.95},
        {"x": 80, "y": 110, "width": 40, "height": 60, "confidence": 0.98},
        {"x": 280, "y": 260, "width": 80, "height": 80, "confidence": 0.92},
    ]

    result = sess.reconcile_magenta_hitboxes_to_detections(
        "magenta_reconcile_01", detections=detections
    )

    saved = json.loads((sess.session_dir("magenta_reconcile_01") / "hitboxes.json").read_text())
    assert [(h["x"], h["y"]) for h in saved] == [(100, 140), (320, 300), (500, 500)]
    assert [h["id"] for h in saved] == [h["id"] for h in original]
    assert len({move["detectionIndex"] for move in result["moved"]}) == 3


def test_reconcile_magenta_hitboxes_rejects_missing_detections(workspace_roots):
    import pytest

    from levelbuilder.api import session as sess

    sess.create_session(
        "magenta_reconcile_02",
        scene_prompt="scene",
        dog_prompt="bird",
        style="clean_old_cartoon",
        model="test/model",
        n_options=1,
        n_dogs=2,
    )
    sess.save_hitboxes("magenta_reconcile_02", [
        {"x": 100, "y": 100, "r": 30},
        {"x": 300, "y": 300, "r": 30},
    ])

    with pytest.raises(sess.LevelNotReadyError, match="exactly 2"):
        sess.reconcile_magenta_hitboxes_to_detections(
            "magenta_reconcile_02",
            detections=[{"x": 80, "y": 80, "width": 40, "height": 40}],
        )


def test_finalize_one_shot_builds_playable_level_from_detections(workspace_roots):
    from PIL import Image

    from levelbuilder.api import session as sess

    sess.create_session(
        "one_shot_finalize_01",
        scene_prompt="finished birds",
        dog_prompt="bird",
        style="clean_old_cartoon",
        model="test/model",
        n_options=1,
        n_dogs=2,
        prompt_context={"oneShot": True, "oneShotCount": 2},
    )
    sdir = sess.session_dir("one_shot_finalize_01")
    Image.new("RGB", (768, 1376), "green").save(sdir / "bg_00.png")
    sess.update_session_field(
        "one_shot_finalize_01",
        selected_bg=0,
        bg_width=768,
        bg_height=1376,
    )

    result = sess.finalize_one_shot_from_detections(
        "one_shot_finalize_01",
        detections=[
            {"x": 80, "y": 110, "width": 40, "height": 60, "confidence": 0.98},
            {"x": 280, "y": 260, "width": 80, "height": 80, "confidence": 0.92},
        ],
    )

    assert result["hitboxes"] == 2
    assert (sdir / "color.png").read_bytes() == (sdir / "bg_00.png").read_bytes()
    level = json.loads((sdir / "level.json").read_text())
    assert len(level["dogs"]) == 2
