"""BUG-8 mutation scrub — OFF by default, not wired into any lane.

The paint model redecorates scenes outside bird sites (measured 4.6–5.6% of
canvas on control levels, 2026-08-13). Because the magenta round-trip is
byte-aligned, we know exactly which pixels it was entitled to change: those
at the placement discs. This module reverts every changed component that
does not intersect a dilated disc — birds stay, redecoration is undone by
construction, phantom off-disc birds are erased.

Built 2026-08-14 overnight under the operator's explicit gate: code + tests
+ a before/after demo on one already-paid level. It enters the lane only
after the operator approves the evidence. Nothing here writes to a level.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

DIFF_THRESHOLD = 24
# Painted birds regularly render larger than their disc (why the runtime
# multiplies tap radius by 2); the keep-test dilates the disc the same way.
DISC_DILATION = 2.2


@dataclass
class ScrubResult:
    scene: np.ndarray
    stats: dict[str, Any] = field(default_factory=dict)


def scrub_scene(
    painted: np.ndarray,
    clean: np.ndarray,
    *,
    hitboxes: list[dict],
    threshold: int = DIFF_THRESHOLD,
    dilation: float = DISC_DILATION,
) -> ScrubResult:
    """Return a scrubbed copy of `painted` plus telemetry. Pure function."""
    from scipy import ndimage

    if painted.shape != clean.shape:
        raise ValueError(f"shape mismatch: painted {painted.shape} vs clean {clean.shape}")
    diff = (np.abs(painted.astype(int) - clean.astype(int)).max(axis=2) > threshold)
    labels, count = ndimage.label(diff)
    if count == 0:
        return ScrubResult(painted.copy(), {
            "components": 0, "keptComponents": 0, "revertedComponents": 0,
            "revertedPixels": 0, "keptPixels": 0,
        })
    height, width = diff.shape
    yy, xx = np.ogrid[:height, :width]
    disc_mask = np.zeros_like(diff)
    for hitbox in hitboxes:
        radius = float(hitbox.get("r", hitbox.get("radius", 30))) * dilation
        disc_mask |= ((xx - float(hitbox["x"])) ** 2 + (yy - float(hitbox["y"])) ** 2) <= radius ** 2
    # A component survives iff it touches any dilated disc.
    touching = set(np.unique(labels[disc_mask & diff]))
    touching.discard(0)
    keep = np.isin(labels, sorted(touching)) if touching else np.zeros_like(diff)
    revert = diff & ~keep
    out = painted.copy()
    out[revert] = clean[revert]
    return ScrubResult(out, {
        "components": int(count),
        "keptComponents": len(touching),
        "revertedComponents": int(count) - len(touching),
        "revertedPixels": int(revert.sum()),
        "keptPixels": int(keep.sum()),
    })
