import numpy as np
from PIL import Image

from levelbuilder.api.flatkey import despill, finalize_cutout


def _rgba(w, h, rgb, alpha=255):
    a = np.zeros((h, w, 4), np.uint8)
    a[..., :3] = rgb
    a[..., 3] = alpha
    return a


def test_despill_leaves_interior_green_plumage_alone():
    a = _rgba(20, 20, (40, 160, 40))          # solid green bird
    a[0, :, 3] = 120                           # one antialiased row
    out = np.asarray(despill(Image.fromarray(a, "RGBA")))
    assert tuple(out[10, 10, :3]) == (40, 160, 40)   # interior untouched
    assert out[0, 5, 0] == out[0, 5, 1] == out[0, 5, 2]  # rim neutralised


def test_finalize_cutout_key_gap_goes_transparent_and_plumage_hole_is_restored():
    a = _rgba(30, 30, (120, 80, 40))
    a[10:14, 10:14, :3] = (240, 20, 240)       # key colour forced opaque = a real gap
    a[20:23, 20:23, 3] = 0                     # keyed-away pink plumage hole
    a[20:23, 20:23, :3] = (230, 120, 200)
    out = np.asarray(finalize_cutout(Image.fromarray(a, "RGBA")))
    assert (out[10:14, 10:14, 3] == 0).all()
    assert (out[20:23, 20:23, 3] == 255).all()
    # transparent pixels carry a neighbour colour, never the key colour
    assert tuple(out[12, 12, :3]) == (120, 80, 40)
