import json

import cv2
import numpy as np
import pytest
from PIL import Image

from levelbuilder.api.sprite_eval import (
    apply_match_report,
    BirdInputs,
    evaluate_bird,
    evaluate_corpus,
    evaluate_level_dir,
    fit_color,
    fit_color_xy,
    fit_hybrid,
    fit_features,
    fit_silhouette,
    match_cutout,
    level_noise_floor,
)


def _flat(h, w, color):
    return np.full((h, w, 3), color, dtype=np.int16)


def _sprite(w, h, alpha=255, color=(200, 40, 40)):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (w, h), (*color, alpha)), (0, 0))
    return img


def _marked_sprite(w=20, h=20):
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 3] = 255
    for x in range(w):
        rgba[:, x, :3] = (30 + 9 * x, 220 - 7 * x, 40 + 5 * x)
    return Image.fromarray(rgba)


def _inputs(clean, scene, sprite, sprite_box, crop_box, floor=0.0, dog_id="dog_00"):
    return BirdInputs(
        dog_id=dog_id, sprite=sprite, sprite_box=sprite_box, crop_box=crop_box,
        clean_crop=clean, scene_crop=scene, noise_floor=floor,
    )


def test_clean_paint_covered_by_sprite_passes_both_axes():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[20:60, 20:60] = 250  # painted bird
    sprite = _sprite(40, 40)
    result = evaluate_bird(_inputs(clean, scene, sprite, (20, 20, 60, 60), (0, 0, 100, 100)))
    assert result["axes"]["exclusion"]["verdict"] == "pass"
    assert result["axes"]["coherence"]["verdict"] == "pass"
    assert result["axes"]["specks"]["count"] == 0


def test_sprite_over_unchanged_background_fails_exclusion():
    clean = _flat(100, 100, 100)
    scene = clean.copy()  # nothing painted: sprite is pure background leak
    sprite = _sprite(40, 40)
    result = evaluate_bird(_inputs(clean, scene, sprite, (20, 20, 60, 60), (0, 0, 100, 100)))
    assert result["axes"]["exclusion"]["verdict"] == "fail"


def test_silhouette_fit_recovers_translation_without_mutating_sprite():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[40:60, 40:60] = 250
    sprite = _sprite(20, 20)
    inputs = _inputs(clean, scene, sprite, (28, 30, 48, 50), (0, 0, 100, 100))

    result = fit_silhouette(inputs, max_shift=20, scales=(1.0,))

    assert result["fittedBox"] == [40, 40, 60, 60]
    assert result["score"] == pytest.approx(1.0)
    assert result["outlier"] is False
    assert inputs.sprite_box == (28, 30, 48, 50)


def test_silhouette_fit_recovers_uniform_scale():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[30:60, 30:60] = 250
    inputs = _inputs(clean, scene, _sprite(20, 20), (35, 35, 55, 55), (0, 0, 100, 100))

    result = fit_silhouette(inputs, max_shift=20, scales=(1.0, 1.5))

    assert result["fittedBox"] == [30, 30, 60, 60]
    assert result["scale"] == pytest.approx(1.5)
    assert result["score"] == pytest.approx(1.0)


def test_evaluation_resizes_native_sprite_to_declared_level_box():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[20:50, 20:50] = 250
    inputs = _inputs(clean, scene, _sprite(20, 20), (20, 20, 50, 50), (0, 0, 100, 100))

    result = evaluate_bird(inputs)

    assert result["spriteArea"] == 900
    assert result["axes"]["coherence"]["verdict"] == "pass"


def test_color_fit_prefers_matching_painted_color_over_same_shape_distractor():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[20:40, 20:40] = (40, 60, 220)  # wrong-color, same-shape distractor
    scene[50:70, 55:75] = (220, 60, 40)  # matching painted bird
    sprite = _sprite(20, 20, color=(220, 60, 40))
    inputs = _inputs(clean, scene, sprite, (40, 40, 60, 60), (0, 0, 100, 100))

    result = fit_color(inputs, max_shift=40, scales=(1.0,))

    assert result["fittedBox"] == [55, 50, 75, 70]
    assert result["score"] == pytest.approx(1.0)


def test_color_xy_fit_recovers_bounded_nonuniform_scale():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    sprite = _marked_sprite()
    scene[40:60, 35:57] = cv2.resize(np.asarray(sprite)[:, :, :3], (22, 20), interpolation=cv2.INTER_AREA)
    inputs = _inputs(
        clean, scene, sprite,
        (36, 39, 56, 59), (0, 0, 100, 100),
    )

    result = fit_color_xy(
        inputs, max_shift=20, scales=(1.0, 1.1), max_aspect_distortion=0.12,
    )

    assert result["fittedBox"] == [35, 40, 57, 60]
    assert result["scaleX"] == pytest.approx(1.1)
    assert result["scaleY"] == pytest.approx(1.0)
    assert result["aspectDistortion"] == pytest.approx(0.1)


