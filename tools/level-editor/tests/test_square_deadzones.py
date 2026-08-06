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
    def test_bands_and_margins(self):
        # 2026-08-06: hint chip removed from square deadzones — floating
        # chrome the player pans away from is not a placement constraint.
        zones = _square_deadzones(4096, 4096)
        assert len(zones) == 4
        hud, banner, left, right = zones
        assert (hud.x, hud.y, hud.w) == (0, 0, 4096)
        assert hud.h == int(4096 * HUD_FRACTION)
        assert banner.y == 4096 - int(4096 * BANNER_FRACTION)
        assert banner.h == int(4096 * BANNER_FRACTION)
        # Side edge-artifact margins mirror the magenta send crop
        # (sections.square_send_side_margin — sized to make the send region
        # SQUARE): hitboxes placed there would never receive paint.
        from levelbuilder.sections import square_send_side_margin
        side = square_send_side_margin(4096, 4096)
        assert (left.x, left.w, left.h) == (0, side, 4096)
        assert (right.x, right.w, right.h) == (4096 - side, side, 4096)

    def test_no_side_strips(self):
        # The portrait CROP_L/CROP_R strips must NOT appear on squares: a
        # pannable square is never side-cropped, and scaled strips would
        # blank ~12% of the world on each side for no reason.
        #
        # 2026-08-05 amendment: a deliberate 6% edge-artifact margin per side
        # IS allowed (SQUARE_SIDE_MARGIN_FRACTION) — the magenta send crop
        # excludes those strips because paint models displace content at the
        # frame edges, so placement must exclude them too. The guard now pins
        # the side strips to exactly that fraction so the old fat portrait
        # strips can never come back.
        from levelbuilder.sections import square_send_side_margin
        zones = _square_deadzones(4096, 4096)
        side_strips = [z for z in zones if z.h >= 4000 and z.w < 1000]
        expected_w = square_send_side_margin(4096, 4096)
        # Margin is whatever makes the send region square, but never the fat
        # ~12% portrait strips on BOTH sides combined beyond ~25% of width.
        assert expected_w * 2 <= 4096 * 0.25
        assert len(side_strips) == 2
        assert all(z.w == expected_w for z in side_strips)

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
