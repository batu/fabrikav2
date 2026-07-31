import json

import numpy as np
import pytest
from PIL import Image

from levelbuilder.api.sprite_eval import (
    BirdInputs,
    evaluate_bird,
    evaluate_corpus,
    evaluate_level_dir,
    level_noise_floor,
)


def _flat(h, w, color):
    return np.full((h, w, 3), color, dtype=np.int16)


def _sprite(w, h, alpha=255, color=(200, 40, 40)):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (w, h), (*color, alpha)), (0, 0))
    return img


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


def test_evaluate_level_dir_reduced_when_bg_missing(level_dir):
    (level_dir / "bg_00.png").unlink()
    report = evaluate_level_dir(level_dir)
    assert report["summary"]["reducedInput"] is True
    assert report["birds"][0]["axes"]["exclusion"]["verdict"] == "unscored"


def test_evaluate_corpus_aggregates(level_dir):
    report = evaluate_corpus(level_dir.parent)
    assert report["summary"]["levels"] == 1
    assert report["summary"]["birds"] == 1