def test_color_xy_fit_rejects_excessive_aspect_distortion():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    sprite = _marked_sprite()
    scene[40:60, 35:59] = cv2.resize(np.asarray(sprite)[:, :, :3], (24, 20), interpolation=cv2.INTER_AREA)
    inputs = _inputs(
        clean, scene, sprite,
        (36, 39, 56, 59), (0, 0, 100, 100),
    )

    result = fit_color_xy(
        inputs, max_shift=20, scales=(1.0, 1.2), max_aspect_distortion=0.12,
    )

    assert result["scaleX"] == result["scaleY"]
    assert result["aspectDistortion"] == pytest.approx(0.0)


def test_color_xy_fit_can_unlock_axes():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    sprite = _marked_sprite()
    scene[40:60, 35:59] = cv2.resize(np.asarray(sprite)[:, :, :3], (24, 20), interpolation=cv2.INTER_AREA)
    inputs = _inputs(
        clean, scene, sprite,
        (36, 39, 56, 59), (0, 0, 100, 100),
    )

    result = fit_color_xy(
        inputs, max_shift=20, scales=(1.0, 1.2), max_aspect_distortion=None,
    )

    assert result["fittedBox"] == [35, 40, 59, 60]
    assert result["scaleX"] == pytest.approx(1.2)
    assert result["scaleY"] == pytest.approx(1.0)
    assert result["aspectDistortion"] == pytest.approx(0.2)


def test_hybrid_fit_enforces_hitbox_and_avoids_color_distractor():
    clean = _flat(120, 120, 100)
    scene = clean.copy()
    scene[15:35, 15:35] = (220, 60, 40)  # perfect color, wrong location
    scene[65:85, 70:90] = (205, 65, 45)  # actual painted target
    sprite = _sprite(20, 20, color=(220, 60, 40))
    inputs = BirdInputs(
        dog_id="dog_00", sprite=sprite, sprite_box=(50, 50, 70, 70),
        crop_box=(0, 0, 120, 120), clean_crop=clean, scene_crop=scene,
        target_point=(80, 75),
    )

    result = fit_hybrid(inputs, max_shift=50, scales=(1.0,))

    assert result["fittedBox"] == [70, 65, 90, 85]
    assert result["hitboxSafe"] is True


def test_match_cutout_runs_requested_methods_and_best_falls_back_safely():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[40:60, 40:60] = (220, 60, 40)
    inputs = _inputs(clean, scene, _sprite(20, 20, color=(220, 60, 40)), (40, 40, 60, 60), (0, 0, 100, 100))

    results = match_cutout(inputs, ("color", "best"))

    assert list(results) == ["color", "best"]
    assert results["best"]["accepted"] is True
    assert results["best"]["method"] == "hybrid"


def test_match_cutout_rejects_unknown_method():
    clean = _flat(20, 20, 100)
    inputs = _inputs(clean, clean.copy(), _sprite(10, 10), (5, 5, 15, 15), (0, 0, 20, 20))

    with pytest.raises(ValueError, match="unknown cutout matching method"):
        match_cutout(inputs, ("telepathy",))


def test_feature_fit_fails_closed_when_sprite_has_no_features():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[40:60, 40:60] = 250
    inputs = _inputs(clean, scene, _sprite(20, 20), (40, 40, 60, 60), (0, 0, 100, 100))

    result = fit_features(inputs)

    assert result["accepted"] is False
    assert result["verdict"] == "fail"


def test_feature_fit_accepts_distributed_similarity_consensus():
    rng = np.random.default_rng(7)
    rgba = np.zeros((80, 80, 4), dtype=np.uint8)
    rgba[:, :, :3] = rng.integers(20, 240, size=(80, 80, 3), dtype=np.uint8)
    rgba[:, :, 3] = 255
    sprite = Image.fromarray(rgba)
    clean = _flat(180, 180, 100)
    scene = clean.copy()
    scene[55:135, 65:145] = rgba[:, :, :3]
    inputs = _inputs(clean, scene, sprite, (60, 50, 140, 130), (0, 0, 180, 180))

    result = fit_features(inputs)

    assert result["accepted"] is True
    assert result["fittedBox"] == [65, 55, 145, 135]
    assert result["coverage"] >= 0.08


def test_extra_foliage_outside_sprite_fails_coherence():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[20:40, 20:40] = 250  # bird, covered by sprite
    scene[50:95, 50:95] = 10  # foliage the sprite does not carry
    sprite = _sprite(20, 20)
    result = evaluate_bird(_inputs(clean, scene, sprite, (20, 20, 40, 40), (0, 0, 100, 100)))
    assert result["axes"]["coherence"]["verdict"] == "fail"
    assert result["axes"]["exclusion"]["verdict"] == "pass"


