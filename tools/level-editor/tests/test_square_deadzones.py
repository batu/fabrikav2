"""Square-level deadzones for auto hitbox placement."""

from levelbuilder.api.routes import _is_square_level, _square_deadzones
from levelbuilder.sections import BANNER_FRACTION, HUD_FRACTION


class TestSquareDetection:
    def test_exact_square(self):
        assert _is_square_level(4096, 4096)

    def test_near_square_tolerance(self):
        assert _is_square_level(4096, 4000)

    def test_portrait_is_not_square(self):
        assert not _is_square_level(768, 1376)

    def test_landscape_is_not_square(self):
        assert not _is_square_level(4096, 1376)


class TestSquareDeadzones:
    def test_bands_and_chip(self):
        zones = _square_deadzones(4096, 4096)
        assert len(zones) == 3
        hud, banner, chip = zones
        assert (hud.x, hud.y, hud.w) == (0, 0, 4096)
        assert hud.h == int(4096 * HUD_FRACTION)
        assert banner.y == 4096 - int(4096 * BANNER_FRACTION)
        assert banner.h == int(4096 * BANNER_FRACTION)
        # Hint chip hugs the bottom-right, above the banner band.
        assert chip.x + chip.w <= 4096
        assert chip.y + chip.h == banner.y
        assert chip.x > 4096 // 2

    def test_no_side_strips(self):
        # The portrait CROP_L/CROP_R strips must NOT appear on squares: a
        # pannable square is never side-cropped, and scaled strips would
        # blank ~12% of the world on each side for no reason.
        zones = _square_deadzones(4096, 4096)
        full_height_side = [
            z for z in zones if z.h >= 4000 and z.w < 1000
        ]
        assert full_height_side == []

    def test_center_area_free(self):
        zones = _square_deadzones(4096, 4096)
        cx = cy = 2048
        for z in zones:
            inside = z.x <= cx <= z.x + z.w and z.y <= cy <= z.y + z.h
            assert not inside


class TestChromeBandCrop:
    def test_square_gets_bands(self):
        from levelbuilder.api.inpaint import _chrome_band_heights
        from levelbuilder.sections import BANNER_FRACTION, HUD_FRACTION
        top, bottom = _chrome_band_heights(4096, 4096)
        assert top == int(4096 * HUD_FRACTION)
        assert bottom == int(4096 * BANNER_FRACTION)

    def test_portrait_disabled(self):
        from levelbuilder.api.inpaint import _chrome_band_heights
        assert _chrome_band_heights(768, 1376) == (0, 0)
