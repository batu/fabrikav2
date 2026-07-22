"""Pure FTD sprite-cutout leaves: crop geometry and export framing.

Ports the deterministic geometry half of the v1 cutout pipeline
(`_crop_box`, `_SPRITE_EXPORT_PADDING_PX`, `_SPRITE_CLEANUP_PADDING_PX`).
The pixel-level alpha-cleanup algorithms (connected-component keep-largest,
grabcut seeding, SAM refinement) require imaging dependencies outside the
migrated v1 dependency set and remain an explicit deferral; sprite bytes
pass through unchanged with their algorithm provenance recorded in the
bundle metadata so a later unit can regenerate them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

# Exact v1 constants (inpaint.py:93-94).
SPRITE_EXPORT_PADDING_PX = 4
SPRITE_CLEANUP_PADDING_PX = 8

CUTOUT_ALGORITHM_VERSION = "ftd-cutout-passthrough-r1"


@dataclass(frozen=True, slots=True)
class CropBox:
    """One clamped, integer, inclusive-exclusive crop window in scene pixels."""

    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top


def crop_box(
    hitbox: Mapping[str, Any],
    scene_width: int,
    scene_height: int,
    *,
    padding_px: int = SPRITE_EXPORT_PADDING_PX,
) -> CropBox:
    """Clamp one FTD hitbox (x/y/w/h in scene pixels) to a padded crop window."""

    for name in ("x", "y", "w", "h"):
        value = hitbox.get(name)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"hitbox field {name!r} must be a number")
    if scene_width <= 0 or scene_height <= 0:
        raise ValueError("scene dimensions must be positive")
    left = max(0, int(hitbox["x"]) - padding_px)
    top = max(0, int(hitbox["y"]) - padding_px)
    right = min(scene_width, int(hitbox["x"]) + int(hitbox["w"]) + padding_px)
    bottom = min(scene_height, int(hitbox["y"]) + int(hitbox["h"]) + padding_px)
    if right <= left or bottom <= top:
        raise ValueError("hitbox does not intersect the scene")
    return CropBox(left=left, top=top, right=right, bottom=bottom)


def sprite_export(variant_image: bytes, box: CropBox) -> tuple[bytes, dict[str, Any]]:
    """Return the sprite bytes plus FTD provenance metadata for the dog bundle."""

    return variant_image, {
        "algorithm": CUTOUT_ALGORITHM_VERSION,
        "exportPaddingPx": SPRITE_EXPORT_PADDING_PX,
        "cleanupPaddingPx": SPRITE_CLEANUP_PADDING_PX,
        "cropBox": {
            "left": box.left,
            "top": box.top,
            "right": box.right,
            "bottom": box.bottom,
        },
    }