def test_satellite_speck_reported():
    sprite = Image.new("RGBA", (60, 40), (0, 0, 0, 0))
    sprite.paste(Image.new("RGBA", (30, 30), (200, 40, 40, 255)), (0, 5))
    sprite.paste(Image.new("RGBA", (5, 5), (200, 40, 40, 255)), (52, 2))  # detached crumb
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[20:60, 20:80] = 250
    result = evaluate_bird(_inputs(clean, scene, sprite, (20, 20, 80, 60), (0, 0, 100, 100)))
    assert result["axes"]["specks"]["count"] == 1


def test_reduced_input_mode_flags_not_crashes():
    result = evaluate_bird(
        BirdInputs(
            dog_id="dog_00", sprite=_sprite(10, 10), sprite_box=(0, 0, 10, 10),
            crop_box=(0, 0, 20, 20), clean_crop=None, scene_crop=None,
        )
    )
    assert result["axes"]["exclusion"]["verdict"] == "unscored"
    assert result["axes"]["exclusion"]["reducedInput"] is True
    assert result["axes"]["specks"]["verdict"] == "pass"


def test_empty_sprite_fails_with_evidence_not_exception():
    result = evaluate_bird(
        BirdInputs(
            dog_id="dog_00", sprite=_sprite(10, 10, alpha=0), sprite_box=(0, 0, 10, 10),
            crop_box=(0, 0, 20, 20), clean_crop=_flat(20, 20, 100), scene_crop=_flat(20, 20, 100),
        )
    )
    assert result["axes"]["exclusion"]["verdict"] == "fail"


def test_noise_floor_masks_global_regrade():
    clean = _flat(100, 100, 100)
    scene = clean + 12  # uniform grade shift (summed diff 36 per px)
    scene[20:40, 20:40] = 250
    floor = level_noise_floor(clean, scene, [(20, 20, 40, 40)])
    assert floor == pytest.approx(36.0)
    sprite = _sprite(20, 20)
    result = evaluate_bird(
        _inputs(clean, scene, sprite, (20, 20, 40, 40), (0, 0, 100, 100), floor=floor)
    )
    # Grade shift stays below 4x floor => no false pop-in.
    assert result["axes"]["coherence"]["verdict"] == "pass"


@pytest.fixture()
def level_dir(tmp_path):
    root = tmp_path / "levels"
    lv = root / "test_level"
    (lv / "dogs" / "dog_00").mkdir(parents=True)
    clean = _flat(120, 120, 100)
    scene = clean.copy()
    scene[30:70, 30:70] = 250
    Image.fromarray(clean.astype("uint8")).save(lv / "bg_00.png")
    Image.fromarray(scene.astype("uint8")).save(lv / "color.png")
    _sprite(40, 40).save(lv / "dogs" / "dog_00" / "sprite_000.png")
    (lv / "level.json").write_text(json.dumps({
        "id": "test_level", "width": 120, "height": 120,
        "dogs": [{
            "id": "dog_00", "x": 50, "y": 50, "r": 20,
            "sprite": {
                "image": "levels/test_level/dogs/dog_00/sprite_000.png",
                "x": 30, "y": 30, "width": 40, "height": 40,
                "cleanup": {"x": 28, "y": 28, "width": 44, "height": 44},
                "anchorX": 0.5, "anchorY": 0.5,
            },
        }],
    }))
    return lv


def test_evaluate_level_dir_full_mode(level_dir):
    report = evaluate_level_dir(level_dir)
    assert report["summary"]["reducedInput"] is False
    assert report["summary"]["fail"] == 0
    assert report["birds"][0]["axes"]["exclusion"]["verdict"] == "pass"
    assert report["birds"][0]["alignment"]["score"] == pytest.approx(1.0)
    assert report["summary"]["alignmentOutliers"] == 0


def test_evaluate_level_dir_reduced_when_bg_missing(level_dir):
    (level_dir / "bg_00.png").unlink()
    report = evaluate_level_dir(level_dir)
    assert report["summary"]["reducedInput"] is True
    assert report["birds"][0]["axes"]["exclusion"]["verdict"] == "unscored"


def test_reduced_input_preview_request_does_not_crash(level_dir, tmp_path):
    (level_dir / "bg_00.png").unlink()
    preview_dir = tmp_path / "previews"

    report = evaluate_level_dir(level_dir, preview_dir)

    assert report["birds"][0]["alignment"]["verdict"] == "unscored"
    assert list(preview_dir.glob("*.png")) == []


