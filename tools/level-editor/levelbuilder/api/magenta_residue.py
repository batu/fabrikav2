"""Unpainted-magenta detection.

The magenta lane draws placement rings on the scene and relies on the paint
model to cover them. When it does not, the level looks complete by every
other measure — entities detected, canonical clean, gates green — and ships
with bright magenta rings across the artwork (pirate palm-root level,
2026-08-15: 64,296 residual pixels; healthy levels measure 0).

Pure and deterministic: no model, no network.
"""
from __future__ import annotations

import numpy as np

# The lane's ring colour is pure #FF00FF; the tolerance below survives
# JPEG-ish resampling without catching warm scene colours (terracotta,
# sunset skies) which keep green much closer to red.
def magenta_residue_pixels(scene: np.ndarray) -> int:
    """Count pixels that still read as placement-ring magenta."""
    arr = np.asarray(scene).astype(int)
    red, green, blue = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    ring = (
        (red > 150) & (blue > 120) & (green < 110)
        & (red - green > 60) & (blue - green > 40)
    )
    return int(ring.sum())


# A handful of stray pixels is resampling noise; a ring is thousands.
MAGENTA_RESIDUE_LIMIT = 400
