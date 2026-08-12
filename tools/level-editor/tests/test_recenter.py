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
            # Real sessions always write the variant box sidecar; rebinding a
            # painted dog to its hitbox after a sibling delete depends on it.
            (dog_dir / "variant_000.box.json").write_text(json.dumps({"box": sprite}))
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


def test_recenter_is_idempotent(isolated_session):
    sess = isolated_session
    hitboxes = [{"x": 300, "y": 300, "r": 26}]
    sprites = [[100, 100, 140, 140]]
    _make_session(sess, "recenter_test_e5f6", hitboxes, sprites)
    first = sess.recenter_hitboxes_to_sprites("recenter_test_e5f6")
    second = sess.recenter_hitboxes_to_sprites("recenter_test_e5f6")
    assert len(first["moved"]) == 1
    assert second["moved"] == []


def test_recentered_hitbox_lands_inside_cleanup_box(isolated_session):
    """The gate requires center-containment in cleanup geometry; recentering
    onto the sprite bbox center must satisfy it (cleanup ⊇ sprite bbox)."""
    sess = isolated_session
    hitboxes = [{"x": 999, "y": 999, "r": 26}]
    sprites = [[100, 100, 140, 140]]
    _make_session(sess, "recenter_test_g7h8", hitboxes, sprites)
    sess.recenter_hitboxes_to_sprites("recenter_test_g7h8")
    persisted = json.loads((sess.LEVELS_DIR / "recenter_test_g7h8" / "hitboxes.json").read_text())
    meta = json.loads((sess.LEVELS_DIR / "recenter_test_g7h8" / "dogs" / "dog_00" / "sprite_000.json").read_text())
    left, top, right, bottom = meta["cleanupBox"]
    assert left <= persisted[0]["x"] <= right
    assert top <= persisted[0]["y"] <= bottom


def test_recenter_fixes_far_drift(isolated_session):
    """A hitbox that drifted far enough to stop rebinding to its variant box is
    exactly the one that most needs recentering — resolving sprites through the
    hitbox target map silently skipped these."""
    sess = isolated_session
    hitboxes = [{"x": 700, "y": 700, "r": 26}]
    sprites = [[100, 100, 140, 140]]
    _make_session(sess, "recenter_far_drift_1", hitboxes, sprites)
    result = sess.recenter_hitboxes_to_sprites("recenter_far_drift_1")
    assert [m["index"] for m in result["moved"]] == [0]
    persisted = json.loads((sess.LEVELS_DIR / "recenter_far_drift_1" / "hitboxes.json").read_text())
    assert [persisted[0]["x"], persisted[0]["y"]] == [120, 120]


def test_recenter_binds_hitboxes_by_id_across_slot_gaps(isolated_session):
    """dog.index is the sprite SLOT, not the hitboxes array position; with a
    gap (pruned/imported level: slots dog_00 and dog_02, two hitboxes) the
    positional bind used to move the WRONG hitbox."""
    sess = isolated_session
    session_id = "recenter_slot_gap"
    sdir = sess.LEVELS_DIR / session_id
    sdir.mkdir(parents=True)
    hitboxes = [
        {"id": "bird-a", "x": 50, "y": 50, "r": 26},    # slot dog_00, on target
        {"id": "bird-c", "x": 300, "y": 300, "r": 26},  # slot dog_02, far off
    ]
    (sdir / "hitboxes.json").write_text(json.dumps(hitboxes))
    for slot, sprite in ((0, [30, 30, 70, 70]), (2, [100, 100, 140, 140])):
        dog_dir = sdir / "dogs" / f"dog_{slot:02d}"
        dog_dir.mkdir(parents=True)
        (dog_dir / "variant_000.png").write_bytes(b"")
        (dog_dir / "variant_000.box.json").write_text(json.dumps({"box": sprite}))
        (dog_dir / "sprite_000.png").write_bytes(b"")
        (dog_dir / "sprite_000.json").write_text(json.dumps({
            "image": f"dogs/dog_{slot:02d}/sprite_000.png",
            "spriteBox": sprite,
            "cleanupBox": [sprite[0] - 5, sprite[1] - 5, sprite[2] + 5, sprite[3] + 5],
            "width": sprite[2] - sprite[0],
            "height": sprite[3] - sprite[1],
        }))
    (sdir / "session.json").write_text(json.dumps({"dogs": [
        {"id": "bird-a", "index": 0, "activeVariant": 0},
        {"id": "bird-c", "index": 2, "activeVariant": 0},
    ]}))

    result = sess.recenter_hitboxes_to_sprites(session_id)

    persisted = json.loads((sdir / "hitboxes.json").read_text())
    by_id = {h["id"]: h for h in persisted}
    assert by_id["bird-a"] == {"id": "bird-a", "x": 50, "y": 50, "r": 26}  # untouched
    assert (by_id["bird-c"]["x"], by_id["bird-c"]["y"]) == (120, 120)     # its own sprite center
    assert len(result["moved"]) == 1
