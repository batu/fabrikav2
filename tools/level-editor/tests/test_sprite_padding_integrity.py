import json

from PIL import Image


def test_cross_bird_padding_repair_preserves_size_and_targets_own_sprite(isolated_session):
    session_id = "cycled_padding"
    root = isolated_session.LEVELS_DIR / session_id
    dog_dir = root / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (400, 300), "white").save(root / "color.png")
    Image.new("RGBA", (40, 30), (0, 0, 0, 255)).save(dog_dir / "sprite_000.png")
    (root / "session.json").write_text(json.dumps({
        "dogs": [{"index": 0, "activeVariant": 0}],
    }))
    (root / "level.json").write_text(json.dumps({
        "dogs": [{
            "id": "dog_00",
            "sprite": {
                "image": f"levels/{session_id}/dogs/dog_00/sprite_000.png",
                "cleanup": {"x": 10, "y": 20, "width": 80, "height": 60},
            },
        }],
    }))
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "spriteBox": [250, 120, 290, 150],
        "cleanupBox": [10, 20, 90, 80],
        "anchorX": 0.5,
        "anchorY": 0.5,
    }))

    audit = isolated_session.repair_cross_bird_padding(session_id)
    assert [issue["dogIndex"] for issue in audit["issues"]] == [0]
    assert isolated_session.get_final_cutout_review_readiness(session_id)["invalidPadding"] == 1

    repaired = isolated_session.repair_cross_bird_padding(session_id, apply=True)
    assert repaired["repaired"] == 1
    metadata = json.loads((dog_dir / "sprite_000.json").read_text())
    assert metadata["cleanupBox"] == [230, 105, 310, 165]
    assert metadata["cleanupBox"][2] - metadata["cleanupBox"][0] == 80
    assert metadata["cleanupBox"][3] - metadata["cleanupBox"][1] == 60
    level = json.loads((root / "level.json").read_text())
    assert level["dogs"][0]["sprite"]["cleanup"] == {
        "x": 230, "y": 105, "width": 80, "height": 60,
    }
    assert isolated_session.repair_cross_bird_padding(session_id)["issues"] == []
    assert isolated_session.get_final_cutout_review_readiness(session_id)["ready"] is True
