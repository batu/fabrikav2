"""Sticker lane: judge -> refit -> regenerate -> white-gap, per bird, on a canonical session.

Formalizes the 2026-09-16/17 intake lane (docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen,
handoff docs/handoffs/2026-09-16-ftb-intake-plan-agreed.md). It runs AFTER Extract All and before the
human cutout review, as a durable job, and writes every result through the canonical promotion path
(the same commit the per-bird extract uses), so sprite history keeps the before/after and reviews are
invalidated per changed artifact class. Nothing here touches public/levels; export does that.

Order per level (Batu, do not reorder):
  1. tier judge on every sticker: panel = painted | sticker on grey | 50% overlay, 4 tiers
     (T1 match, T2 size/shape shift, T3 colour/detail, T4 different bird or pose). keep = T1/T2.
  2. refit: uniform scale ladder 0.6-2.0 + width:height ratio 0.8-1.25, masked template match
     against the paint; gate pop <= 45, hitbox inside the box, overlap with the old box.
     A refused refit joins the regenerate class regardless of the judge. A T3 that refits with
     pop <= 25 stays (the paint agrees with it; the judge saw a detail, not a defect).
  3. regenerate the regenerate class: visible-part prompt, sunburst low, two crops (the Extract All
     square, then the painted-extent-grown square capped at MAX_CROP_R x r), editor keying
     (chroma_key -> strip_flat_rim -> despill -> finalize_cutout), best masked match wins,
     chunk-sticker gate (a sticker that is a filled rectangle wider than 2.2 r is a scene chunk).
  4. refit + judge the regenerated stickers again; what is still refused is listed for the operator,
     never a blind second round.
  5. white gaps: a small flat white blob enclosed only by line art next to the outside is a
     see-through gap the model painted white; the detector proposes, the judge confirms, the lane
     punches. White cheeks/bellies are never touched without the judge.
  6. a bird whose judge says the painted bird is missing is reported, not regenerated (operator
     decides delete vs add).
  7. restoration: the canonical restore asset becomes the birdless restoration (scene minus each
     bird's own pixels, the legacy writer's rule) instead of the raw clean plate.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import re
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from . import session as S
from .whitegap import find_gaps, punch_gaps

# ── constants (measured on levels 1-8 and the 60-level intake, 2026-09-16) ──────────────
LANE_SCALES = tuple(round(0.6 + i * 0.05, 2) for i in range(29))  # 0.60 .. 2.00
RATIOS = tuple(round(0.8 + 0.05 * k, 2) for k in range(10))       # 0.80 .. 1.25
POP_MAX = 45.0          # refit gate: mean |RGB| under the sticker vs the paint
STRONG_POP = 25.0       # a T3 that fits this well stays
CHUNK_FILL = 0.8        # alpha fill of the bbox above this ...
CHUNK_RADIUS = 2.2      # ... and bbox long edge above this x r = scene chunk, not a bird
SHIP_MAX_PX = 288       # shipped sticker long edge cap
SCENERY_FAR_R = 2.2     # sticker pixels farther than this x r from the hitbox ...
SCENERY_FAR_FRAC = 0.10 # ... above this share = the sticker carries scenery (measured 2026-09-17: chunks 0.19-0.69, birds 0.00-0.04)
SCENERY_LONG_R = 4.5    # or a sticker box longer than this x r (painted birds run 1-2 r; chunks 4.8-12 r)
JUDGE_BREAKER = 2       # consecutive failures after which a judge backend is skipped for the rest of the run
DEFAULT_REGEN_MODEL = "openai/gpt-image-2.5-sunburst"
DEFAULT_REGEN_QUALITY = "low"
DEFAULT_MAX_CROP_R = 5.0
DEFAULT_JUDGE = "agy,openrouter"
DEFAULT_JUDGE_MODEL = "google/gemini-3.8-flash"
PANEL_TILE = 260
TECHNIQUE = "sticker-lane-sunburst-low-visible-v1"
JOB_KIND = "sticker_lane"
SUMMARY_FILE = "sticker-lane.json"

TIER_PROMPT = (
    "It has three panels left to right: the in-game painted bird, the cutout sprite on grey, and the "
    "cutout drawn at 50% opacity over the painted bird. Judge how well the cutout matches the painted "
    "bird. A valid pickup sprite contains exactly one complete bird PLUS any items the bird is holding, "
    "wearing, or using (binoculars, hat, book, telescope, map). Perches, branches, stalls, walls, window "
    "frames, baskets, ground, lines and any scenery painted around the bird are BACKGROUND and must NOT "
    "be part of the sprite. Tier 1 = matches in shape, size and colour. Tier 2 = same bird and pose but "
    "visibly different size (typically smaller) or a shape shift. Tier 3 = right bird, right size, but "
    "colour or detail differences (different accessories, missing or extra props, different markings). "
    "Tier 4 = different bird, OR the same bird in a different pose, orientation or facing direction (a "
    "pose or facing change is always tier 4, never tier 3), OR the cutout includes scenery or background "
    "that is not the bird or an item it holds. Output exactly one JSON object and nothing else, no "
    'markdown, no explanation outside it: {"tier": <1|2|3|4>, "why": "<=20 words"}'
)
GAP_PROMPT = (
    "It shows one cartoon bird sticker three times: left = the sticker on grey; middle = the same sticker "
    "with ONE candidate region painted solid red; right = a zoom on that region. The sticker should be "
    "see-through wherever there is no bird: the question is whether the red region is a GAP (empty space "
    "between body parts such as between the legs, under the belly next to the legs, inside a bent wing or "
    "elbow, between the bird and something it holds, where the scene behind should show through) that was "
    "wrongly filled with white, or whether it is genuinely part of the bird or its item (a white cheek, "
    "throat, belly, breast, eye ring, wing bar, tail feather, or a white object it holds). Output exactly "
    'one JSON object and nothing else: {"gap": true|false, "why": "<=15 words"}'
)
# The judge's "why" when the painted bird is not there at all (VLM-minted hitbox with no bird under it).
MISSING = re.compile(
    r"(no|missing|absent|not present|lacks?|does not exist|nothing)\b[^.]*\b(painted|scene|background|in.game|reference|original)"
    r"|(painted|scene|background|in.game|reference|original)\b[^.]*\b(missing|absent|no bird|not present|lacks (a |the )?bird|does not (exist|contain)|empty)",
    re.I,
)


# ── judges ────────────────────────────────────────────────────────────────────────────────
def parse_tier_json(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError(f"no tier JSON in output: {text[:160]!r}")
    data = json.loads(match.group(0))
    tier = int(data["tier"])
    if tier not in (1, 2, 3, 4):
        raise ValueError(f"tier out of range: {tier}")
    return {"tier": tier, "why": str(data.get("why", ""))}


def parse_gap_json(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError(f"no gap JSON in output: {text[:160]!r}")
    data = json.loads(match.group(0))
    if not isinstance(data.get("gap"), bool):
        raise ValueError(f"gap is not a boolean: {data.get('gap')!r}")
    return {"gap": data["gap"], "why": str(data.get("why", ""))}


def agy_ask(panel: Path, prompt: str, *, timeout_s: float = 260.0) -> str:
    """Antigravity CLI (subscription): the model reads the panel with its own image tool."""
    full = f"Read the image file {panel.resolve()} with your image viewing tool. {prompt}"
    proc = subprocess.run(
        ["agy", "-p=" + full, "--dangerously-skip-permissions", "--output-format", "json", "--print-timeout", "4m"],
        capture_output=True, text=True, cwd=panel.parent, timeout=timeout_s, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"agy exit {proc.returncode}: {proc.stderr[-200:]}")
    return str(json.loads(proc.stdout)["response"])


def openrouter_ask(panel: Path, prompt: str, *, model: str = DEFAULT_JUDGE_MODEL) -> str:
    """OpenRouter fallback (paid, $0.003/panel on gemini-3.8-flash): the panel is attached."""
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise RuntimeError("OPENROUTER_API_KEY not configured")
    from merceka_core.llm import LLM

    llm = LLM(model_name=f"openrouter/{model}", system_prompt="The image " + prompt)
    response = llm.generate_with_resource("Judge the attached panel.", resource_path=panel, temperature=0.0, max_tokens=4000)
    return response if isinstance(response, str) else str(response)


AskFn = Callable[[Path, str], str]


@dataclass
class VisionJudge:
    """Ordered backends; the first that answers wins, errors fall through (agy first: Batu 2026-09-16)."""

    backends: tuple[tuple[str, AskFn], ...]
    failures: dict[str, int] = field(default_factory=dict)
    tripped: set[str] = field(default_factory=set)

    @classmethod
    def from_spec(cls, spec: str = DEFAULT_JUDGE, *, model: str = DEFAULT_JUDGE_MODEL) -> "VisionJudge":
        known: dict[str, AskFn] = {
            "agy": agy_ask,
            "openrouter": lambda panel, prompt: openrouter_ask(panel, prompt, model=model),
        }
        names = [name.strip() for name in spec.split(",") if name.strip()]
        unknown = [name for name in names if name not in known]
        if unknown:
            raise ValueError(f"unknown judge backend: {unknown[0]} (known: {sorted(known)})")
        return cls(tuple((name, known[name]) for name in names))

    def ask(self, panel: Path, prompt: str, parse: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
        t0 = time.time()
        error = "no backends"
        for name, fn in self.backends:
            if name in self.tripped:
                continue  # breaker: an exhausted agy quota cost 95 s per bird before this (2026-09-17)
            try:
                data = parse(fn(panel, prompt))
                self.failures[name] = 0
                return {**data, "backend": name, "seconds": round(time.time() - t0, 1)}
            except Exception as exc:  # noqa: BLE001 — the next backend gets its turn
                error = f"{name}: {type(exc).__name__}: {str(exc)[:120]}"
                self.failures[name] = self.failures.get(name, 0) + 1
                if self.failures[name] >= JUDGE_BREAKER:
                    self.tripped.add(name)
        return {"error": error, "backend": None, "seconds": round(time.time() - t0, 1)}


# ── panels ────────────────────────────────────────────────────────────────────────────────
def tier_panel(painted_crop: Image.Image, sprite: Image.Image, offset: tuple[int, int], tile: int = PANEL_TILE) -> Image.Image:
    """painted | sticker on grey | 50% overlay, each thumbnailed to `tile`."""
    pc = painted_crop.convert("RGB")
    spr = sprite.convert("RGBA")
    grey = Image.new("RGBA", pc.size, (128, 128, 128, 255))
    grey.alpha_composite(spr, offset)
    half = spr.copy()
    half.putalpha(half.split()[3].point(lambda v: v // 2))
    overlay = pc.convert("RGBA")
    overlay.alpha_composite(half, offset)
    sheet = Image.new("RGB", (3 * tile + 20, tile + 10), (40, 40, 40))
    for k, im in enumerate((pc, grey.convert("RGB"), overlay.convert("RGB"))):
        im = im.copy()
        im.thumbnail((tile, tile))
        sheet.paste(im, (k * (tile + 5) + 5, 5))
    return sheet


def gap_panel(rgba: np.ndarray, gap: dict[str, Any]) -> Image.Image:
    """sticker on grey | candidate in red | 6x zoom of the candidate."""
    z = 3
    base = Image.fromarray(rgba, "RGBA").resize((rgba.shape[1] * z, rgba.shape[0] * z), Image.NEAREST)
    ov = rgba.copy()
    ov[gap["mask"]] = [255, 0, 0, 255]
    red = Image.fromarray(ov, "RGBA").resize(base.size, Image.NEAREST)
    x0, y0, x1, y1 = gap["bbox"]
    pad = 18
    box = (max(0, x0 - pad), max(0, y0 - pad), min(rgba.shape[1], x1 + pad), min(rgba.shape[0], y1 + pad))
    zoom = Image.fromarray(ov, "RGBA").crop(box)
    zoom = zoom.resize((zoom.width * 6, zoom.height * 6), Image.NEAREST)
    sheet = Image.new("RGB", (base.width * 2 + zoom.width + 40, max(base.height, zoom.height) + 10), (110, 110, 110))
    sheet.paste(base, (5, 5), mask=base.split()[3])
    sheet.paste(red, (base.width + 15, 5), mask=red.split()[3])
    sheet.paste(zoom, (base.width * 2 + 30, 5), mask=zoom.split()[3])
    return sheet


# ── geometry ──────────────────────────────────────────────────────────────────────────────
def fit_aniso(sprite: Image.Image, painted: Image.Image, clean_crop: Image.Image | None,
              *, scales: tuple[float, ...] = LANE_SCALES) -> dict[str, Any] | None:
    """Uniform ladder (editor fit), then width:height ratio 0.80..1.25 around that size with one
    uniform nudge. Same masked SQDIFF match and the same pop definition as the editor."""
    import cv2

    from .inpaint import fit_sprite_to_painted

    base = fit_sprite_to_painted(sprite, painted, clean_crop, scales=scales)
    if not base:
        return None
    rgba = np.asarray(sprite.convert("RGBA"), np.uint8)
    src_rgb, src_a = rgba[..., :3], rgba[..., 3]
    scene = np.asarray(painted.convert("RGB"), np.uint8)
    sh, sw = scene.shape[:2]
    changed = None
    if clean_crop is not None:
        clean = np.asarray(clean_crop.convert("RGB"), np.int16)
        if clean.shape == scene.shape:
            changed = np.abs(scene.astype(np.int16) - clean).sum(2) > 40

    def match(w: int, h: int):
        if w > sw or h > sh or w < 2 or h < 2:
            return None
        rgb = cv2.resize(src_rgb, (w, h), interpolation=cv2.INTER_AREA)
        a = cv2.resize(src_a, (w, h), interpolation=cv2.INTER_AREA)
        mask = np.repeat((a > 8)[:, :, None], 3, 2).astype(np.uint8) * 255
        if not mask.any():
            return None
        e = cv2.matchTemplate(scene, rgb, cv2.TM_SQDIFF_NORMED, mask=mask)
        e = np.nan_to_num(e, nan=1.0, posinf=1.0, neginf=1.0)
        y, x = np.unravel_index(int(np.argmin(e)), e.shape)
        return (1.0 - min(float(e[y, x]), 1.0), int(x), int(y), w, h)

    s = base["scale"]
    best = None
    for r in RATIOS:
        for s2 in (s - 0.05, s, s + 0.05):
            m = match(int(round(sprite.width * s2 * r ** 0.5)), int(round(sprite.height * s2 / r ** 0.5)))
            if m and (best is None or m > best):
                best = m + (s2, r)
    if best is None:
        return None
    score, x, y, w, h, s2, r = best
    rgb = cv2.resize(src_rgb, (w, h), interpolation=cv2.INTER_AREA).astype(np.int16)
    a = cv2.resize(src_a, (w, h), interpolation=cv2.INTER_AREA) > 128
    region = scene[y:y + h, x:x + w].astype(np.int16)
    measure = a
    if changed is not None:
        on_bird = a & changed[y:y + h, x:x + w]
        if on_bird.sum() >= max(64, 0.2 * a.sum()):
            measure = on_bird
    pop = float(np.abs(rgb[measure] - region[measure]).mean()) if measure.any() else 255.0
    return {"score": round(score, 4), "scale": round(s2, 2), "ratio": r, "x": x, "y": y, "width": w, "height": h, "pop": round(pop, 1)}


def refit_gate(fit: dict[str, Any], hitbox: dict[str, Any], current_box: tuple[int, int, int, int],
               crop_origin: tuple[int, int]) -> tuple[str, dict[str, Any] | None]:
    """Gate a fit (pop <= POP_MAX, hitbox inside, overlap with the current box).
    Returns (status, {x, y, width, height, anchorX, anchorY, refit}) with the box in scene coordinates."""
    rx, ry, rw, rh = crop_origin[0] + fit["x"], crop_origin[1] + fit["y"], fit["width"], fit["height"]
    x, y, w, h = current_box
    ax, ay = (hitbox["x"] - rx) / rw, (hitbox["y"] - ry) / rh
    inside = 0 <= ax <= 1 and 0 <= ay <= 1
    overlap = rx < x + w and x < rx + rw and ry < y + h and y < ry + rh
    if fit["pop"] > POP_MAX:
        return f"refused: pop {fit['pop']:.0f}", None
    if not inside:
        return "refused: hitbox outside", None
    if not overlap:
        return "refused: no overlap", None
    return "applied", {
        "x": int(rx), "y": int(ry), "width": int(rw), "height": int(rh),
        "anchorX": round(ax, 4), "anchorY": round(ay, 4),
        "refit": {"scale": fit["scale"], "ratio": fit.get("ratio", 1.0), "pop": fit["pop"], "score": fit["score"],
                  "dx": int(rx - x), "dy": int(ry - y)},
    }


def is_chunk_sticker(rgba: np.ndarray, radius: float) -> bool:
    """A sticker whose alpha fills its bbox almost completely and whose bbox is wider than 2.2 r is a
    scene chunk (the model returned the crop), not a bird: it passes refit (pop ~0) and fools the judge."""
    op = rgba[..., 3] > 8
    if not op.any():
        return False
    ys, xs = np.where(op)
    bw, bh = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
    fill = float(op.sum()) / float(bw * bh)
    return fill > CHUNK_FILL and max(bw, bh) > CHUNK_RADIUS * radius


def is_scenery_sticker(alpha: np.ndarray, box: tuple[int, int, int, int], hitbox: dict[str, Any]) -> dict[str, Any] | None:
    """A sticker whose opaque pixels sit far from its hitbox, or whose box is far longer than the
    tap radius, carries scenery (window frames, wall lines, baskets, ground strips): Extract All cut
    it from a crop the painted-extent growth blew up to. Returns the measurement when it trips."""
    x, y, w, h = box
    r = float(hitbox.get("r", 57))
    op = alpha > 8
    if not op.any():
        return None
    ys, xs = np.where(op)
    far = float((np.hypot(xs + x - float(hitbox["x"]), ys + y - float(hitbox["y"])) > SCENERY_FAR_R * r).mean())
    long_r = max(w, h) / r
    if far > SCENERY_FAR_FRAC or long_r > SCENERY_LONG_R:
        return {"farFraction": round(far, 3), "longEdgeR": round(long_r, 2)}
    return None


def cleanup_for_sprite(box: tuple[int, int, int, int], hitbox: dict[str, Any], width: int, height: int) -> list[int]:
    """Cleanup rect follows the sprite box: x1.15, at least 2 r, always containing the hitbox disc,
    clipped to the scene (the intake 'fix2' rule). Returns [x0, y0, x1, y1]."""
    x, y, w, h = box
    r = float(hitbox.get("r", 57))
    hx, hy = float(hitbox["x"]), float(hitbox["y"])
    cx, cy = x + w / 2, y + h / 2
    pw, ph = max(w * 1.15, 2 * r), max(h * 1.15, 2 * r)
    if not (x <= hx <= x + w and y <= hy <= y + h):
        cx, cy = hx, hy
    x0 = min(max(0, cx - pw / 2), hx - r)
    y0 = min(max(0, cy - ph / 2), hy - r)
    x1 = max(min(width, cx + pw / 2), hx + r)
    y1 = max(min(height, cy + ph / 2), hy + r)
    return [int(max(0, x0)), int(max(0, y0)), int(min(width, x1)), int(min(height, y1))]


def ship_sprite(cutout: Image.Image, width: int, height: int) -> Image.Image:
    """Resize the cutout to its placed box (RGB under transparency filled from the nearest opaque
    pixel first so the resample never bleeds), cap at SHIP_MAX_PX, zero transparent RGB."""
    a = np.asarray(cutout.convert("RGBA")).copy()
    opaque = a[..., 3] == 255
    if opaque.any() and (~opaque).any():
        idx = ndi.distance_transform_edt(~opaque, return_distances=False, return_indices=True)
        a[..., :3] = a[..., :3][idx[0], idx[1]]
    out = Image.fromarray(a, "RGBA").resize((max(1, width), max(1, height)), Image.LANCZOS)
    if max(width, height) > SHIP_MAX_PX:
        scale = SHIP_MAX_PX / max(width, height)
        out = out.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS)
    b = np.asarray(out).copy()
    b[..., :3][b[..., 3] == 0] = 0
    return Image.fromarray(b, "RGBA")


def classify(tier: int | None, refit_status: str | None, pop: float | None, why: str = "") -> str:
    """keep | regenerate | missing. Refit-refused always regenerates; T3 with pop <= STRONG_POP stays;
    a judge that says the painted bird is not there is 'missing' (operator decision, never spend)."""
    if tier in (3, 4) and MISSING.search(why or ""):
        return "missing"
    refused = refit_status is not None and not refit_status.startswith("applied")
    if refused:
        return "regenerate"
    if tier == 4:
        return "regenerate"
    if tier == 3:
        return "keep" if (pop is not None and pop <= STRONG_POP) else "regenerate"
    return "keep"


# ── regeneration ──────────────────────────────────────────────────────────────────────────
def key_flat_render(flat: Image.Image) -> Image.Image:
    """Editor keying, in the lane's order: chroma key, strip the flat rim, edge-only despill,
    finalize (key-coloured gaps transparent, plumage holes restored, no key fringe), bbox crop."""
    from .flatkey import chroma_key, despill, finalize_cutout, strip_flat_rim

    cut = finalize_cutout(despill(strip_flat_rim(chroma_key(flat.convert("RGB")))))
    bbox = cut.getbbox()
    return cut.crop(bbox) if bbox else cut


def _clip_box(box: dict[str, Any], width: int, height: int) -> tuple[int, int, int, int]:
    x0 = max(0, int(box["x"]))
    y0 = max(0, int(box["y"]))
    x1 = min(width, int(box["x"] + box["width"]))
    y1 = min(height, int(box["y"] + box["height"]))
    return x0, y0, max(x0 + 1, x1), max(y0 + 1, y1)


def regen_crop_boxes(hitbox: dict[str, Any], vlm_detections: list[dict], extent: dict | None,
                     scene_size: tuple[int, int], *, max_crop_r: float) -> list[tuple[str, tuple[int, int, int, int]]]:
    """The Extract All square first; then the painted-extent-grown square when it is bigger, capped at
    max_crop_r x r (plate-diff extents can span the scene when the paint drifted)."""
    from .inpaint import _grow_box_by_extent, extract_box_for_hitbox

    b1 = extract_box_for_hitbox(hitbox, vlm_detections, 1.6)
    boxes = [("crop", _clip_box(b1, *scene_size))]
    if extent:
        b2 = _grow_box_by_extent(b1, extent)
        cap = float(max_crop_r) * float(hitbox.get("r", 57))
        if cap and b2["width"] > cap:
            cx, cy = b2["x"] + b2["width"] / 2, b2["y"] + b2["height"] / 2
            b2 = {**b2, "x": int(cx - cap / 2), "y": int(cy - cap / 2), "width": int(cap), "height": int(cap)}
        clipped = _clip_box(b2, *scene_size)
        if clipped != boxes[0][1]:
            boxes.append(("crop2", clipped))
    return boxes


def regenerate_sticker(color: Image.Image, clean: Image.Image, hitbox: dict[str, Any], *,
                       crop_boxes: list[tuple[str, tuple[int, int, int, int]]], prompt: str, model: str,
                       quality: str | None, edit: Callable[..., Image.Image], save_dir: Path | None = None) -> dict[str, Any]:
    """One paid render per crop; the cutout with the better masked match wins, ties (both perfect)
    broken by how much of the painted bird the sticker covers (a tight crop's tail-less sticker also
    matches perfectly); chunk gate last.
    Returns {runs, pick, cutout (PIL RGBA or None), box (scene coords), score, pop, coverage, chunk}."""
    import cv2

    runs: list[dict[str, Any]] = []
    cutouts: dict[str, Image.Image] = {}
    changed = np.abs(np.asarray(color.convert("RGB"), np.int16) - np.asarray(clean.convert("RGB"), np.int16)).sum(2) > 40
    r = float(hitbox.get("r", 57))
    hx, hy = int(hitbox["x"]), int(hitbox["y"])
    win = changed[max(0, hy - int(4 * r)):hy + int(4 * r), max(0, hx - int(4 * r)):hx + int(4 * r)]
    painted_px = max(1, int(win.sum()))

    def coverage(cut: Image.Image, box: tuple[int, int, int, int]) -> float:
        x, y, w, h = box
        alpha = cv2.resize(np.asarray(cut.convert("RGBA"))[..., 3], (max(1, w), max(1, h)), interpolation=cv2.INTER_AREA) > 128
        region = changed[y:y + h, x:x + w]
        if region.shape != alpha.shape:
            return 0.0
        return round(float((alpha & region).sum()) / painted_px, 3)
    for tag, cb in crop_boxes:
        crop = color.crop(cb)
        t0 = time.time()
        flat = edit(crop, prompt, model=model, quality=quality)
        seconds = round(time.time() - t0, 1)
        try:
            cut = key_flat_render(flat)
        except RuntimeError as exc:  # chroma key found nothing: the render is not a sticker
            runs.append({"pass": tag, "crop": list(cb), "seconds": seconds, "error": str(exc)[:120]})
            continue
        if save_dir is not None:
            save_dir.mkdir(parents=True, exist_ok=True)
            crop.save(save_dir / f"{tag}.png")
            flat.save(save_dir / f"{tag}_flat.png")
            cut.save(save_dir / f"{tag}_cutout.png")
        from .inpaint import fit_sprite_to_painted

        fit = fit_sprite_to_painted(cut, crop, clean.crop(cb), scales=LANE_SCALES)
        cov = coverage(cut, (cb[0] + fit["x"], cb[1] + fit["y"], fit["width"], fit["height"])) if fit else 0.0
        runs.append({"pass": tag, "crop": list(cb), "seconds": seconds, "fit": fit, "coverage": cov, "size": list(cut.size)})
        cutouts[tag] = cut
    ok = [run for run in runs if run.get("fit")]
    if not ok:
        return {"runs": runs, "pick": None, "cutout": None, "error": "no fit"}
    best = max(ok, key=lambda run: (round(run["fit"]["score"], 2), run["coverage"]))
    fit = best["fit"]
    cb = best["crop"]
    cut = cutouts[best["pass"]]
    box = (cb[0] + fit["x"], cb[1] + fit["y"], fit["width"], fit["height"])
    chunk = is_chunk_sticker(np.asarray(cut.convert("RGBA")), r)
    return {"runs": runs, "pick": best["pass"], "cutout": cut, "box": box, "score": fit["score"], "pop": fit["pop"],
            "coverage": best["coverage"], "chunk": chunk}


# ── the lane ──────────────────────────────────────────────────────────────────────────────
@dataclass
class LaneOptions:
    bird_ids: list[str] | None = None
    regenerate: bool = True
    model: str = DEFAULT_REGEN_MODEL
    quality: str | None = DEFAULT_REGEN_QUALITY
    max_crop_r: float = DEFAULT_MAX_CROP_R
    judge: str = DEFAULT_JUDGE
    judge_model: str = DEFAULT_JUDGE_MODEL
    whitegap: bool = True
    restore: bool = True            # commit the birdless restoration as the canonical restore asset at the end
    dry_run: bool = False           # judge + refit only; no spend on regeneration, no commits
    bless_actor: str | None = None  # e.g. human:batu-delegated:lane-2026-09-17 (operator option 2)
    workers: int = 6
    stamp: str = field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    generation_id: str | None = None
    artifact_dir: Path | None = None
    edit: Callable[..., Image.Image] | None = None   # test injection; default merceka edit_image
    vision: VisionJudge | None = None                # test injection


def _default_edit(image: Image.Image, prompt: str, *, model: str, quality: str | None) -> Image.Image:
    from merceka_core.image import edit_image

    return edit_image(image, prompt, model=model, quality=quality)


def _open_asset(store, descriptor: dict[str, Any], mode: str) -> Image.Image:
    from .canonical_assets import resolve_asset

    resolved = resolve_asset(store, descriptor)
    with Image.open(BytesIO(resolved.data)) as img:
        return img.convert(mode)


def _placement_box(bird: dict[str, Any]) -> tuple[int, int, int, int]:
    p = bird["sprite"]["placement"]
    return int(p["x"]), int(p["y"]), int(p["width"]), int(p["height"])


def _sprite_sidecar(session_id: str, bird: dict[str, Any]) -> Path | None:
    path = S.session_dir(session_id) / bird["sprite"]["asset"]["path"]
    return path.with_suffix(".json") if path.suffix.lower() == ".png" else None


def _annotate_sidecar(path: Path | None, record: dict[str, Any]) -> None:
    """Write the lane verdict next to the sprite so the candidate list can show it (no CAS change)."""
    if path is None:
        return
    try:
        data = json.loads(path.read_text()) if path.is_file() else {}
    except (OSError, json.JSONDecodeError):
        data = {}
    data["stickerLane"] = record
    tmp = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex[:8]}")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, path)


def _next_sprite_index(dog_dir: Path) -> int:
    indices = []
    for p in dog_dir.glob("sprite_*.png"):
        stem = p.stem.removeprefix("sprite_")
        if stem.isdigit():
            indices.append(int(stem))
    return max(indices, default=-1) + 1


def _commit_bird(session_id: str, bird: dict[str, Any], *, sprite: Image.Image | None, box: tuple[int, int, int, int],
                 anchor: tuple[float, float], scene_size: tuple[int, int], technique: str, lane_record: dict[str, Any],
                 crop_box: tuple[int, int, int, int], model: str, prompt: str, generation_id: str) -> dict[str, Any]:
    """Land new sprite bytes and/or a new placement through the canonical promotion path. When `sprite`
    is None only the placement changes and the existing asset bytes are re-pointed."""
    from .canonical_job_provenance import capture_bird_job_input
    from .inpaint import _atomic_save_image, _atomic_write_json

    sdir = S.session_dir(session_id)
    slot = bird["compatibilitySlot"]
    dog_index = int(slot.removeprefix("dog_"))
    dog_dir = sdir / "dogs" / slot
    dog_dir.mkdir(parents=True, exist_ok=True)
    if sprite is not None:
        index = _next_sprite_index(dog_dir)
        sprite_path = dog_dir / f"sprite_{index:03d}.png"
        _atomic_save_image(sprite, sprite_path)
    else:
        sprite_path = sdir / bird["sprite"]["asset"]["path"]
        stem = sprite_path.stem.removeprefix("sprite_")
        index = int(stem) if stem.isdigit() else 0
    x, y, w, h = box
    sprite_box = [int(x), int(y), int(x + w), int(y + h)]
    hitbox = bird["hitbox"]
    cleanup_box = cleanup_for_sprite((int(x), int(y), int(w), int(h)), hitbox, *scene_size)
    metadata = {
        "image": f"dogs/{slot}/{sprite_path.name}",
        "sourceBox": list(crop_box),
        "spriteBox": sprite_box,
        "cleanupBox": cleanup_box,
        "width": int(w), "height": int(h),
        "anchorX": round(anchor[0], 4), "anchorY": round(anchor[1], 4),
        "technique": technique,
        "quality": {"pickupUsable": True},
        "stickerLane": lane_record,
    }
    _atomic_write_json(metadata, sprite_path.with_suffix(".json"))
    current = S.read_canonical_session(session_id)
    captured = capture_bird_job_input(
        current.snapshot, bird_id=bird["birdId"], operation="sticker-lane",
        crop_box=tuple(int(v) for v in crop_box), model=model, prompt=prompt,
    )
    pointer, disposition = S.promote_canonical_sprite_artifact(
        session_id, captured_input=captured.to_dict(), generation_id=generation_id,
        sprite_path=sprite_path, metadata=metadata,
    )
    if pointer is not None:
        S.sync_sprite_metadata_to_levels(session_id, dog_index, index, metadata)
    return {"disposition": disposition, "contentRevision": pointer.content_revision if pointer else None,
            "file": metadata["image"], "spriteBox": sprite_box, "cleanupBox": cleanup_box}


def commit_birdless_restore(session_id: str, *, stamp: str, generation_id: str | None = None) -> dict[str, Any]:
    """Step 7: the canonical restore asset becomes the birdless restoration (painted scene minus each
    bird's own pixels) instead of the raw clean plate. A fresh canonical level otherwise ships the clean
    plate as bg_00 (found on the first end-to-end run, 2026-09-17): every pickup then reverted the
    whole cleanup rect, props included. Idempotent: an unchanged restoration commits nothing.
    A restore change invalidates the hitbox and final-cutout reviews (contract), so bless after this."""
    import hashlib

    from .canonical_bird_contract import CanonicalReadState, invalidate_reviews
    from .canonical_export import _level_json
    from .inpaint import _atomic_save_image

    current = S.read_canonical_session(session_id)
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None or current.pointer is None:
        raise ValueError(f"{session_id}: canonical session is {current.state.value}")
    store = S.canonical_session_store(session_id)
    snapshot = current.snapshot
    color = _open_asset(store, snapshot["assets"]["scene"], "RGB")
    clean = _open_asset(store, snapshot["assets"]["cleanBackground"], "RGB")
    level = _level_json(snapshot, *color.size)
    restored = S.birdless_restore_image(color, clean, level)
    sdir = S.session_dir(session_id)
    rel = f"bg_restore_{stamp}.png"
    tmp = sdir / f".{rel}.candidate-{uuid.uuid4().hex[:8]}.png"
    _atomic_save_image(restored, tmp)
    data = tmp.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    old = snapshot["restore"]["asset"]
    if old.get("sha256") == digest and snapshot["restore"].get("sourceSceneSha256") == snapshot["assets"]["scene"]["sha256"]:
        tmp.unlink(missing_ok=True)
        return {"changed": False, "sha256": digest, "path": old.get("path")}
    path = sdir / rel
    os.replace(tmp, path)
    updated = invalidate_reviews(snapshot, changed_artifacts={"restore"})
    updated["restore"] = {
        "asset": {"path": rel, "sha256": digest, "bytes": len(data)},
        "sourceSceneSha256": updated["assets"]["scene"]["sha256"],
    }
    pointer = store.commit(
        updated,
        expected_content_revision=current.pointer.content_revision,
        expected_operational_revision=current.pointer.operational_revision,
    )
    return {"changed": True, "sha256": digest, "path": rel, "contentRevision": pointer.content_revision,
            "generationId": generation_id}


def run_sticker_lane(session_id: str, opts: LaneOptions | None = None, *,
                     progress: Callable[[str, dict[str, Any]], None] | None = None) -> dict[str, Any]:
    """The lane on one canonical session. Returns and persists the summary (<session>/sticker-lane.json)."""
    from .canonical_bird_contract import CanonicalReadState
    from .flatkey import visible_part_prompt_template
    from .inpaint import _load_vlm_detections, painted_extent_detections

    opts = opts or LaneOptions()
    edit = opts.edit or _default_edit
    vision = opts.vision or VisionJudge.from_spec(opts.judge, model=opts.judge_model)
    generation_id = opts.generation_id or f"sticker-lane-{uuid.uuid4().hex[:12]}"
    sdir = S.session_dir(session_id)
    artifacts = opts.artifact_dir or (sdir / ".canonical" / "job-artifacts" / generation_id)
    panels_dir = artifacts / "panels"
    panels_dir.mkdir(parents=True, exist_ok=True)

    def emit(event: str, data: dict[str, Any]) -> None:
        if progress is not None:
            progress(event, data)

    current = S.read_canonical_session(session_id)
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None:
        raise ValueError(f"{session_id}: canonical session is {current.state.value}; the lane needs a valid snapshot")
    store = S.canonical_session_store(session_id)
    snapshot = current.snapshot
    color = _open_asset(store, snapshot["assets"]["scene"], "RGB")
    clean = _open_asset(store, snapshot["assets"]["cleanBackground"], "RGB")
    if clean.size != color.size:
        clean = clean.resize(color.size, Image.LANCZOS)
    scene_size = color.size
    raw = S.load_session_raw(session_id) or {}
    entity = str(raw.get("entity") or "bird")
    prompt = visible_part_prompt_template().replace("{entity}", entity)
    birds = [b for b in snapshot["birds"] if opts.bird_ids is None or b["birdId"] in opts.bird_ids]
    summary: dict[str, Any] = {
        "sessionId": session_id, "generationId": generation_id, "stamp": opts.stamp, "dryRun": opts.dry_run,
        "model": opts.model, "quality": opts.quality, "maxCropR": opts.max_crop_r, "judge": opts.judge,
        "birds": len(birds), "noSprite": [], "tiers": {}, "refit": {}, "classes": {},
        "regenerated": {}, "stillRefused": [], "missing": [], "errors": [], "whitegap": {}, "committed": {},
    }
    with_sprite = [b for b in birds if isinstance(b.get("sprite"), dict) and isinstance(b["sprite"].get("asset"), dict)]
    summary["noSprite"] = [b["birdId"] for b in birds if b not in with_sprite]

    # ── 1. tier judge + 2. refit (parallel per bird, all free except the judge) ──────────
    def judge_and_refit(bird: dict[str, Any], tag: str) -> dict[str, Any]:
        bid = bird["birdId"]
        try:
            sprite = _open_asset(store, bird["sprite"]["asset"], "RGBA")
        except Exception as exc:  # noqa: BLE001
            return {"birdId": bid, "error": f"sprite asset: {type(exc).__name__}: {str(exc)[:100]}"}
        x, y, w, h = _placement_box(bird)
        spr = sprite.resize((max(1, w), max(1, h)), Image.LANCZOS)
        e = int(max(w, h) * 0.5)
        pb = (max(0, x - e), max(0, y - e), min(color.width, x + w + e), min(color.height, y + h + e))
        panel = tier_panel(color.crop(pb), spr, (int(round(x - pb[0])), int(round(y - pb[1]))))
        panel_path = panels_dir / f"{bird['compatibilitySlot']}_{tag}.png"
        panel.save(panel_path)
        verdict = vision.ask(panel_path, TIER_PROMPT, parse_tier_json)
        pad = int(max(w, h) * 0.8)
        cb = (max(0, x - pad), max(0, y - pad), min(color.width, x + w + pad), min(color.height, y + h + pad))
        scenery = is_scenery_sticker(np.asarray(spr)[..., 3], (x, y, w, h), bird["hitbox"])
        fit = fit_aniso(spr, color.crop(cb), clean.crop(cb))
        if scenery is not None:
            status, fields = f"refused: scenery (far {scenery['farFraction']}, long {scenery['longEdgeR']} r)", None
        elif fit is None:
            status, fields = "refused: no fit", None
        else:
            status, fields = refit_gate(fit, bird["hitbox"], (x, y, w, h), (cb[0], cb[1]))
        return {"birdId": bid, "tier": verdict.get("tier"), "why": verdict.get("why", verdict.get("error", "")),
                "judgeBackend": verdict.get("backend"), "refitStatus": status, "refitFields": fields, "scenery": scenery,
                "pop": fit["pop"] if fit else None, "cropBox": cb, "sprite": sprite}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, opts.workers)) as pool:
        first = list(pool.map(lambda b: judge_and_refit(b, "pass1"), with_sprite))
    by_id = {b["birdId"]: b for b in with_sprite}
    to_regenerate: list[str] = []
    for rec in first:
        bid = rec["birdId"]
        if rec.get("error"):
            summary["errors"].append({"birdId": bid, "error": rec["error"]})
            continue
        summary["tiers"][bid] = {"tier": rec["tier"], "why": rec["why"], "backend": rec["judgeBackend"]}
        summary["refit"][bid] = rec["refitStatus"]
        cls = classify(rec["tier"], rec["refitStatus"], rec["pop"], rec["why"])
        summary["classes"][bid] = cls
        emit("bird_judged", {"birdId": bid, "tier": rec["tier"], "refit": rec["refitStatus"], "class": cls})
        if cls == "missing":
            summary["missing"].append(bid)
        elif cls == "regenerate":
            to_regenerate.append(bid)
    if not opts.regenerate:
        summary["stillRefused"] = list(to_regenerate)
        to_regenerate = []

    # ── 3. regenerate the regenerate class ───────────────────────────────────────────────
    vlm = _load_vlm_detections(session_id)
    extents_by_id: dict[str, dict] = {}
    if to_regenerate and not opts.dry_run:
        hbs = [dict(by_id[bid]["hitbox"], id=bid) for bid in to_regenerate]
        found = painted_extent_detections(session_id, hbs)
        # painted_extent_detections returns one box per hitbox it could size, in order, skipping misses:
        # re-associate by the search window (the extent centre may sit more than r from the hitbox).
        for ext in found:
            cx, cy = ext["x"] + ext["width"] / 2, ext["y"] + ext["height"] / 2
            best = min(hbs, key=lambda hb: (hb["x"] - cx) ** 2 + (hb["y"] - cy) ** 2)
            if ((best["x"] - cx) ** 2 + (best["y"] - cy) ** 2) ** 0.5 <= 4.0 * float(best.get("r", 57)):
                extents_by_id.setdefault(best["id"], ext)

    def regenerate_one(bid: str) -> dict[str, Any]:
        bird = by_id[bid]
        hb = bird["hitbox"]
        try:
            boxes = regen_crop_boxes(hb, vlm, extents_by_id.get(bid), scene_size, max_crop_r=opts.max_crop_r)
            result = regenerate_sticker(color, clean, hb, crop_boxes=boxes, prompt=prompt, model=opts.model,
                                        quality=opts.quality, edit=edit,
                                        save_dir=artifacts / "regen" / bird["compatibilitySlot"])
        except Exception as exc:  # noqa: BLE001 — one bird's provider failure never stops the level
            return {"birdId": bid, "error": f"{type(exc).__name__}: {str(exc)[:160]}"}
        return {"birdId": bid, **result}

    regenerated: dict[str, dict[str, Any]] = {}
    if to_regenerate and not opts.dry_run:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, opts.workers)) as pool:
            results = list(pool.map(regenerate_one, to_regenerate))
        for res in results:
            bid = res["birdId"]
            if res.get("error"):
                summary["errors"].append({"birdId": bid, "error": res["error"]})
                summary["stillRefused"].append(bid)
                continue
            if res.get("chunk"):
                summary["errors"].append({"birdId": bid, "error": "chunk sticker (filled box wider than 2.2 r)"})
                summary["stillRefused"].append(bid)
                continue
            regenerated[bid] = res
            emit("bird_regenerated", {"birdId": bid, "pick": res["pick"], "score": res["score"], "pop": res["pop"]})
    elif to_regenerate and opts.dry_run:
        summary["stillRefused"] = list(to_regenerate)

    # ── 4. second pass on the regenerated stickers: refit + judge ────────────────────────
    second: dict[str, dict[str, Any]] = {}
    if regenerated:
        def second_pass(bid: str) -> dict[str, Any]:
            bird = by_id[bid]
            res = regenerated[bid]
            x, y, w, h = res["box"]
            spr = res["cutout"].resize((max(1, w), max(1, h)), Image.LANCZOS)
            e = int(max(w, h) * 0.5)
            pb = (max(0, x - e), max(0, y - e), min(color.width, x + w + e), min(color.height, y + h + e))
            panel = tier_panel(color.crop(pb), spr, (int(round(x - pb[0])), int(round(y - pb[1]))))
            panel_path = panels_dir / f"{bird['compatibilitySlot']}_pass2.png"
            panel.save(panel_path)
            verdict = vision.ask(panel_path, TIER_PROMPT, parse_tier_json)
            hb = bird["hitbox"]
            ax, ay = (hb["x"] - x) / w, (hb["y"] - y) / h
            inside = 0 <= ax <= 1 and 0 <= ay <= 1
            scenery = is_scenery_sticker(np.asarray(spr)[..., 3], (x, y, w, h), hb)
            if scenery is not None:
                status = f"refused: scenery (far {scenery['farFraction']}, long {scenery['longEdgeR']} r)"
            else:
                status = "applied" if (res["pop"] <= POP_MAX and inside) else ("refused: hitbox outside" if not inside else f"refused: pop {res['pop']:.0f}")
            return {"birdId": bid, "tier": verdict.get("tier"), "why": verdict.get("why", verdict.get("error", "")),
                    "backend": verdict.get("backend"), "status": status, "anchor": (ax, ay)}

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, opts.workers)) as pool:
            for rec in pool.map(second_pass, list(regenerated)):
                second[rec["birdId"]] = rec
        for bid, rec in second.items():
            res = regenerated[bid]
            cls = classify(rec["tier"], rec["status"], res["pop"], rec["why"])
            summary["regenerated"][bid] = {"pick": res["pick"], "score": res["score"], "pop": res["pop"], "coverage": res.get("coverage"),
                                            "tier": rec["tier"], "why": rec["why"], "refit": rec["status"], "class": cls,
                                            "runs": [{k: v for k, v in r.items() if k != "fit"} | ({"fit": r["fit"]} if r.get("fit") else {}) for r in res["runs"]]}
            if cls != "keep":
                summary["stillRefused"].append(bid)

    # ── 5. white gaps (kept stickers and accepted regenerations) ─────────────────────────
    gap_punched: dict[str, np.ndarray] = {}
    if opts.whitegap:
        gap_dir = panels_dir / "gaps"
        gap_dir.mkdir(exist_ok=True)
        gap_items: list[tuple[str, int, dict[str, Any], np.ndarray]] = []
        for rec in first:
            bid = rec["birdId"]
            if rec.get("error") or summary["classes"].get(bid) != "keep":
                continue
            rgba = np.asarray(rec["sprite"].convert("RGBA"))
            for gi, gap in enumerate(find_gaps(rgba)):
                gap_items.append((bid, gi, gap, rgba))
        for bid, res in regenerated.items():
            if summary["regenerated"].get(bid, {}).get("class") != "keep":
                continue
            rgba = np.asarray(res["cutout"].convert("RGBA"))
            for gi, gap in enumerate(find_gaps(rgba)):
                gap_items.append((bid, gi, gap, rgba))

        def judge_gap(item):
            bid, gi, gap, rgba = item
            path = gap_dir / f"{by_id[bid]['compatibilitySlot']}_{gi}.png"
            gap_panel(rgba, gap).save(path)
            return bid, gi, gap, vision.ask(path, GAP_PROMPT, parse_gap_json)

        confirmed: dict[str, list[dict[str, Any]]] = {}
        if gap_items:
            with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, opts.workers)) as pool:
                for bid, gi, gap, verdict in pool.map(judge_gap, gap_items):
                    summary["whitegap"].setdefault(bid, []).append({"index": gi, "size": gap["size"], "bbox": list(gap["bbox"]),
                                                                    "gap": verdict.get("gap"), "why": verdict.get("why", verdict.get("error", ""))})
                    if verdict.get("gap") is True:
                        confirmed.setdefault(bid, []).append(gap)
        for bid, gaps in confirmed.items():
            rgba = np.asarray((regenerated[bid]["cutout"] if bid in regenerated else next(r["sprite"] for r in first if r["birdId"] == bid)).convert("RGBA"))
            punched, px = punch_gaps(rgba, gaps)
            gap_punched[bid] = punched
            summary["whitegap"][bid].append({"punchedPx": px})

    # ── 6. commit through the canonical promotion path ──────────────────────────────────
    if not opts.dry_run:
        for rec in first:
            bid = rec["birdId"]
            if rec.get("error"):
                continue
            bird = by_id[bid]
            lane_record = {"stamp": opts.stamp, "tier": rec["tier"], "why": rec["why"], "refit": rec["refitStatus"],
                           "class": summary["classes"].get(bid), "generationId": generation_id}
            x, y, w, h = _placement_box(bird)
            if bid in regenerated and summary["regenerated"][bid]["class"] == "keep":
                res = regenerated[bid]
                rx, ry, rw, rh = res["box"]
                cut = Image.fromarray(gap_punched[bid], "RGBA") if bid in gap_punched else res["cutout"]
                shipped = ship_sprite(cut, rw, rh)
                record = {**lane_record, "regen": {"pick": res["pick"], "score": res["score"], "pop": res["pop"],
                                                   "tier": second[bid]["tier"], "why": second[bid]["why"]},
                          "whitegapPx": next((g["punchedPx"] for g in summary["whitegap"].get(bid, []) if "punchedPx" in g), 0)}
                crop_box = next(r["crop"] for r in res["runs"] if r.get("pass") == res["pick"])
                try:
                    summary["committed"][bid] = _commit_bird(
                        session_id, bird, sprite=shipped, box=(rx, ry, rw, rh), anchor=second[bid]["anchor"],
                        scene_size=scene_size, technique=TECHNIQUE, lane_record=record, crop_box=tuple(crop_box),
                        model=opts.model, prompt=prompt, generation_id=generation_id)
                except Exception as exc:  # noqa: BLE001
                    summary["errors"].append({"birdId": bid, "error": f"commit: {type(exc).__name__}: {str(exc)[:160]}"})
                continue
            fields = rec["refitFields"] if rec["refitStatus"] == "applied" else None
            new_sprite = None
            if bid in gap_punched:
                bw, bh = (fields["width"], fields["height"]) if fields else (w, h)
                new_sprite = ship_sprite(Image.fromarray(gap_punched[bid], "RGBA"), bw, bh)
            moved = fields is not None and (fields["x"], fields["y"], fields["width"], fields["height"]) != (x, y, w, h)
            if new_sprite is None and not moved:
                _annotate_sidecar(_sprite_sidecar(session_id, bird), lane_record)
                continue
            box = (fields["x"], fields["y"], fields["width"], fields["height"]) if fields else (x, y, w, h)
            anchor = (fields["anchorX"], fields["anchorY"]) if fields else (bird["sprite"]["anchorX"], bird["sprite"]["anchorY"])
            record = {**lane_record, "refitFields": (fields or {}).get("refit"),
                      "whitegapPx": next((g["punchedPx"] for g in summary["whitegap"].get(bid, []) if "punchedPx" in g), 0)}
            technique = f"{TECHNIQUE}+whitegap" if new_sprite is not None else f"{TECHNIQUE}+refit"
            try:
                summary["committed"][bid] = _commit_bird(
                    session_id, bird, sprite=new_sprite, box=box, anchor=anchor, scene_size=scene_size,
                    technique=technique, lane_record=record, crop_box=rec["cropBox"], model=opts.model,
                    prompt=prompt, generation_id=generation_id)
            except Exception as exc:  # noqa: BLE001
                summary["errors"].append({"birdId": bid, "error": f"commit: {type(exc).__name__}: {str(exc)[:160]}"})
        if opts.restore:
            try:
                summary["restore"] = commit_birdless_restore(session_id, stamp=opts.stamp, generation_id=generation_id)
            except Exception as exc:  # noqa: BLE001
                summary["errors"].append({"birdId": None, "error": f"restore: {type(exc).__name__}: {str(exc)[:160]}"})
        if opts.bless_actor and not summary["stillRefused"] and not summary["missing"] and not summary["errors"]:
            cur = S.read_canonical_session(session_id)
            if cur.pointer is not None:
                S.set_canonical_final_review_if_present(session_id, True, expected_content_revision=cur.pointer.content_revision,
                                                        reviewer=opts.bless_actor)
                summary["blessedBy"] = opts.bless_actor

    cur = S.read_canonical_session(session_id)
    summary["contentRevision"] = cur.pointer.content_revision if cur.pointer else None
    summary["stillRefused"] = sorted(set(summary["stillRefused"]))
    summary["panels"] = str(panels_dir)
    tmp = sdir / f".{SUMMARY_FILE}.tmp-{uuid.uuid4().hex[:8]}"
    tmp.write_text(json.dumps(summary, indent=1, default=str))
    os.replace(tmp, sdir / SUMMARY_FILE)
    emit("lane_done", {"committed": len(summary["committed"]), "stillRefused": len(summary["stillRefused"]),
                       "missing": len(summary["missing"]), "errors": len(summary["errors"])})
    return summary


def latest_summary(session_id: str) -> dict[str, Any] | None:
    path = S.session_dir(session_id) / SUMMARY_FILE
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


# ── durable job ───────────────────────────────────────────────────────────────────────────
def options_from_metadata(metadata: dict[str, Any]) -> LaneOptions:
    return LaneOptions(
        bird_ids=list(metadata["birdIds"]) if metadata.get("birdIds") else None,
        regenerate=bool(metadata.get("regenerate", True)),
        model=str(metadata.get("model") or DEFAULT_REGEN_MODEL),
        quality=metadata.get("quality", DEFAULT_REGEN_QUALITY) or None,
        max_crop_r=float(metadata.get("maxCropR") or DEFAULT_MAX_CROP_R),
        judge=str(metadata.get("judge") or DEFAULT_JUDGE),
        judge_model=str(metadata.get("judgeModel") or DEFAULT_JUDGE_MODEL),
        whitegap=bool(metadata.get("whitegap", True)),
        restore=bool(metadata.get("restore", True)),
        dry_run=bool(metadata.get("dryRun", False)),
        bless_actor=metadata.get("blessActor") or None,
    )


def run_sticker_lane_job(job, store) -> dict[str, Any]:
    """Job handler: reads its inputs from the job metadata; every provider dollar lands in the
    merceka ledger tagged with the session and job (measured, never estimated)."""
    from merceka_core import costs as _mcosts

    opts = options_from_metadata(job.metadata or {})
    opts.generation_id = f"sticker-lane-{job.id[:12]}"
    if store is not None:
        store.update_metadata(job.id, {"safeToRequeue": False, "providerSubmissionStarted": True})

    def progress(event: str, data: dict[str, Any]) -> None:
        if store is not None:
            store.append_event(job.id, event, data=data)

    with _mcosts.attribution({"app": "ftb-level-editor", "sessionId": job.session_id, "operation": "sticker_lane", "jobId": job.id}):
        summary = run_sticker_lane(job.session_id, opts, progress=progress)
    return {k: v for k, v in summary.items() if k != "panels"} | {"panels": summary["panels"]}


def register_job_handlers(worker) -> None:
    worker.register_handler(JOB_KIND, run_sticker_lane_job)
