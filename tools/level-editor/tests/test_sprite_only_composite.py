"""Sprite-only compositing (plan 2026-07-31-002 U6).

The scene must equal clean background + validated pickup sprite; foliage the
model painted outside the sprite never reaches the scene, so pickup restores
pixel-identical background.
"""

import json

import pytest


@pytest.fixture(autouse=True)
def _enable_rejected_sprite_only_lane(monkeypatch):
    """These tests exercise the sprite-only compose lane, which is retired
    from production defaults (operator rejection 2026-08-01; sticker incident
    2026-08-12) and now opt-in only."""
    monkeypatch.setenv("FTD_SPRITE_ONLY_COMPOSE", "1")


import pytest
from PIL import Image

from levelbuilder.api import inpaint as inp


def _seed(sess, session_id, *, with_sprite=True, pickup_usable=True):
    sdir = sess.session_dir(session_id)
    sdir.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 64), (0, 128, 0)).save(sdir / "bg_00.png")
    (sdir / "session.json").write_text(json.dumps({
        "model": "test/model", "selected_bg": 0, "n_dogs": 1, "dogs": [],
    }))
    hitbox = sess.save_hitboxes(session_id, [{"x": 32, "y": 32, "r": 8}])[0]
    sess.update_session_field(
        session_id, selected_bg=0, bg_width=64, bg_height=64,
        dogs=[{"id": hitbox["id"], "index": 0, "status": "done", "activeVariant": 0}],
    )
    dog_dir = sess.dogs_dir(session_id) / "dog_00"
    dog_dir.mkdir(parents=True)
    # Variant repaints the whole crop: bird (blue) at 28..36, foliage (red) at 18..24.
    variant = Image.new("RGB", (32, 32), (0, 128, 0))
    for x in range(12, 20):
        for y in range(12, 20):
            variant.putpixel((x, y), (0, 0, 255))
    for x in range(2, 8):
        for y in range(2, 8):
            variant.putpixel((x, y), (255, 0, 0))
    variant_path = dog_dir / "variant_000.png"
    variant.save(variant_path)
    inp._save_variant_box(variant_path, (16, 16, 48, 48))
    if with_sprite:
        sprite = Image.new("RGBA", (8, 8), (0, 0, 255, 255))
        sprite.save(dog_dir / "sprite_000.png")
        Image.new("L", (8, 8), 255).save(dog_dir / "sprite_mask_000.png")
        (dog_dir / "sprite_000.json").write_text(json.dumps({
            "version": 1,
            "image": "dogs/dog_00/sprite_000.png",
            "spriteBox": [28, 28, 36, 36],
            "cleanupBox": [26, 26, 38, 38],
            "sourceBox": [16, 16, 48, 48],
            "quality": {"pickupUsable": pickup_usable},
        }))
    return sdir


def test_scene_is_clean_bg_plus_sprite_only(isolated_session):
    _seed(isolated_session, "sprite_only_01")
    result = inp.compose_with_mask("sprite_only_01")
    assert result is not None
    # Bird pixels (inside spriteBox) are pasted.
    assert result.getpixel((32, 32)) == (0, 0, 255)
    # Foliage the variant painted at crop (2..8) -> level (18..24) must NOT appear.
    assert result.getpixel((20, 20)) == (0, 128, 0)
    # Everything outside the sprite equals clean background, pixel exact.
    clean = Image.open(isolated_session.session_dir("sprite_only_01") / "bg_00.png").convert("RGB")
    for x, y in ((0, 0), (16, 16), (25, 25), (40, 40), (63, 63)):
        assert result.getpixel((x, y)) == clean.getpixel((x, y))
    result.close()


def test_pickup_simulation_restores_clean_bg_exactly(isolated_session):
    _seed(isolated_session, "sprite_only_02")
    result = inp.compose_with_mask("sprite_only_02")
    sdir = isolated_session.session_dir("sprite_only_02")
    clean = Image.open(sdir / "bg_00.png").convert("RGB")
    cleanup = (26, 26, 38, 38)
    result.paste(clean.crop(cleanup), cleanup[:2])
    assert list(result.getdata()) == list(clean.getdata())
    result.close()


def test_dog_without_usable_sprite_falls_back_to_diff_paste(isolated_session):
    _seed(isolated_session, "sprite_only_03", pickup_usable=False)
    result = inp.compose_with_mask("sprite_only_03")
    # Legacy characterization: broad diff paste carries the bird AND the foliage.
    assert result.getpixel((32, 32)) == (0, 0, 255)
    assert result.getpixel((20, 20)) == (255, 0, 0)
    result.close()


def test_missing_sprite_files_fall_back(isolated_session):
    _seed(isolated_session, "sprite_only_04", with_sprite=False)
    result = inp.compose_with_mask("sprite_only_04")
    assert result is not None
    assert result.getpixel((32, 32)) == (0, 0, 255)
    result.close()


def test_opt_out_env_restores_legacy_behavior(isolated_session, monkeypatch):
    monkeypatch.setenv("FTD_SPRITE_ONLY_COMPOSE", "0")
    _seed(isolated_session, "sprite_only_05")
    result = inp.compose_with_mask("sprite_only_05")
    assert result.getpixel((20, 20)) == (255, 0, 0)  # legacy diff paste
    result.close()


def test_magenta_mode_scrubs_old_broad_paste_before_sprite(isolated_session):
    sdir = _seed(isolated_session, "sprite_only_06")
    # Previous composite has stale broad-paste content around the bird.
    stale = Image.new("RGB", (64, 64), (0, 128, 0))
    for x in range(26, 38):
        for y in range(26, 38):
            stale.putpixel((x, y), (255, 255, 0))
    stale.save(sdir / "color.png")
    isolated_session.update_session_field("sprite_only_06", inpaint_mode="magenta")
    result = inp.compose_with_mask("sprite_only_06")
    assert result.getpixel((32, 32)) == (0, 0, 255)  # sprite pasted
    assert result.getpixel((27, 27)) == (0, 128, 0)  # stale yellow scrubbed to clean bg
    result.close()
