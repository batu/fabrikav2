"""O2: the dynamic-bundle boundary budgets exactly the files the native packer
ships (manifest-referenced webp-preferred assets + dog sprites), never raw
directory size — authoring PNG masters must not move the boundary.
(2026-08-12: 25MB/level directory metric vs 2.3MB shipped bundled 8 of 44.)"""
import json

from PIL import Image


def _export_level(public_levels, level_id, *, junk_bytes=0):
    d = public_levels / level_id
    (d / "dogs" / "dog_00").mkdir(parents=True)
    Image.new("RGB", (32, 32), (200, 20, 20)).save(d / "color.png")
    Image.new("RGB", (32, 32), (200, 20, 20)).save(d / "color.webp")
    Image.new("RGB", (32, 32), (20, 200, 20)).save(d / "bg_00.webp")
    Image.new("RGBA", (8, 8), (1, 2, 3, 255)).save(d / "dogs" / "dog_00" / "sprite_000.png")
    (d / "dogs" / "dog_00" / "sprite_000.json").write_text(json.dumps({
        "version": 1, "box": [0, 0, 8, 8], "anchorX": 0.5, "anchorY": 0.5,
    }))
    (d / "level.json").write_text(json.dumps({
        "name": level_id, "width": 32, "height": 32,
        "dogs": [{"id": "dog_00", "x": 4, "y": 4, "sprite": {
            "image": f"levels/{level_id}/dogs/dog_00/sprite_000.png",
            "cleanup": {"x": 0, "y": 0, "width": 8, "height": 8},
        }}],
    }))
    if junk_bytes:
        (d / "authoring-master.png").write_bytes(b"x" * junk_bytes)


def test_boundary_ignores_unreferenced_authoring_masters(tmp_path, monkeypatch):
    from levelbuilder.api import routes as R
    from levelbuilder.api import session as S

    public = tmp_path / "public" / "levels"
    public.mkdir(parents=True)
    _export_level(public, "small_a")
    _export_level(public, "small_b", junk_bytes=64 * 1024 * 1024)  # 64MB junk

    monkeypatch.setattr(S, "GAME_PUBLIC_LEVELS", public)
    monkeypatch.setattr(
        R.SequenceWorkflow, "get_sequence_editor_state",
        staticmethod(lambda: {"draft": {"levelIds": ["small_a", "small_b"]}}),
    )
    projection = R._bundle_projection()
    assert [level["bundled"] for level in projection["levels"]] == [True, True]
    # Budgeted bytes reflect shipped files only — far below the junk size.
    assert projection["bundledBytes"] < 1 * 1024 * 1024
