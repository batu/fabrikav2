import json

from PIL import Image


def test_cutout_only_regen_never_rewrites_scene_or_hitboxes(isolated_session, monkeypatch):
    from levelbuilder.api import flatkey, inpaint

    session_id = "cutout_only_test"
    sdir = isolated_session.LEVELS_DIR / session_id
    dog_dir = sdir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (200, 160), (80, 100, 120)).save(sdir / "color.png")
    Image.new("RGBA", (40, 50), (200, 80, 30, 255)).save(dog_dir / "sprite_000.png")
    Image.new("L", (40, 50), 255).save(dog_dir / "sprite_mask_000.png")
    Image.new("RGB", (80, 80), (80, 100, 120)).save(dog_dir / "variant_000.png")
    (sdir / "hitboxes.json").write_text(json.dumps([{"id": "bird-0", "x": 100, "y": 80, "r": 20}]))
    (sdir / "session.json").write_text(json.dumps({
        "model": "google/gemini-3.1-flash-image-preview",
        "entity": "bird",
        "dogs": [{"id": "bird-0", "index": 0, "activeVariant": 0}],
    }))
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "mask": "dogs/dog_00/sprite_mask_000.png",
        "sourceVariant": "dogs/dog_00/variant_000.png",
        "spriteBox": [80, 55, 120, 105],
        "cleanupBox": [75, 50, 125, 110],
        "quality": {"pickupUsable": True},
    }))

    color_before = (sdir / "color.png").read_bytes()
    hitboxes_before = (sdir / "hitboxes.json").read_bytes()
    variant_before = (dog_dir / "variant_000.png").read_bytes()
    monkeypatch.setattr(
        flatkey,
        "flatkey_recreate_sprite",
        lambda *_args, **_kwargs: Image.new("RGBA", (30, 45), (20, 180, 80, 255)),
    )

    result = inpaint._run_single_cutout_extraction(
        session_id, 0, crop_box=(60, 40, 140, 120),
    )

    assert result["variantIndex"] == 0
    assert (sdir / "color.png").read_bytes() == color_before
    assert (sdir / "hitboxes.json").read_bytes() == hitboxes_before
    assert (dog_dir / "variant_000.png").read_bytes() == variant_before
    metadata = json.loads((dog_dir / "sprite_000.json").read_text())
    assert metadata["technique"] == "flatkey-recreate-cutout-only-v2"
    assert metadata["sourceBox"] == [60, 40, 140, 120]
