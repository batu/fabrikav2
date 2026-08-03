from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image

MODULE_PATH = Path(__file__).with_name("run_benchmark.py")
SPEC = importlib.util.spec_from_file_location("cutout_local_matting", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_focus_alpha_keeps_hitbox_component_only() -> None:
    alpha = np.zeros((30, 30), dtype=np.float32)
    alpha[10:20, 10:20] = 1
    alpha[1:4, 1:4] = 1
    focused = MODULE._focus_alpha(alpha, cx=15, cy=15, radius=5)
    assert focused[15, 15] == 1
    assert focused[2, 2] == 0


def test_trimap_has_known_foreground_unknown_and_background() -> None:
    mask = np.zeros((31, 31), dtype=np.float32)
    mask[8:23, 8:23] = 1
    trimap = MODULE._trimap_from_mask(mask, radius=8)
    assert trimap[15, 15] == 255
    assert trimap[0, 0] == 0
    assert 128 in trimap


def test_decontamination_recovers_foreground_color() -> None:
    clean = np.full((1, 1, 3), [255, 248, 232], dtype=np.uint8)
    foreground = np.array([[[40, 80, 120]]], dtype=np.float32)
    alpha = np.array([[0.5]], dtype=np.float32)
    painted = np.rint(foreground * 0.5 + clean * 0.5).astype(np.uint8)
    rgba = MODULE._decontaminated_rgba(painted, clean, alpha)
    assert np.max(np.abs(rgba[0, 0, :3].astype(int) - foreground[0, 0].astype(int))) <= 1
    assert rgba[0, 0, 3] in (127, 128)


def test_write_sprite_crops_and_clears_transparent_rgb(tmp_path: Path) -> None:
    clean = np.full((20, 20, 3), 220, dtype=np.uint8)
    painted = clean.copy()
    painted[7:13, 7:13] = [20, 40, 60]
    alpha = np.zeros((20, 20), dtype=np.float32)
    alpha[7:13, 7:13] = 1
    output = tmp_path / "sprite.png"
    record = MODULE._write_sprite(
        output,
        painted=painted,
        clean=clean,
        alpha=alpha,
        cx=10,
        cy=10,
        radius=3,
    )
    assert record["size"] == [12, 12]
    with Image.open(output) as image:
        rgba = np.asarray(image.convert("RGBA"))
    assert np.all(rgba[rgba[..., 3] == 0, :3] == 0)
