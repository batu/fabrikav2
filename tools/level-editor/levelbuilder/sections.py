"""Section geometry and prompt scaffolding for landscape 3-panel levels.

Shared between the CLI generator (`tools/generate_landscape_level.py`) and the
level-builder FastAPI backend (`pipeline/levelbuilder/api/`). Contains no
env-dependent imports so the CLI's .env-load-before-imports ordering is preserved.

Layer policy:
- `mode` (portrait/landscape) is authoritative for the builder UI and level export.
- `aspect_ratio` / `image_size` remain persisted in session.json because `inpaint.py`
  reads them directly when calling `generate_image()`. `mode` implies them for landscape
  (16:9, 2K) but does not replace them on disk.

Placed at package root (not `utils/`) because `utils/` is nbsync autogen territory —
`prompts.py` and `hitboxes.py` are regenerated from notebooks. A hand-maintained module
in that directory would invite confusion.
"""

from __future__ import annotations

from levelbuilder.hitboxes import Rect

# Viewport-anchored HUD/banner heights as fractions of level height. In cover-scale
# mode the landscape level fills the viewport vertically, so the HUD (top) and ad
# banner (bottom) sit at the top/bottom of the level image itself.
# Portrait reference: HUD 191/1376=13.9%, banner 98/1376=7.1%.
HUD_FRACTION = 0.139
BANNER_FRACTION = 0.071

# Buffer on each side of a shared section boundary where dogs should not be placed —
# ensures a dog is always fully inside one section's visible slice during the camera pan.
SECTION_BOUNDARY_BUFFER = 60

# Outer edge safe area for landscape sections. Mirrors the section boundary buffer
# so dogs do not sit under landscape device cutouts or rounded screen corners at
# the far left / right of the playable view.
LANDSCAPE_EDGE_SAFE_AREA = 60

# Viewport-space left/right safe margin for the publish-time visibility gate on
# sectioned landscape levels, as a fraction of a 640px reference viewport width.
# (The gate projects each dog into device viewports; the auto-placer's image-space
# SECTION_BOUNDARY_BUFFER serves the same intent in background-pixel space.)
VIEWPORT_SAFE_FRACTION = 60.0 / 640.0

# Portrait builder reference layout (image-space, background pixels). The portrait
# auto-placer and the canvas avoid these regions, scaled from this 768x1376
# reference to the actual background dimensions. This is the single source for the
# portrait dead zones (previously hardcoded in routes.py::_portrait_deadzones).
#
# NOTE: the HUD/ad-band heights are the literal reference pixels (191 / 98), which
# are close to but NOT equal to HUD_FRACTION/BANNER_FRACTION * ref_height
# (int(1376*0.071)=97 != 98). They are intentionally kept as exact reference pixels
# so the portrait placement geometry is byte-stable; do not "simplify" them onto the
# fractions or you shift the ad band by a pixel.
PORTRAIT_REF_WIDTH = 768
PORTRAIT_REF_HEIGHT = 1376

# (x, y, w, h) rects in the 768x1376 reference frame, with a label for clarity.
PORTRAIT_REFERENCE_DEADZONES: list[tuple[str, int, int, int, int]] = [
    ("HUD",       0,   0,    768, 191),
    ("AD",        0,   1278, 768, 98),
    ("CROP_L",    0,   0,    90,  1376),
    ("CROP_R",    678, 0,    90,  1376),
    ("HINT_CHIP", 551, 1151, 137, 100),
]


def hud_band(level_height: int) -> int:
    return int(level_height * HUD_FRACTION)


def banner_band(level_height: int) -> int:
    return int(level_height * BANNER_FRACTION)


# Landscape levels have exactly 3 sections (product decision, plan-locked).
N_SECTIONS = 3


def section_forbidden_zones(
    section_index: int,
    section_width: int,
    level_height: int,
) -> list[Rect]:
    """Return forbidden-zone rectangles in section-local coordinates.

    Rectangles are (section_width x level_height). Coordinates are section-local;
    callers offset to level coords for hitbox placement.
    """
    hud = hud_band(level_height)
    banner = banner_band(level_height)
    zones = [
        Rect(x=0, y=0, w=section_width, h=hud),
        Rect(x=0, y=level_height - banner, w=section_width, h=banner),
    ]
    if section_index > 0:
        zones.append(Rect(x=0, y=0, w=SECTION_BOUNDARY_BUFFER, h=level_height))
    else:
        zones.append(Rect(x=0, y=0, w=LANDSCAPE_EDGE_SAFE_AREA, h=level_height))
    if section_index < N_SECTIONS - 1:
        zones.append(
            Rect(
                x=section_width - SECTION_BOUNDARY_BUFFER,
                y=0,
                w=SECTION_BOUNDARY_BUFFER,
                h=level_height,
            )
        )
    else:
        zones.append(
            Rect(
                x=section_width - LANDSCAPE_EDGE_SAFE_AREA,
                y=0,
                w=LANDSCAPE_EDGE_SAFE_AREA,
                h=level_height,
            )
        )
    return zones


def section_ranges(level_width: int) -> list[dict]:
    """Compute authoritative integer-arithmetic section ranges.

    Returns `[{xStart, xEnd}, ...]`. These are the numbers persisted in
    session.json so the builder canvas and the game runtime (SectionController)
    read identical boundaries. Integer division ensures the final section
    absorbs any remainder when level_width is not evenly divisible by 3.
    """
    return [
        {
            "xStart": level_width * i // N_SECTIONS,
            "xEnd": level_width * (i + 1) // N_SECTIONS,
        }
        for i in range(N_SECTIONS)
    ]
