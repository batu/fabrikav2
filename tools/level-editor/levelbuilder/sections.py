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
# Portrait reference: HUD 230/1376=16.7%, banner 98/1376=7.1%.
HUD_FRACTION = 230 / 1376
BANNER_FRACTION = 0.071

# Side edge-safety margin for square (pan/zoom) scenes, as a fraction of level
# width. Full-scene paint models displace content most near the frame edges
# (alignment probes 2026-08-05: 43-448px at edge windows vs ~11px center), so
# the magenta send crop excludes these strips and placement must too — a
# magenta circle inside the margin would be cropped out of the paint call and
# never painted. NOT a phone-crop deadzone: square levels pan, sides are
# playable; this is an edge-artifact buffer only.
SQUARE_SIDE_MARGIN_FRACTION = 0.06

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
# HUD and HINT_CHIP are MEASURED, not designed: captured from the running game
# across 10 device presets with simulated safe-area insets, mapped into this
# reference frame via inverse cover-scaling, unioned, padded 8px
# (tests/test_measured_deadzones.py pins them; re-run the chrome capture after
# any HUD/hint layout change). The AD band stays at the literal reference 98px
# so the ad-band geometry is byte-stable vs BANNER_FRACTION rounding.
PORTRAIT_REF_WIDTH = 768
PORTRAIT_REF_HEIGHT = 1376

# (x, y, w, h) rects in the 768x1376 reference frame, with a label for clarity.
PORTRAIT_REFERENCE_DEADZONES: list[tuple[str, int, int, int, int]] = [
    ("HUD",       0,   0,    768, 230),
    ("AD",        0,   1278, 768, 98),
    ("CROP_L",    0,   0,    90,  1376),
    ("CROP_R",    678, 0,    90,  1376),
    ("HINT_CHIP", 531, 1117, 213, 138),
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
