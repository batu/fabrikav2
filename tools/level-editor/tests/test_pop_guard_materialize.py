"""Pop guard through materialize_detection_sprites: a sticker that cannot be
aligned with the painted bird yields to the diff-mask cut of the painted
pixels; an aligned sticker is kept and placed at its measured fit."""
import json

import numpy as np
from PIL import Image, ImageDraw


def _setup(isolated_session, session_id, painted_bird):
    session_dir = isolated_session.LEVELS_DIR / session_id
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    for root in (session_dir, public_dir):
        root.mkdir(parents=True)
        (root / "level.json").write_text(json.dumps({
            "id": session_id, "name": "pg", "width": 300, "height": 300,
            "dogs": [{"id": "bird-0", "x": 150, "y": 150, "r": 30}],
        }))
    rng = np.random.default_rng(3)
    clean = Image.fromarray(rng.integers(60, 120, size=(300, 300, 3), dtype=np.uint8), "RGB")
    clean.save(session_dir / "bg_00.png")
    color = clean.copy()
    color.paste(painted_bird.convert("RGB"), (110, 120), painted_bird.getchannel("A"))
    color.save(session_dir / "color.png")
    (session_dir / "hitboxes.json").write_text(json.dumps([{"id": "bird-0", "x": 150, "y": 150, "r": 30}]))
    (session_dir / "session.json").write_text(json.dumps({
        "selected_bg": 0, "entity": "bird",
        "dogs": [{"id": "bird-0", "index": 0, "activeVariant": None}],
    }))
    isolated_session.set_hitbox_review(session_id, True, source="test")
    return session_dir


def _bird(color):
    img = Image.new("RGBA", (80, 60), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((4, 4, 76, 56), fill=color + (255,))
    d.ellipse((50, 8, 72, 30), fill=(250, 220, 40, 255))
    return img


def test_unalignable_sticker_yields_to_painted_pixels(isolated_session, monkeypatch):
    from levelbuilder.api import flatkey

    sid = "popguard_diff"
    session_dir = _setup(isolated_session, sid, _bird((230, 40, 40)))
    # The "recreate" is a different bird entirely -> pop far above the guard.
    # Production default is the single-call path (DEFAULT_FLATKEY_GRID = 1);
    # patch both rungs so the test is grid-agnostic.
    monkeypatch.setattr(flatkey, "flatkey_recreate_sprites_batch",
                        lambda *_a, **_k: {0: _bird((30, 200, 60))})
    monkeypatch.setattr(flatkey, "flatkey_recreate_sprite", lambda *_a, **_k: _bird((30, 200, 60)))
    result = isolated_session.materialize_detection_sprites(
        sid, detections=[{"x": 95, "y": 105, "width": 120, "height": 100, "confidence": 1.0}])
    assert result["materialized"] == 1
    meta = json.loads((session_dir / "dogs" / "dog_00" / "sprite_000.json").read_text())
    assert meta["placementCheck"]["chosen"] == "diff-mask"
    assert meta["placementCheck"]["recreatePop"] > 35
    assert meta["technique"] != "flatkey-recreate-v1"
    sprite = np.asarray(Image.open(session_dir / "dogs" / "dog_00" / "sprite_000.png").convert("RGBA"))
    visible = sprite[:, :, 3] > 128
    assert visible.any()
    # painted pixels, not the green sticker
    assert sprite[:, :, 0][visible].mean() > sprite[:, :, 1][visible].mean()


def test_aligned_sticker_is_kept_and_placed_at_its_fit(isolated_session, monkeypatch):
    from levelbuilder.api import flatkey

    sid = "popguard_keep"
    session_dir = _setup(isolated_session, sid, _bird((230, 40, 40)))
    monkeypatch.setattr(flatkey, "flatkey_recreate_sprites_batch",
                        lambda *_a, **_k: {0: _bird((230, 40, 40))})
    monkeypatch.setattr(flatkey, "flatkey_recreate_sprite", lambda *_a, **_k: _bird((230, 40, 40)))
    result = isolated_session.materialize_detection_sprites(
        sid, detections=[{"x": 95, "y": 105, "width": 120, "height": 100, "confidence": 1.0}])
    assert result["materialized"] == 1
    meta = json.loads((session_dir / "dogs" / "dog_00" / "sprite_000.json").read_text())
    assert meta["placementCheck"]["chosen"] == "recreate-fitted"
    assert meta["placementCheck"]["recreatePop"] <= 35
    assert meta["technique"] == "flatkey-recreate-v1"
    box = meta["spriteBox"]
    # the sticker was painted at (110,120)-(190,180); fitted box lands there (+-4 px padding/shift)
    assert abs(box[0] - 110) <= 6 and abs(box[1] - 120) <= 6


def test_fit_that_misses_the_hitbox_is_not_used(isolated_session, monkeypatch):
    """A sticker matched beside the hitbox (a look-alike prop) must not
    become the sprite geometry: the hitbox center has to sit inside the box."""
    from levelbuilder.api import flatkey, inpaint

    sid = "popguard_contain"
    session_dir = _setup(isolated_session, sid, _bird((230, 40, 40)))
    monkeypatch.setattr(flatkey, "flatkey_recreate_sprites_batch", lambda *_a, **_k: {0: _bird((230, 40, 40))})
    monkeypatch.setattr(flatkey, "flatkey_recreate_sprite", lambda *_a, **_k: _bird((230, 40, 40)))
    # force the measured fit far from the hitbox (crop-local coords)
    monkeypatch.setattr(inpaint, "fit_sprite_to_painted",
                        lambda sprite, painted, clean=None: {"score": 0.9, "scale": 1.0, "x": 0, "y": 0,
                                                             "width": sprite.width, "height": sprite.height, "pop": 5.0})
    isolated_session.materialize_detection_sprites(
        sid, detections=[{"x": 95, "y": 105, "width": 120, "height": 100, "confidence": 1.0}])
    meta = json.loads((session_dir / "dogs" / "dog_00" / "sprite_000.json").read_text())
    assert meta["placementCheck"]["fitRejected"] == "hitbox_outside_fit"
    assert meta["placementCheck"]["chosen"] == "recreate-anchored"
    box = meta["spriteBox"]
    assert box[0] <= 150 <= box[2] and box[1] <= 150 <= box[3]
