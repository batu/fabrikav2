import io
import json

import numpy as np
from PIL import Image

from levelbuilder.api.routes import _candidate_file, _render_sprite_candidate_overlay


def test_candidate_overlay_renders_scene_crop_with_visible_match_box(tmp_path):
    root = tmp_path / "level"
    (root / "dogs" / "dog_00").mkdir(parents=True)
    Image.new("RGB", (160, 120), (80, 90, 100)).save(root / "color.png")
    Image.new("RGBA", (30, 20), (220, 50, 40, 255)).save(root / "dogs" / "dog_00" / "sprite_000.png")
    (root / "dogs" / "dog_00" / "sprite_000.json").write_text(json.dumps({
        "spriteBox": [60, 45, 90, 65],
        "cleanupBox": [50, 35, 100, 75],
    }))
    candidate = {
        "image": "dogs/dog_00/sprite_000.png",
        "metadataPath": "dogs/dog_00/sprite_000.json",
    }

    content = _render_sprite_candidate_overlay((root,), candidate)
    rendered = Image.open(io.BytesIO(content)).convert("RGB")

    assert rendered.width > 0 and rendered.height > 0
    pixels = np.asarray(rendered)
    assert bool(np.any((pixels[:, :, 1] > pixels[:, :, 0]) & (pixels[:, :, 1] > pixels[:, :, 2])))


def test_candidate_overlay_path_resolution_fails_closed(tmp_path):
    outside = tmp_path / "secret.png"
    Image.new("RGB", (1, 1)).save(outside)
    root = tmp_path / "root"
    root.mkdir()

    assert _candidate_file((root,), "../secret.png") is None
