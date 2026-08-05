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
