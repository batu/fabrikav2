import json

from PIL import Image


def test_materialize_and_best_safe_keep_workspace_and_public_levels_in_sync(
    isolated_session, monkeypatch,
):
    from levelbuilder.api import flatkey, inpaint, sprite_eval

    session_id = "sprite_level_sync"
    session_dir = isolated_session.LEVELS_DIR / session_id
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    for root in (session_dir, public_dir):
        root.mkdir(parents=True)
        (root / "level.json").write_text(json.dumps({
            "id": session_id,
            "name": "Sprite sync",
            "width": 200,
            "height": 200,
            "dogs": [{"id": "bird-0", "x": 100, "y": 100, "r": 20}],
        }))
    Image.new("RGB", (200, 200), (80, 100, 120)).save(session_dir / "bg_00.png")
    Image.new("RGB", (200, 200), (90, 110, 130)).save(session_dir / "color.png")
    (session_dir / "hitboxes.json").write_text(json.dumps([
        {"id": "bird-0", "x": 100, "y": 100, "r": 20},
    ]))
    (session_dir / "session.json").write_text(json.dumps({
        "selected_bg": 0,
        "entity": "bird",
        "dogs": [{"id": "bird-0", "index": 0, "activeVariant": None}],
    }))
    isolated_session.set_hitbox_review(session_id, True, source="test")
    monkeypatch.setattr(
        flatkey,
        "flatkey_recreate_sprites_batch",
        lambda *_args, **_kwargs: {0: Image.new("RGBA", (40, 40), (220, 80, 30, 255))},
    )

    result = isolated_session.materialize_detection_sprites(
        session_id,
        detections=[{"x": 70, "y": 70, "width": 60, "height": 60, "confidence": 1.0}],
    )

    assert result["materialized"] == 1
    assert isolated_session.get_final_cutout_review_readiness(session_id)["ready"] is True
    for root in (session_dir, public_dir):
        level = json.loads((root / "level.json").read_text())
        assert level["dogs"][0]["sprite"]["image"].endswith("/dogs/dog_00/sprite_000.png")
        assert (root / "dogs" / "dog_00" / "sprite_000.png").is_file()

    monkeypatch.setattr(sprite_eval, "match_cutout", lambda *_args, **_kwargs: {"best": {
        "accepted": True,
        "method": "color",
        "score": 0.9,
        "fittedBox": [75, 75, 125, 125],
    }})
    placed = inpaint._auto_place_cutout_best_safe(session_id, 0, 0)

    assert placed["accepted"] is True
    for root in (session_dir, public_dir):
        level = json.loads((root / "level.json").read_text())
        sprite = level["dogs"][0]["sprite"]
        assert [sprite[key] for key in ("x", "y", "width", "height")] == [75, 75, 50, 50]