def test_mismatched_clean_scene_sizes_keep_scene_only_matchers(level_dir):
    Image.fromarray(_flat(60, 60, 100).astype("uint8")).save(level_dir / "bg_00.png")

    report = evaluate_level_dir(level_dir, match_methods=("color", "features", "best"), include_legacy_xy=False)

    assert report["summary"]["reducedInput"] is True
    assert report["birds"][0]["alignment"]["verdict"] == "unscored"
    assert report["birds"][0]["cutoutMatches"]["color"]["score"] is not None


def test_evaluate_corpus_aggregates(level_dir):
    report = evaluate_corpus(level_dir.parent)
    assert report["summary"]["levels"] == 1
    assert report["summary"]["birds"] == 1


def test_evaluate_corpus_excludes_named_invalid_level(level_dir):
    report = evaluate_corpus(level_dir.parent, exclude_level_ids={"test_level"})
    assert report["summary"]["levels"] == 0
    assert report["summary"]["birds"] == 0


def test_evaluate_corpus_writes_resumable_level_checkpoint(level_dir, tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"

    first = evaluate_corpus(level_dir.parent, checkpoint_dir=checkpoint_dir)
    checkpoint = checkpoint_dir / "test_level.json"
    checkpoint.write_text(checkpoint.read_text().replace('"birds": 1', '"birds": 77', 1))
    resumed = evaluate_corpus(level_dir.parent, checkpoint_dir=checkpoint_dir)

    assert first["summary"]["birds"] == 1
    assert resumed["summary"]["birds"] == 77


def test_apply_match_report_updates_geometry_anchor_and_sidecars_atomically(level_dir, tmp_path):
    public_sidecar = level_dir / "dogs" / "dog_00" / "sprite_000.json"
    sidecar = {
        "image": "dogs/dog_00/sprite_000.png", "spriteBox": [30, 30, 70, 70],
        "cleanupBox": [28, 28, 72, 72], "width": 40, "height": 40,
        "anchorX": 0.5, "anchorY": 0.5,
    }
    public_sidecar.write_text(json.dumps(sidecar))
    source_sidecar = tmp_path / "workspace" / "levels" / "test_level" / "dogs" / "dog_00" / "sprite_000.json"
    source_sidecar.parent.mkdir(parents=True)
    source_sidecar.write_text(json.dumps(sidecar))
    report = {"levels": [{"levelId": "test_level", "birds": [{
        "dogId": "dog_00", "cutoutMatches": {"best": {
            "accepted": True, "fittedBox": [25, 20, 75, 80],
        }},
    }]}]}

    result = apply_match_report(level_dir.parent, report, workspace_root=tmp_path / "workspace")
    applied_level = json.loads((level_dir / "level.json").read_text())
    sprite = applied_level["dogs"][0]["sprite"]

    assert result["applied"] == 1
    assert result["sourceSidecarsUpdated"] == 1
    assert (sprite["x"], sprite["y"], sprite["width"], sprite["height"]) == (25, 20, 50, 60)
    assert (sprite["anchorX"], sprite["anchorY"]) == (0.5, 0.5)
    assert json.loads(public_sidecar.read_text())["spriteBox"] == [25, 20, 75, 80]
    assert json.loads(source_sidecar.read_text())["spriteBox"] == [25, 20, 75, 80]
    assert apply_match_report(level_dir.parent, report, workspace_root=tmp_path / "workspace")["unchanged"] == 1


def test_apply_match_report_rejects_box_that_drops_human_pickup_point(level_dir):
    report = {"levels": [{"levelId": "test_level", "birds": [{
        "dogId": "dog_00", "cutoutMatches": {"best": {
            "accepted": True, "fittedBox": [0, 0, 10, 10],
        }},
    }]}]}

    result = apply_match_report(level_dir.parent, report)

    assert result["unsafe"] == 1
    sprite = json.loads((level_dir / "level.json").read_text())["dogs"][0]["sprite"]
    assert sprite["x"] == 30


def test_neighbor_sprite_content_is_not_pop_in():
    clean = _flat(100, 100, 100)
    scene = clean.copy()
    scene[20:40, 20:40] = 250  # this bird
    scene[60:80, 60:80] = 250  # neighbor bird's painted sprite
    sprite = _sprite(20, 20)
    inputs = BirdInputs(
        dog_id="dog_00", sprite=sprite, sprite_box=(20, 20, 40, 40),
        crop_box=(0, 0, 100, 100), clean_crop=clean, scene_crop=scene,
        neighbor_boxes=((60, 60, 80, 80),),
    )
    result = evaluate_bird(inputs)
    assert result["axes"]["coherence"]["verdict"] == "pass"
    # Without the neighbor declared, the same scene is pop-in.
    naked = BirdInputs(
        dog_id="dog_00", sprite=_sprite(20, 20), sprite_box=(20, 20, 40, 40),
        crop_box=(0, 0, 100, 100), clean_crop=clean, scene_crop=scene,
    )
    assert evaluate_bird(naked)["axes"]["coherence"]["verdict"] != "pass"
