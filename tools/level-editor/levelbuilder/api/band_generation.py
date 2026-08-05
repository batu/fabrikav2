"""Pure construction of vertical scene-extension bands.

A "band" is a dog-free strip of scenery that continues a level's native scene
upward (top band) or downward (bottom band), grown so the baked level reaches
the tall-phone target aspect. This module is the *pure* half: given the native
color art + a side + a prompt + an inpaint callable, it builds the mask-outpaint
canvas, runs the fill, and returns the band image. The durable job (band_jobs)
drives it; the bake engine (tools/level_extension_bake.py) later stacks the
accepted bands into the shipped art.

Technique (from the retired .work/level-ext/fal_fill.py harness): don't send the
whole scene to the model. Build a small canvas of `[band-to-fill] +
[thin edge-context strip of the adjacent native rows]`, with a mask that is WHITE
(paint) over the band and BLACK (keep) over the strip. FLUX Fill then paints only
the band and continues seamlessly from the pixel-identical strip — a clean join.

The `inpaint` callable is injected (defaults to `merceka_core.image.inpaint`) so
tests never hit the paid provider.
"""
from __future__ import annotations

import math
from typing import Any, Callable, Literal

from PIL import Image, ImageDraw

from merceka_core.image import inpaint as _mask_inpaint

Side = Literal["top", "bottom"]

# The one production target: height:width for the skinniest iPhone (matches #338).
TARGET_ASPECT = 2.1875
BAND_MODEL = "fal-ai/flux-pro/v1/fill"

# Callable shape of merceka_core.image.inpaint(image, mask, prompt, *, model=...).
InpaintFn = Callable[..., Image.Image]


def compute_band_heights(
    native_width: int, native_height: int, target_aspect: float = TARGET_ASPECT
) -> tuple[int, int]:
    """Return (top_band, bottom_band) color-space pixel heights that grow a
    `native_width × native_height` scene to `target_aspect` (h:w).

    The added height is split equally between top and bottom (top gets the odd
    pixel). If the native scene is already at or above the target aspect, no band
    is needed and (0, 0) is returned."""
    baked_height = round(native_width * target_aspect)
    added = baked_height - native_height
    if added <= 0:
        return (0, 0)
    top = math.ceil(added / 2)
    return (top, added - top)


def _strip_px(band_height: int) -> int:
    """Edge-context strip thickness: a fraction of the band height, floored so a
    tiny band still gets enough context for a seamless join."""
    return max(64, band_height // 8)


def build_band_canvas(
    native_color: Image.Image, side: Side, band_height: int, strip_px: int
) -> tuple[Image.Image, Image.Image]:
    """Build the (canvas, mask) pair for outpainting one band.

    Canvas is `native_width × (band_height + strip_px)`: the band region (to be
    painted) plus a strip of the adjacent native rows (kept as context). The mask
    is WHITE (255) over the band, BLACK (0) over the strip. Top band → strip is
    the scene's TOP rows placed below the band; bottom band → strip is the scene's
    BOTTOM rows placed above the band."""
    w = native_color.width
    strip_px = min(strip_px, native_color.height)
    canvas_h = band_height + strip_px
    canvas = Image.new("RGB", (w, canvas_h))
    mask = Image.new("L", (w, canvas_h), 0)
    draw = ImageDraw.Draw(mask)
    # ImageDraw.rectangle is INCLUSIVE of both endpoints, so paint exactly the band
    # rows (0..band_height-1 for top; strip_px..canvas_h-1 for bottom) and leave the
    # full context strip black (kept) — a fencepost error here would let the model
    # repaint a strip row and weaken the pixel-identical join.
    if side == "top":
        # [ band (paint) ][ strip = native top rows (keep) ]
        strip = native_color.crop((0, 0, w, strip_px))
        canvas.paste(strip, (0, band_height))
        draw.rectangle((0, 0, w - 1, band_height - 1), fill=255)
    else:
        # [ strip = native bottom rows (keep) ][ band (paint) ]
        strip = native_color.crop((0, native_color.height - strip_px, w, native_color.height))
        canvas.paste(strip, (0, 0))
        draw.rectangle((0, strip_px, w - 1, canvas_h - 1), fill=255)
    return canvas, mask


def derive_band_prompt(side: Side, scene_meta: dict[str, Any]) -> str:
    """Derive a scene-aware prompt for a band from the session's scene metadata
    (`setting`/`scene`/`entity`/`scene_prompt`), plus the fixed continuation
    template and the no-living-things/no-text guard."""
    context_bits = [
        str(scene_meta.get(k)).strip()
        for k in ("setting", "scene", "scene_prompt")
        if scene_meta.get(k)
    ]
    context = ", ".join(context_bits)
    guard = "No animals, no birds, no characters, no dogs, no people, no text, no watermarks."
    if side == "bottom":
        body = (
            "Continue the scene seamlessly downward: more of the same foreground "
            "ground, less detail, same camera angle, scale, perspective, style and "
            "lighting. No new structures."
        )
    else:
        body = (
            "Continue the scene seamlessly upward: let any buildings, walls or "
            "fences at the top edge simply end, and fade into a simple open "
            "low-detail background (sky, grass, water or floor as appropriate). "
            "Calm, sparse, mostly empty."
        )
    prefix = f"Scene: {context}. " if context else ""
    return f"{prefix}{body} {guard}"


def generate_band(
    native_color: Image.Image,
    side: Side,
    band_height: int,
    prompt: str,
    *,
    inpaint: InpaintFn = _mask_inpaint,
    strip_px: int | None = None,
) -> Image.Image:
    """Generate one band: build the strip-context canvas + mask, run the mask
    outpaint via `inpaint`, and crop the painted band region back out at native
    width × `band_height`. `inpaint` is injectable for tests."""
    strip = strip_px if strip_px is not None else _strip_px(band_height)
    canvas, mask = build_band_canvas(native_color, side, band_height, strip)
    painted = inpaint(canvas, mask, prompt, model=BAND_MODEL)
    if painted.size != canvas.size:
        painted = painted.resize(canvas.size, Image.LANCZOS)
    w = native_color.width
    if side == "top":
        band = painted.crop((0, 0, w, band_height))
    else:
        band = painted.crop((0, canvas.height - band_height, w, canvas.height))
    return band.convert("RGB")
