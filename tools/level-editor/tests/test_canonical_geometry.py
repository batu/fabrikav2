import os
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["LEVEL_EDITOR_GAME"] = "find_the_bird"

from levelbuilder.settings import apply_game_from_env

apply_game_from_env()

from levelbuilder.api.inpaint import _band_feather_mask, _chrome_crop_box
from levelbuilder.api.session import LevelNotReadyError, _require_local_alignment
from levelbuilder.sections import (
    BANNER_FRACTION,
    HUD_FRACTION,
    SQUARE_SIDE_MARGIN_FRACTION,
    square_send_side_margin,
)


def test_square_send_side_margin_makes_send_region_square() -> None:
    width = height = 4096
    margin = square_send_side_margin(width, height)
    send_width = width - 2 * margin
    send_height = height - int(height * HUD_FRACTION) - int(height * BANNER_FRACTION)

    assert abs(send_width - send_height) <= 1


@pytest.mark.parametrize("width,height", [(4096, 4096), (2688, 2688)])
def test_square_send_side_margin_never_drops_below_minimum(width: int, height: int) -> None:
    assert square_send_side_margin(width, height) >= int(
        width * SQUARE_SIDE_MARGIN_FRACTION
    )


@pytest.mark.parametrize("size", [(4096, 4096), (2688, 2688)])
def test_chrome_crop_box_is_exactly_square(size: tuple[int, int]) -> None:
    left, top, right, bottom = _chrome_crop_box(*size)

    assert right - left == bottom - top


def test_chrome_crop_box_is_about_2048_pixels_at_2688() -> None:
    left, top, right, bottom = _chrome_crop_box(2688, 2688)
    width = right - left
    height = bottom - top

    assert abs(width - 2048) <= 2
    assert width == height


def test_chrome_crop_box_keeps_portrait_full_frame() -> None:
    assert _chrome_crop_box(768, 1376) == (0, 0, 768, 1376)


def test_band_feather_mask_fades_all_edges_and_keeps_center_opaque() -> None:
    mask = _band_feather_mask((32, 32), feather=8, sides=True)

    assert mask.getpixel((16, 0)) < 64
    assert mask.getpixel((16, 31)) < 64
    assert mask.getpixel((0, 16)) < 64
    assert mask.getpixel((31, 16)) < 64
    assert mask.getpixel((16, 16)) == 255


def test_band_feather_mask_without_sides_keeps_side_edges_opaque() -> None:
    mask = _band_feather_mask((32, 32), feather=8, sides=False)

    assert mask.getpixel((0, 16)) == 255
    assert mask.getpixel((31, 16)) == 255


def _structured_image(size: tuple[int, int] = (512, 512)) -> Image.Image:
    width, height = size
    x = np.arange(width, dtype=np.uint16)
    y = np.arange(height, dtype=np.uint16)[:, None]
    pixels = np.stack(
        (
            np.broadcast_to((x * 3) % 256, (height, width)),
            np.broadcast_to((y * 5) % 256, (height, width)),
            (x + y * 2) % 256,
        ),
        axis=2,
    ).astype(np.uint8)
    image = Image.fromarray(pixels, mode="RGB")
    draw = ImageDraw.Draw(image)
    draw.rectangle((47, 83, 191, 229), fill=(250, 20, 90))
    draw.ellipse((287, 301, 441, 463), fill=(10, 230, 170))
    return image


def _write_alignment_session(sdir: Path, *, shift_x: int = 0) -> dict:
    raw = {"selected_bg": 0}
    image = _structured_image()
    image.save(sdir / "bg_00.png")
    color = Image.fromarray(np.roll(np.asarray(image), shift_x, axis=1))
    color.save(sdir / "color.png")
    (sdir / "session.json").write_text('{"selected_bg": 0}')
    return raw


def test_local_alignment_accepts_identical_images(tmp_path: Path) -> None:
    raw = _write_alignment_session(tmp_path)

    _require_local_alignment(tmp_path, raw)


def test_local_alignment_rejects_twelve_pixel_shift(tmp_path: Path) -> None:
    raw = _write_alignment_session(tmp_path, shift_x=12)

    with pytest.raises(LevelNotReadyError, match="misaligned"):
        _require_local_alignment(tmp_path, raw)


def test_local_alignment_skip_env_allows_shift(monkeypatch, tmp_path: Path) -> None:
    raw = _write_alignment_session(tmp_path, shift_x=12)
    monkeypatch.setenv("FTD_SKIP_ALIGNMENT_GATE", "1")

    _require_local_alignment(tmp_path, raw)


