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


# ── Batched recreate (2026-08-05) ────────────────────────────────────────────
# One grid call recreates up to grid² birds at once. Measured on native2k
# (16 birds, flash-lite): 3x3 matched single-call quality at $0.0045/bird vs
# $0.034; 4x4 passed the numeric gates but visibly bled panels (retained
# scenery, merged fragments) — do not raise the default above 3.
# Two splitter lessons are load-bearing here: the model re-renders panel
# geometry (never split at input coordinates — detect magenta components and
# take the largest per cell), and dilation bridges the gutters (label raw).

GRID_PROMPT_TEMPLATE = (
    "This image is a {n}x{n} grid of panels separated by thick white "
    "gutters. The first {count} panels in row-major order each show one "
    "cartoon bird in a scene; any remaining cells are empty white padding. "
    "Recreate EACH occupied panel's bird — identical species impression, "
    "colors, markings, pose, expression, and any held or worn item — as a "
    "clean sticker illustration on a completely uniform, flat, pure magenta "
    "(#FF00FF) background, KEEPING THE EXACT SAME grid layout and white "
    "gutters. Exactly one bird per occupied panel, centered in its panel; "
    "empty padding cells must stay empty white — do not invent birds there. "
    "The output must contain exactly {count} birds. No shadows, no scenery, "
    "no gradients: perfectly flat magenta in every occupied panel except the "
    "birds. Do not merge, move, or swap panels."
)
_GRID_CANVAS = 1000  # flash-lite rejects >1K input
_GRID_GUTTER = 20


def _compose_grid(crops: list[Image.Image], n: int) -> Image.Image:
    cell = (_GRID_CANVAS - (n + 1) * _GRID_GUTTER) // n
    grid = Image.new("RGB", (_GRID_CANVAS, _GRID_CANVAS), (255, 255, 255))
    for i, crop in enumerate(crops):
        c = crop.convert("RGB").copy()
        c.thumbnail((cell, cell))
        x = _GRID_GUTTER + (i % n) * (cell + _GRID_GUTTER) + (cell - c.width) // 2
        y = _GRID_GUTTER + (i // n) * (cell + _GRID_GUTTER) + (cell - c.height) // 2
        grid.paste(c, (x, y))
    return grid


def split_grid_panels(out: Image.Image, n: int, count: int) -> list[Image.Image | None]:
    """Locate each panel in a model-rendered grid by its magenta field.
    Plain labeling (NO dilation — it bridges the gutters), largest
    component per cell, cell assignment by centroid."""
    from scipy import ndimage as _ndi

    arr = np.asarray(out.convert("RGB"), dtype=float)
    mag = (arr[:, :, 0] > 150) & (arr[:, :, 2] > 150) & (arr[:, :, 1] < 130)
    labels, _ = _ndi.label(mag)
    height, width = arr.shape[:2]
    min_area = (700 // n) ** 2
    best: dict[int, tuple[int, int, int, int]] = {}
    for sl in _ndi.find_objects(labels):
        if sl is None:
            continue
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if w * h < min_area:
            continue
        box = (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        cell = int(cy * n / height) * n + int(cx * n / width)
        if cell not in best or (box[2] - box[0]) * (box[3] - box[1]) > (
            (best[cell][2] - best[cell][0]) * (best[cell][3] - best[cell][1])
        ):
            best[cell] = box
    return [out.convert("RGB").crop(best[i]) if i in best else None for i in range(count)]


def _panel_cutout(panel: Image.Image) -> Image.Image | None:
    # Same deterministic gate order as the single path: chroma key, then
    # flat_ok (non-flat key / gray-panel / duplicate-subject detection),
    # then despill + rim strip. Batch results are marked prevalidated
    # downstream, so this is the gate that earns that flag.
    keyed = chroma_key(panel)
    ok, _reason = flat_ok(panel, keyed)
    if not ok:
        return None
    cutout = strip_flat_rim(despill(keyed))
    alpha = np.asarray(cutout)[:, :, 3]
    subject = float((alpha > 0).mean())
    if not (0.02 < subject < 0.9):
        return None
    bbox = cutout.getbbox()
    return cutout.crop(bbox) if bbox else None


def flatkey_recreate_sprites_batch(
    crops: dict[int, Image.Image],
    *,
    model: str,
    grid: int = 3,
) -> dict[int, Image.Image]:
    """Batched flat-key recreate with a retry ladder.

    grid x grid panels per call, gated per panel; panels that fail are
    re-batched once at 2x2, and final stragglers fall back to the proven
    single-call flatkey_recreate_sprite (which carries the judge gate).
    Returns only successes; caller treats missing keys as fallback-chain.
    """
    from merceka_core.image import edit_image

    results: dict[int, Image.Image] = {}

    def _run_chunk(chunk: list[int], n: int) -> list[tuple[int, Image.Image | None]]:
        grid_img = _compose_grid([crops[i] for i in chunk], n)
        try:
            out = edit_image(
                grid_img,
                GRID_PROMPT_TEMPLATE.format(n=n, count=len(chunk)),
                model=model,
            )
        except Exception:
            return [(idx, None) for idx in chunk]
        panels = split_grid_panels(out, n, len(chunk))
        return [
            (idx, _panel_cutout(panel) if panel is not None else None)
            for idx, panel in zip(chunk, panels)
        ]

    def _run(indices: list[int], n: int) -> list[int]:
        per = n * n
        chunks = [indices[start:start + per] for start in range(0, len(indices), per)]
        # Chunks within a rung are independent provider calls; a bounded pool
        # of 2 makes rung wall time ≈ the slower call, not the sum. Results
        # are collected in submit order, so output stays deterministic.
        from concurrent.futures import ThreadPoolExecutor
        failed: list[int] = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            for future in [pool.submit(_run_chunk, chunk, n) for chunk in chunks]:
                for idx, cut in future.result():
                    if cut is None:
                        failed.append(idx)
                    else:
                        results[idx] = cut
        return failed

    pending = sorted(crops)
    if grid >= 3:
        pending = _run(pending, grid)
    if pending:
        pending = _run(pending, 2)
    for idx in pending:
        try:
            single = flatkey_recreate_sprite(crops[idx], model=model)
        except Exception:
            single = None
        if single is not None:
            results[idx] = single
    return results
