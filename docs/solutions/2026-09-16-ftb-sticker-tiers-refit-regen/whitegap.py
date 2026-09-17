"""White-gap detector for shipped bird sprites (Batu 2026-09-17).

The image model sometimes paints a see-through gap (between the legs, inside an elbow) flat white instead
of the key colour, so the keyer keeps it opaque and the sprite carries a white blob. A gap looks like this
and nothing else does:
  * opaque, near-white, flat (no shading), small
  * fully enclosed (does not touch the transparent outside)
  * separated from the outside only by thin line-art strokes (a few px), so it sits right next to the exterior
  * its ring is line art: mostly dark pixels all around
White plumage (cheeks, wing bars, bellies, white birds) fails at least one: cheeks sit deep inside the body,
bellies are large and shaded and blend into colour, wing bars are not ringed by dark strokes.
"""
from __future__ import annotations
import numpy as np
import scipy.ndimage as ndi
from PIL import Image

WHITE_MIN = 235        # min(R,G,B) at or above this = white
MIN_PX, MAX_PX = 20, 600
FLAT_STD_MAX = 9.0
STROKE_R = 9           # structures thinner than ~2*STROKE_R px (legs, feet, outline strokes) do not count as body; measured on the fixtures
RING_DARK_LUM = 110
RING_DARK_FRAC = 0.60  # measured: gap rings 0.67-0.76 dark (line art all around), white-plumage patches <= 0.48


def _disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def find_gaps(rgba: np.ndarray) -> list[dict]:
    """Return the gap blobs of an RGBA uint8 array: [{mask, size, bbox, std}].

    A gap is a small flat white blob, enclosed in the sprite, that is separated from the outside only by
    thin structures: remove the blob from the silhouette, open the silhouette with a STROKE_R disk (legs and
    line-art strokes vanish, the body stays), and the blob must touch the outside of what remains. A cheek,
    a wing bar or a belly patch stays walled in by the thick body and never qualifies. The blob's ring must
    also be mostly dark (line art on every side); white birds have white-between-feather patches that pass
    the opening test but sit between light strokes.
    """
    rgb = rgba[..., :3].astype(int); op = rgba[..., 3] > 0
    if not op.any(): return []
    white = op & (rgb.min(axis=2) >= WHITE_MIN)
    lum = rgb.mean(axis=2)
    exterior = ~op
    lab, k = ndi.label(white)
    disk = _disk(STROKE_R)
    out = []
    for q in range(1, k + 1):
        h = lab == q; size = int(h.sum())
        if size < MIN_PX or size > MAX_PX: continue
        if (ndi.binary_dilation(h) & exterior).any(): continue           # touches the outside: not enclosed (plain edge)
        std = float(rgb[h].std())
        if std > FLAT_STD_MAX: continue                                   # shaded plumage
        ring = ndi.binary_dilation(h, iterations=3) & ~h & op
        dark = float((lum[ring] < RING_DARK_LUM).mean()) if ring.any() else 0.0
        if dark < RING_DARK_FRAC: continue                                # not bounded by line art all around (feather gaps of white birds)
        body = ndi.binary_opening(op & ~h, structure=disk)                # thick parts only
        outside_lab, _ = ndi.label(~body)
        border = np.concatenate([outside_lab[0], outside_lab[-1], outside_lab[:, 0], outside_lab[:, -1]])
        ext_ids = set(int(v) for v in np.unique(border) if v != 0)
        touch = ndi.binary_dilation(h, iterations=2) & ~h
        if not any(int(v) in ext_ids for v in np.unique(outside_lab[touch]) if v != 0): continue   # walled in by body
        ys, xs = np.where(h)
        out.append(dict(mask=h, size=size, bbox=(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())), std=std, dark=dark))
    return out


def punch_gaps(rgba: np.ndarray, gaps: list[dict]) -> tuple[np.ndarray, int]:
    """Make the gap pixels (plus their 1 px near-white antialias rim) transparent. Returns (new array, px)."""
    a = rgba.copy(); rgb = a[..., :3].astype(int); op = a[..., 3] > 0
    h = np.zeros(op.shape, bool)
    for g in gaps: h |= g['mask']
    h2 = (ndi.binary_dilation(h) & op & (rgb.min(axis=2) >= 200)) | h
    a[..., 3][h2] = 0; a[..., :3][h2] = 0
    return a, int(h2.sum())


def load(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert('RGBA'))