class TestBatchedFlatkeySplitter:
    def test_split_grid_panels_finds_each_cell(self):
        # Synthetic model output: 3x3 magenta panels with colored blobs,
        # separated by white gutters — the shape a compliant grid call returns.
        from PIL import Image, ImageDraw
        from levelbuilder.api.flatkey import split_grid_panels
        n = 3
        img = Image.new('RGB', (1000, 1000), (255, 255, 255))
        d = ImageDraw.Draw(img)
        cell = (1000 - (n + 1) * 20) // n
        for i in range(n * n):
            x = 20 + (i % n) * (cell + 20)
            y = 20 + (i // n) * (cell + 20)
            d.rectangle([x, y, x + cell, y + cell], fill=(255, 0, 255))
            d.ellipse([x + 60, y + 60, x + cell - 60, y + cell - 60], fill=(90, 60, 30))
        panels = split_grid_panels(img, n, n * n)
        assert all(p is not None for p in panels)
        # gutters must NOT merge panels: each panel is cell-sized, not global
        for p in panels:
            assert p.width < 1000 // 2 and p.height < 1000 // 2

    def test_split_missing_panel_reported_none(self):
        from PIL import Image, ImageDraw
        from levelbuilder.api.flatkey import split_grid_panels
        img = Image.new('RGB', (1000, 1000), (255, 255, 255))
        d = ImageDraw.Draw(img)
        # only 3 of 4 panels present
        for i in [0, 1, 3]:
            x = 24 + (i % 2) * 500
            y = 24 + (i // 2) * 500
            d.rectangle([x, y, x + 440, y + 440], fill=(255, 0, 255))
        panels = split_grid_panels(img, 2, 4)
        assert panels[2] is None
        assert sum(p is not None for p in panels) == 3

    def test_batch_ladder_falls_back_to_single(self, monkeypatch):
        # edit_image is stubbed: grid calls return a USELESS all-white image
        # (no magenta -> every panel fails), single-call recreate returns a
        # valid flat sticker — the ladder must land every bird via singles.
        from PIL import Image
        import levelbuilder.api.flatkey as fk
        calls = {'grid': 0, 'single': 0}
        def fake_edit(image, prompt, *, model, **kw):
            if 'grid of' in prompt:
                calls['grid'] += 1
                return Image.new('RGB', (1000, 1000), (255, 255, 255))
            calls['single'] += 1
            flat = Image.new('RGB', image.size, (255, 0, 255))
            from PIL import ImageDraw
            ImageDraw.Draw(flat).ellipse(
                [image.width // 4, image.height // 4, 3 * image.width // 4, 3 * image.height // 4],
                fill=(90, 60, 30),
            )
            return flat
        import merceka_core.image as mi
        monkeypatch.setattr(mi, 'edit_image', fake_edit)
        # judge_gate shells out to codex — stub it or the test spends a
        # minute per single call and can flake the retry count.
        monkeypatch.setattr(fk, 'judge_gate', lambda cutout, painted, **kw: True)
        crops = {i: Image.new('RGB', (200, 200), (200, 150, 90)) for i in range(4)}
        out = fk.flatkey_recreate_sprites_batch(crops, model='test/x', grid=3)
        assert calls['grid'] >= 2  # 3x3 pass + 2x2 retry
        assert calls['single'] == 4
        assert set(out) == set(crops)


class TestNeighborSuppression:
    """Close birds must not leak into each other's cutout crops (2026-08-06)."""

    def _scene(self):
        from PIL import Image, ImageDraw
        clean = Image.new('RGB', (400, 300), (120, 160, 90))
        d = ImageDraw.Draw(clean)
        for x in range(0, 400, 20):
            d.line((x, 0, x, 300), fill=(100, 140, 80), width=3)
        painted = clean.copy()
        pd = ImageDraw.Draw(painted)
        pd.ellipse((80, 100, 140, 160), fill=(200, 40, 40))    # bird A
        pd.ellipse((150, 110, 210, 170), fill=(40, 40, 200))   # bird B (close)
        dets = {
            0: {"x": 80, "y": 100, "width": 60, "height": 60},
            1: {"x": 150, "y": 110, "width": 60, "height": 60},
        }
        return clean, painted, dets

    def test_neighbor_is_erased_and_subject_kept(self):
        import numpy as np
        from levelbuilder.api.session import _neighbor_free_crop
        clean, painted, dets = self._scene()
        box = (60, 80, 240, 190)  # A's padded crop, overlapping B fully
        crop = _neighbor_free_crop(painted, clean, box, dets, keep_index=0)
        arr = np.asarray(crop).astype(int)
        # B's center (level 180,140 -> crop 120,60) must be clean bg, not blue.
        assert arr[60, 120, 2] < 120, "neighbor bird survived suppression"
        # A's center (level 110,130 -> crop 50,50) must remain the red bird.
        assert arr[50, 50, 0] > 150, "kept bird was damaged"

    def test_no_clean_bg_degrades_to_plain_crop(self):
        import numpy as np
        from levelbuilder.api.session import _neighbor_free_crop
        _, painted, dets = self._scene()
        crop = _neighbor_free_crop(painted, None, (60, 80, 240, 190), dets, keep_index=0)
        arr = np.asarray(crop).astype(int)
        assert arr[60, 120, 2] > 150  # neighbor untouched without a clean bg

    def test_far_neighbor_leaves_crop_untouched(self):
        import numpy as np
        from levelbuilder.api.session import _neighbor_free_crop
        clean, painted, _ = self._scene()
        dets = {
            0: {"x": 80, "y": 100, "width": 60, "height": 60},
            1: {"x": 340, "y": 10, "width": 40, "height": 40},  # far away
        }
        box = (60, 80, 160, 180)
        crop = _neighbor_free_crop(painted, clean, box, dets, keep_index=0)
        import numpy as np
        assert np.array_equal(np.asarray(crop), np.asarray(painted.crop(box)))

    def test_overlapping_neighbor_box_never_erases_the_kept_bird(self):
        # Dense-cluster case: neighbor's padded box overlaps A's own box.
        import numpy as np
        from levelbuilder.api.session import _neighbor_free_crop
        clean, painted, _ = self._scene()
        dets = {
            0: {"x": 80, "y": 100, "width": 60, "height": 60},
            1: {"x": 120, "y": 105, "width": 60, "height": 60},  # overlaps A
        }
        box = (60, 80, 240, 190)
        crop = _neighbor_free_crop(painted, clean, box, dets, keep_index=0)
        arr = np.asarray(crop).astype(int)
        # A's center must survive even though B's padded box covers it.
        assert arr[50, 50, 0] > 150, "kept bird erased by overlapping neighbor box"
        # B's far side (outside A's box) must still be cleaned.
        assert arr[55, 115, 2] < 120, "neighbor not erased outside the kept box"


def test_recenter_close_pair_keeps_distinct_centers(tmp_path):
    """Close pairs must NOT collapse to the merged-diff midpoint (2026-08-06
    device feedback): each hitbox snaps to the center-mass of ITS OWN
    Voronoi share of the painted diff."""
    import json as _json
    import numpy as np
    from PIL import Image, ImageDraw
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    sdir = tmp_path
    bg = Image.new('RGB', (800, 600), (120, 150, 90))
    bg.save(sdir / 'bg_00.png')
    color = bg.copy()
    d = ImageDraw.Draw(color)
    # two birds 100px apart (r=57 -> nn < 2.2r = close pair)
    d.ellipse((300 - 35, 300 - 35, 300 + 35, 300 + 35), fill=(200, 40, 40))
    d.ellipse((400 - 35, 300 - 35, 400 + 35, 300 + 35), fill=(40, 40, 200))
    color.save(sdir / 'color.png')
    # hitboxes deliberately offset toward the midpoint (the bad state)
    (sdir / 'hitboxes.json').write_text(_json.dumps([
        {"id": "a", "x": 330, "y": 302, "r": 57},
        {"id": "b", "x": 370, "y": 298, "r": 57},
    ]))
    (sdir / 'session.json').write_text('{"selected_bg": 0}')

    import unittest.mock as um
    with um.patch.object(S, 'session_dir', return_value=sdir), \
         um.patch.object(S, 'load_session_raw', return_value={"selected_bg": 0}), \
         um.patch.object(S, 'save_hitboxes', side_effect=lambda sid, hbs: hbs):
        result = I.recenter_hitboxes_local_diff('testsession')

    hbs = _json.loads((sdir / 'hitboxes.json').read_text()) if False else None
    # centers must separate toward their own blobs, not stay at the midpoint
    moved = {m['id']: m['to'] for m in result['moved']}
    assert 'a' in moved and 'b' in moved, result
    ax, _ = moved['a']; bx, _ = moved['b']
    assert abs(ax - 300) <= 12, f"a snapped to {ax}, expected ~300"
    assert abs(bx - 400) <= 12, f"b snapped to {bx}, expected ~400"
