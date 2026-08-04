"""Flat-key pickup-sprite extraction — the map #14 winning technique.

An image-edit call recreates the painted bird alone on pure magenta; a fitted
chroma key recovers the RGBA sprite deterministically. Ported verbatim from
the validated corpus-regen lane (docs/evidence/2026-08-04-corpus-regen,
technique flatkey-gemini-flash-v5, 75/75 shipped).
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

FLAT_PROMPT = (
    "Recreate the exact same cartoon bird character from this image — identical "
    "species impression, colors, markings, pose, expression, and any held or worn "
    "item (broom, basket, hat, tool: keep it) — as a clean sticker illustration "
    "on a completely uniform, flat, pure magenta (#FF00FF) background. Match the "
    "image's rendering style (if it is uncolored line art, stay uncolored). "
    "Exactly ONE bird. No shadows, no scenery, no props that the bird is not "
    "holding, no gradient, no texture: perfectly flat magenta everywhere except "
    "the bird itself. The bird must be fully inside the frame."
)


def _estimate_background_field(rgb: np.ndarray) -> tuple[np.ndarray, float]:
    """Fit the model's unwanted smooth magenta gradient from border pixels."""
    height, width, _ = rgb.shape
    border_width = max(4, round(min(width, height) * 0.035))
    yy, xx = np.mgrid[0:height, 0:width]
    x = xx.astype(np.float32) / max(1, width - 1)
    y = yy.astype(np.float32) / max(1, height - 1)
    features = np.stack(
        (
            np.ones_like(x),
            x,
            y,
            x * y,
            x * x,
            y * y,
            x * x * x,
            y * y * y,
        ),
        axis=-1,
    )
    border = (xx < border_width) | (xx >= width - border_width) | (yy < border_width) | (
        yy >= height - border_width
    )
    coefficients, *_ = np.linalg.lstsq(features[border], rgb[border], rcond=None)
    background = np.clip(features @ coefficients, 0.0, 255.0)
    channel_range = np.maximum(background, 255.0 - background)
    residual = np.max(np.abs(rgb - background) / np.maximum(channel_range, 1.0), axis=2)
    noise_floor = float(np.quantile(residual[border], 0.997))
    return background, min(noise_floor, 0.12)


