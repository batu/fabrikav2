"""Recenter policy: hitboxes move onto the visible sprite center when outside
the bbox or beyond max_offset_fraction * r; on-target hitboxes stay put."""

import json


def _make_session(sess, session_id: str, hitboxes, sprites) -> None:
    sdir = sess.LEVELS_DIR / session_id
    sdir.mkdir(parents=True)
    (sdir / "hitboxes.json").write_text(json.dumps(hitboxes))
    dogs_meta = []
    for i, sprite in enumerate(sprites):
        dog_dir = sdir / "dogs" / f"dog_{i:02d}"
        dog_dir.mkdir(parents=True)
        if sprite is not None:
            (dog_dir / "variant_000.png").write_bytes(b"")
            (dog_dir / "sprite_000.png").write_bytes(b"")
            meta = {
                "image": f"dogs/dog_{i:02d}/sprite_000.png",
                "spriteBox": sprite,
                "cleanupBox": [sprite[0] - 5, sprite[1] - 5, sprite[2] + 5, sprite[3] + 5],
                "width": sprite[2] - sprite[0],
                "height": sprite[3] - sprite[1],
            }
            (dog_dir / "sprite_000.json").write_text(json.dumps(meta))
        dogs_meta.append({"index": i, "activeVariant": 0 if sprite is not None else None})
    (sdir / "session.json").write_text(json.dumps({"dogs": dogs_meta}))


def test_recenter_moves_offset_and_outside_hitboxes(isolated_session):
    sess = isolated_session
    # dog_00 centered on sprite -> stays; dog_01 outside bbox -> moves;
    # dog_02 inside but > r/2 off-center -> moves; dog_03 no sprite -> ignored.
    hitboxes = [
        {"x": 50, "y": 50, "r": 26},
        {"x": 300, "y": 300, "r": 26},
        {"x": 118, "y": 100, "r": 26},
        {"x": 200, "y": 200, "r": 26},
    ]
    sprites = [
        [30, 30, 70, 70],       # center (50,50) — on target
        [100, 100, 140, 140],   # center (120,120) — hitbox far outside
        [100, 80, 140, 120],    # center (120,100) — dist 2 < 13, wait: hb (118,100) dist=2 -> stays
        None,
    ]
    _make_session(sess, "recenter_test_a1b2", hitboxes, sprites)
    result = sess.recenter_hitboxes_to_sprites("recenter_test_a1b2")
    moved = {m["index"]: m for m in result["moved"]}
    assert 1 in moved and moved[1]["to"] == [120, 120]
    assert 0 not in moved and 2 not in moved and 3 not in moved
    persisted = json.loads((sess.LEVELS_DIR / "recenter_test_a1b2" / "hitboxes.json").read_text())
    assert persisted[1]["x"] == 120 and persisted[1]["y"] == 120
    assert persisted[0]["x"] == 50


def test_recenter_threshold_fraction(isolated_session):
    sess = isolated_session
    # dist 20 with r=26: > 0.5*26=13 -> moves at default; stays at fraction 1.0
    hitboxes = [{"x": 140, "y": 120, "r": 26}]
    sprites = [[100, 100, 140, 140]]  # center (120,120), dist 20
    _make_session(sess, "recenter_test_c3d4", hitboxes, sprites)
    kept = sess.recenter_hitboxes_to_sprites("recenter_test_c3d4", max_offset_fraction=1.0)
    assert kept["moved"] == []
    moved = sess.recenter_hitboxes_to_sprites("recenter_test_c3d4")
    assert [m["index"] for m in moved["moved"]] == [0]
