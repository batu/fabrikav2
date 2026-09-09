"""Pop guard (2026-09-08): a recreated sticker is measured against the painted
bird before it is trusted; an unalignable sticker yields to the bird's own
painted pixels."""
import numpy as np
from PIL import Image, ImageDraw


def _scene(w=260, h=260):
    rng = np.random.default_rng(7)
    arr = rng.integers(60, 120, size=(h, w, 3), dtype=np.uint8)
    return Image.fromarray(arr, "RGB")


def _bird(w=80, h=60, color=(230, 40, 40)):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((4, 4, w - 4, h - 4), fill=color + (255,))
    d.ellipse((w - 30, 8, w - 8, 30), fill=(250, 220, 40, 255))
    return img


def test_fit_recovers_offset_and_scale_of_a_matching_sticker():
    from levelbuilder.api.inpaint import fit_sprite_to_painted, POP_GUARD_MAX

    bird = _bird()
    painted = _scene()
    placed = bird.resize((int(bird.width * 1.2), int(bird.height * 1.2)), Image.LANCZOS)
    painted.paste(placed.convert("RGB"), (90, 110), placed.getchannel("A"))
    fit = fit_sprite_to_painted(bird, painted)
    assert fit is not None
    assert fit["scale"] == 1.2
    assert abs(fit["x"] - 90) <= 2 and abs(fit["y"] - 110) <= 2
    assert fit["pop"] < POP_GUARD_MAX


def test_fit_reports_high_pop_for_a_sticker_that_is_not_in_the_crop():
    from levelbuilder.api.inpaint import fit_sprite_to_painted, POP_GUARD_MAX

    painted = _scene()
    other = _bird(color=(40, 200, 60))
    painted.paste(other.convert("RGB"), (100, 100), other.getchannel("A"))
    fit = fit_sprite_to_painted(_bird(color=(230, 40, 40)), painted)
    assert fit is not None and fit["pop"] > POP_GUARD_MAX


def test_fit_is_none_when_sticker_cannot_fit_the_crop():
    from levelbuilder.api.inpaint import fit_sprite_to_painted

    assert fit_sprite_to_painted(_bird(w=800, h=800), _scene()) is None


def test_painted_diff_mask_isolates_changed_pixels():
    from levelbuilder.api.inpaint import painted_diff_mask

    clean = _scene()
    painted = clean.copy()
    bird = _bird()
    painted.paste(bird.convert("RGB"), (50, 60), bird.getchannel("A"))
    mask = painted_diff_mask(painted, clean)
    arr = np.asarray(mask) > 0
    assert arr[90, 90] and not arr[10, 10]
    assert painted_diff_mask(clean, clean) is None
    assert painted_diff_mask(clean, clean.resize((10, 10))) is None


def test_fill_small_holes_fills_belly_but_keeps_large_gaps():
    from levelbuilder.api.inpaint import fill_small_holes

    a = np.zeros((100, 100), np.uint8)
    a[10:90, 10:90] = 255          # body
    a[45:50, 45:50] = 0            # small enclosed hole (25 px of 6400)
    a[20:80, 60:85] = 0            # large enclosed gap (1500 px > 12 %)
    out = np.asarray(fill_small_holes(Image.fromarray(a, "L"))) > 0
    assert out[47, 47]
    assert not out[50, 70]
    assert fill_small_holes(Image.fromarray(np.zeros((4, 4), np.uint8), "L")) is not None


def test_pop_ignores_sticker_overhang_onto_untouched_background():
    from levelbuilder.api.inpaint import fit_sprite_to_painted

    clean = _scene()
    painted = clean.copy()
    small = _bird(w=60, h=44)                      # the painted bird
    painted.paste(small.convert("RGB"), (100, 100), small.getchannel("A"))
    big = _bird(w=80, h=60)                         # sticker drawn a little larger
    without = fit_sprite_to_painted(big, painted)
    with_clean = fit_sprite_to_painted(big, painted, clean)
    assert with_clean is not None and without is not None
    assert with_clean["pop"] < without["pop"]
    assert with_clean["pop"] < 25