def chroma_key(image: Image.Image) -> Image.Image:
    """Recover antialiased RGBA from a model-rendered magenta background."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    background, noise_floor = _estimate_background_field(rgb)
    # C=aF+(1-a)B. The largest channel departure from the fitted background,
    # normalized by that channel's possible range, is a conservative alpha
    # estimate when magenta is forbidden in the subject.
    channel_range = np.maximum(background, 255.0 - background)
    raw_alpha = np.max(np.abs(rgb - background) / np.maximum(channel_range, 1.0), axis=2)
    alpha = np.clip((raw_alpha - noise_floor) / max(1e-6, 1.0 - noise_floor), 0.0, 1.0)
    # Keep only the subject connected component, then retain two pixels of its
    # low-alpha antialiased fringe. This removes smooth-fit residual at the
    # canvas borders and guarantees there are no satellite fragments.
    labels, component_count = ndimage.label(alpha >= 0.10)
    if component_count == 0:
        raise RuntimeError("chroma key found no foreground component")
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    subject = labels == int(np.argmax(areas))
    support = ndimage.binary_dilation(subject, iterations=2)
    alpha[~support] = 0.0
    alpha[alpha < 0.008] = 0.0
    # Color distance only provides a lower bound on alpha: an opaque pale bird
    # can share red/blue values with magenta. Make the component interior fully
    # opaque and reserve decontamination for its narrow antialiased boundary.
    interior = ndimage.binary_erosion(subject, iterations=2)
    alpha[interior] = 1.0
    safe_alpha = np.maximum(alpha[:, :, None], 1.0 / 255.0)
    foreground = (rgb - (1.0 - alpha[:, :, None]) * background) / safe_alpha
    foreground = np.clip(foreground, 0.0, 255.0)
    rgba = np.dstack((foreground, alpha[:, :, None] * 255.0)).astype(np.uint8)
    result = Image.fromarray(rgba, mode="RGBA")
    bbox = result.getchannel("A").point(lambda value: 255 if value >= 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("chroma key produced an empty cutout")
    left, top, right, bottom = bbox
    padding = max(4, round(max(right - left, bottom - top) * 0.025))
    crop_box = (
        max(0, left - padding),
        max(0, top - padding),
        min(result.width, right + padding),
        min(result.height, bottom + padding),
    )
    return result.crop(crop_box)



def despill(cutout):
    """Neutralize residual magenta/green halo on edge pixels."""
    arr = np.asarray(cutout.convert("RGBA")).astype(np.int16)
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    edge = (a > 0) & (a < 255)
    magenta = (r > g + 40) & (b > g + 40)
    green = (g > r + 40) & (g > b + 40)
    spill = (edge | (a > 0)) & (magenta | green)
    # pull spill pixels toward their neighborhood-neutral gray
    m = (r + g + b) // 3
    for c in range(3):
        arr[:,:,c] = np.where(spill, m, arr[:,:,c])
    # fully drop low-alpha spill edge
    arr[:,:,3] = np.where(spill & (a < 90), 0, arr[:,:,3])
    from PIL import Image as _I
    return _I.fromarray(arr.astype("uint8"), "RGBA")


def flat_ok(flat, cutout):
    """Detect failed generations: non-flat key or duplicated subject."""
    arr = np.asarray(flat.convert("RGB")).astype(np.int16)
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    key = (r > 180) & (b > 180) & (g < 120)
    ca = np.asarray(cutout.convert("RGBA"))[:,:,3] > 8
    keyfrac = float(key.mean()); birdfrac = float(ca.mean())
    if keyfrac + birdfrac < 0.97:  # anything beyond bird+key = painted context
        return False, f"non-flat key (key={keyfrac:.2f} bird={birdfrac:.2f})"
    # background-purity inside the cutout: near-gray or near-white large zones
    ca_arr = np.asarray(cutout.convert("RGBA")).astype(np.int16)
    rr, gg, bb2, aa = ca_arr[:,:,0], ca_arr[:,:,1], ca_arr[:,:,2], ca_arr[:,:,3]
    vis = aa > 8
    grayish = vis & (abs(rr-gg) < 18) & (abs(gg-bb2) < 18) & (rr > 90) & (rr < 230)
    if vis.sum() and float(grayish.sum())/float(vis.sum()) > 0.45:
        return False, f"cutout dominated by flat gray/white background ({grayish.sum()/vis.sum():.2f})"
    from levelbuilder.api.sprite_eval import _connected_components
    comps = _connected_components(ca)
    big = [c for c in comps if c.sum() > 0.25 * max(1, comps[0].sum())]
    if len(big) > 1:
        return False, f"{len(big)} large components (duplicate subject?)"
    return True, ""


def strip_flat_rim(cutout: Image.Image) -> Image.Image:
    """Remove edge-connected flat backdrop remnants from a chroma-keyed sprite:
    the white sticker rim and any low-saturation gray panel the model rendered
    instead of magenta. Flood from the transparent edge through low-saturation
    bright pixels; the dark line-art outline stops the flood, so gray/white
    interior plumage survives."""
    a = np.asarray(cutout.convert("RGBA"), dtype=np.uint8).copy()
    rgb = a[..., :3].astype(int)
    al = a[..., 3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = mx - mn
    flatish = (al > 0) & (sat < 34) & (mx > 110)
    transparent = al == 0
    edge = ndimage.binary_dilation(np.pad(transparent, 1, constant_values=True))[1:-1, 1:-1]
    labels, n = ndimage.label(flatish)
    rim = np.zeros_like(flatish)
    for i in range(1, n + 1):
        m = labels == i
        if (m & edge).any():
            rim |= m
    halo = ndimage.binary_dilation(rim) & (sat < 50) & (mx > 100) & ~rim
    a[..., 3][rim | halo] = 0
    return Image.fromarray(a)


def judge_gate(cutout: Image.Image, painted: Image.Image) -> bool:
    """Codex vision gate from the validated corpus lane: complete single bird
    (+ held item), no stray artifacts. Fails open when the judge is
    unavailable — the deterministic gates already passed."""
    import os as _os
    if _os.environ.get("FTD_FLATKEY_NO_JUDGE"):
        return True
    try:
        from levelbuilder.api.sprite_judge import CodexExecJudge, JudgeCase
        v = CodexExecJudge().judge(JudgeCase(dog_id="gate", sprite=cutout, painted_crop=painted))
    except Exception:
        return True
    if not v.ok:
        return True
    return v.subject >= 0.5 and v.completeness >= 0.5


def flatkey_recreate_sprite(
    painted_crop: Image.Image,
    *,
    model: str,
    attempts: int = 2,
) -> Image.Image | None:
    """Painted bird crop -> RGBA sprite via magenta recreate + chroma key.
    Returns None when every attempt fails the purity gates (caller falls
    back to the free extractor chain)."""
    from merceka_core.image import edit_image

    for _ in range(attempts):
        flat = edit_image(painted_crop.convert("RGB"), FLAT_PROMPT, model=model)
        cutout = chroma_key(flat.convert("RGB"))
        ok, _reason = flat_ok(flat, cutout)
        if not ok:
            continue
        cutout = despill(cutout)
        cutout = strip_flat_rim(cutout)
        bbox = cutout.getbbox()
        if bbox is None:
            continue
        cutout = cutout.crop(bbox)
        if not judge_gate(cutout, painted_crop):
            continue
        return cutout
    return None
