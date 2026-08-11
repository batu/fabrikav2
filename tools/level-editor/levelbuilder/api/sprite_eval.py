"""Deterministic sprite-quality evaluation (axes: exclusion, scene coherence).

Scores pickup sprites against the clean background and the composited scene.
Semantic axes (subject correctness, completeness) live in sprite_judge.py;
this module is pure image math and must stay tool-shaped: score and return.

Axis definitions (plan 2026-07-31-002):
- exclusion: the sprite must not contain unchanged background. Measured as the
  alpha-weighted fraction of sprite pixels sitting where scene ~= clean.
  Also reports satellite components (specks disconnected from the main body).
- coherence: picking up the sprite must not visibly change anything besides
  the sprite. Measured as painted-but-not-in-sprite area (pop-in) inside the
  evaluated crop, relative to sprite area.

Exported levels re-encode/grade the scene globally, so scene vs clean is never
pixel-identical even where nothing was painted. Every level therefore gets a
noise floor measured outside all cleanup boxes, and "changed" means exceeding
a multiple of that floor.
"""

from __future__ import annotations

import json
import math
import copy
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

SCHEMA_VERSION = 1

# Alpha above this counts as sprite-visible; matches inpaint.py's visible bar.
ALPHA_VISIBLE = 8
# "Changed vs clean" threshold: max(absolute floor, NOISE_MULT * level floor),
# in summed-RGB units (0..765).
CHANGE_ABS_FLOOR = 30.0
NOISE_MULT = 4.0
# Verdict thresholds.
EXCLUSION_WARN, EXCLUSION_FAIL = 0.15, 0.35
POP_WARN, POP_FAIL = 0.20, 0.60
SPECK_MIN_AREA = 8
ALIGNMENT_OUTLIER_SCORE = 0.55
ALIGNMENT_ABSOLUTE_FLOOR = 0.25
DEFAULT_MATCH_METHODS = ("color", "hybrid", "features", "orb", "chamfer", "best")
MANUAL_MATCH_METHOD = "manual"


@dataclass(frozen=True)
class BirdInputs:
    """One bird's evaluation inputs. clean/scene crops may be None (reduced mode)."""

    dog_id: str
    sprite: Image.Image  # RGBA
    sprite_box: tuple[int, int, int, int]  # x0, y0, x1, y1 in level coords
    crop_box: tuple[int, int, int, int]  # evaluated region (sourceBox or padded cleanup)
    clean_crop: np.ndarray | None  # HxWx3 int16, crop_box region of clean bg
    scene_crop: np.ndarray | None  # HxWx3 int16, crop_box region of composited scene
    noise_floor: float = 0.0
    # Level-coord sprite boxes of OTHER birds; their painted content inside
    # this crop is legitimate scene, not pop-in (dense levels false-positived
    # coherence 0.0 when neighbors sat inside the evaluated crop).
    neighbor_boxes: tuple[tuple[int, int, int, int], ...] = ()
    # Human-authored pickup point in level coordinates. Hybrid fitting treats
    # containment as a hard constraint rather than discovering unsafe fits
    # after the fact.
    target_point: tuple[int, int] | None = None


def _verdict(score: float, warn: float, fail: float) -> str:
    # warn/fail are defect-fraction thresholds; score = 1 - defect fraction.
    defect = 1.0 - score
    if defect > fail:
        return "fail"
    if defect > warn:
        return "warn"
    return "pass"


def _alpha_in_crop(inputs: BirdInputs) -> tuple[np.ndarray, np.ndarray | None]:
    """Sprite alpha (float 0..1) and RGB placed on the crop_box canvas."""
    cx0, cy0, cx1, cy1 = inputs.crop_box
    canvas = np.zeros((cy1 - cy0, cx1 - cx0), dtype=np.float32)
    rgb_canvas = np.zeros((cy1 - cy0, cx1 - cx0, 3), dtype=np.int16)
    sx0, sy0, sx1, sy1 = inputs.sprite_box
    box_width, box_height = sx1 - sx0, sy1 - sy0
    sprite = inputs.sprite.convert("RGBA")
    if sprite.size != (box_width, box_height):
        sprite = sprite.resize((box_width, box_height), Image.Resampling.LANCZOS)
    rgba = np.asarray(sprite, dtype=np.float32)
    alpha = rgba[:, :, 3] / 255.0
    # Intersect sprite box with crop box.
    ix0, iy0 = max(sx0, cx0), max(sy0, cy0)
    ix1, iy1 = min(sx1, cx1), min(sy1, cy1)
    if ix1 <= ix0 or iy1 <= iy0:
        return canvas, rgb_canvas
    canvas[iy0 - cy0:iy1 - cy0, ix0 - cx0:ix1 - cx0] = alpha[
        iy0 - sy0:iy1 - sy0, ix0 - sx0:ix1 - sx0
    ]
    rgb_canvas[iy0 - cy0:iy1 - cy0, ix0 - cx0:ix1 - cx0] = rgba[
        iy0 - sy0:iy1 - sy0, ix0 - sx0:ix1 - sx0, :3
    ].astype(np.int16)
    return canvas, rgb_canvas


def _connected_components(mask: np.ndarray) -> list[np.ndarray]:
    """4/8-connected components via BFS; returns boolean masks, largest first."""
    visited = np.zeros(mask.shape, dtype=bool)
    height, width = mask.shape
    components: list[np.ndarray] = []
    for sy, sx in np.argwhere(mask & ~visited):
        if visited[sy, sx]:
            continue
        stack = [(int(sy), int(sx))]
        visited[sy, sx] = True
        comp = np.zeros(mask.shape, dtype=bool)
        while stack:
            y, x = stack.pop()
            comp[y, x] = True
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
        components.append(comp)
    components.sort(key=lambda c: int(c.sum()), reverse=True)
    return components


def _changed_mask(inputs: BirdInputs) -> np.ndarray:
    diff = np.abs(inputs.scene_crop.astype(np.int16) - inputs.clean_crop.astype(np.int16)).sum(axis=2).astype(np.float32)
    threshold = max(CHANGE_ABS_FLOOR, NOISE_MULT * inputs.noise_floor)
    return diff > threshold


def fit_silhouette(
    inputs: BirdInputs,
    *,
    max_shift: int = 32,
    scales: tuple[float, ...] = tuple(round(0.75 + index * 0.05, 2) for index in range(11)),
    outlier_score: float = ALIGNMENT_OUTLIER_SCORE,
) -> dict:
    """Find the best read-only translation/uniform-scale fit to painted pixels."""
    if inputs.clean_crop is None or inputs.scene_crop is None:
        return {"score": None, "verdict": "unscored", "outlier": False, "evidence": "aligned clean/scene pair required"}

    target = _alignment_target(inputs, max_shift=max_shift, scales=scales)
    cx0, cy0, _, _ = inputs.crop_box
    rgba = np.asarray(inputs.sprite.convert("RGBA"))
    source_mask = (rgba[:, :, 3] > ALPHA_VISIBLE).astype(np.uint8)
    sx0, sy0, sx1, sy1 = inputs.sprite_box
    base_w, base_h = sx1 - sx0, sy1 - sy0
    origin_x, origin_y = sx0 - cx0, sy0 - cy0
    target_area = float(target.sum())
    best: tuple[float, float, int, int, int, int] | None = None

    for scale in scales:
        width = max(1, round(base_w * scale))
        height = max(1, round(base_h * scale))
        if width > target.shape[1] or height > target.shape[0]:
            continue
        mask = cv2.resize(source_mask, (width, height), interpolation=cv2.INTER_NEAREST)
        sprite_area = float(mask.sum())
        if sprite_area == 0:
            continue
        intersections = cv2.matchTemplate(target, mask, cv2.TM_CCORR)
        x_min, x_max = max(0, origin_x - max_shift), min(intersections.shape[1] - 1, origin_x + max_shift)
        y_min, y_max = max(0, origin_y - max_shift), min(intersections.shape[0] - 1, origin_y + max_shift)
        if x_min > x_max or y_min > y_max:
            continue
        window = intersections[y_min:y_max + 1, x_min:x_max + 1]
        wy, wx = np.unravel_index(int(np.argmax(window)), window.shape)
        x, y = x_min + int(wx), y_min + int(wy)
        intersection = float(window[wy, wx])
        union = target_area + sprite_area - intersection
        score = intersection / union if union else 0.0
        candidate = (score, scale, x, y, width, height)
        if best is None or candidate > best:
            best = candidate

    if best is None:
        return {"score": 0.0, "verdict": "fail", "outlier": True, "evidence": "empty or unplaceable sprite"}
    score, scale, x, y, width, height = best
    fitted_box = [cx0 + x, cy0 + y, cx0 + x + width, cy0 + y + height]
    return {
        "score": round(score, 4), "verdict": "fail" if score < outlier_score else "pass",
        "outlier": score < outlier_score, "scale": scale,
        "dx": fitted_box[0] - sx0, "dy": fitted_box[1] - sy0,
        "originalBox": list(inputs.sprite_box), "fittedBox": fitted_box,
    }


def fit_color(
    inputs: BirdInputs,
    *,
    max_shift: int = 32,
    scales: tuple[float, ...] = tuple(round(0.75 + index * 0.05, 2) for index in range(11)),
) -> dict:
    """Fit sprite RGB to the painted scene under its alpha mask.

    This is intentionally independent of silhouette IoU: it can distinguish
    two similarly shaped birds by their internal colors and markings.
    """
    if inputs.scene_crop is None:
        return {"score": None, "verdict": "unscored", "evidence": "painted scene required"}

    cx0, cy0, _, _ = inputs.crop_box
    rgba = np.asarray(inputs.sprite.convert("RGBA"), dtype=np.uint8)
    source_rgb = rgba[:, :, :3]
    source_alpha = rgba[:, :, 3]
    scene = np.clip(inputs.scene_crop, 0, 255).astype(np.uint8)
    sx0, sy0, sx1, sy1 = inputs.sprite_box
    base_w, base_h = sx1 - sx0, sy1 - sy0
    origin_x, origin_y = sx0 - cx0, sy0 - cy0
    best: tuple[float, float, int, int, int, int] | None = None

    for scale in scales:
        width = max(1, round(base_w * scale))
        height = max(1, round(base_h * scale))
        if width > scene.shape[1] or height > scene.shape[0]:
            continue
        rgb = cv2.resize(source_rgb, (width, height), interpolation=cv2.INTER_AREA)
        alpha = cv2.resize(source_alpha, (width, height), interpolation=cv2.INTER_AREA)
        mask = np.repeat((alpha > ALPHA_VISIBLE)[:, :, None], 3, axis=2).astype(np.uint8) * 255
        if not mask.any():
            continue
        errors = cv2.matchTemplate(scene, rgb, cv2.TM_SQDIFF_NORMED, mask=mask)
        errors = np.nan_to_num(errors, nan=1.0, posinf=1.0, neginf=1.0)
        x_min, x_max = max(0, origin_x - max_shift), min(errors.shape[1] - 1, origin_x + max_shift)
        y_min, y_max = max(0, origin_y - max_shift), min(errors.shape[0] - 1, origin_y + max_shift)
        if x_min > x_max or y_min > y_max:
            continue
        window = errors[y_min:y_max + 1, x_min:x_max + 1]
        wy, wx = np.unravel_index(int(np.argmin(window)), window.shape)
        error = float(window[wy, wx])
        score = max(0.0, 1.0 - min(error, 1.0))
        candidate = (score, scale, x_min + int(wx), y_min + int(wy), width, height)
        if best is None or candidate > best:
            best = candidate

    if best is None:
        return {"score": 0.0, "verdict": "fail", "evidence": "empty or unplaceable sprite"}
    score, scale, x, y, width, height = best
    fitted_box = [cx0 + x, cy0 + y, cx0 + x + width, cy0 + y + height]
    return {
        "score": round(score, 4), "verdict": "pass", "scale": scale,
        "dx": fitted_box[0] - sx0, "dy": fitted_box[1] - sy0,
        "originalBox": list(inputs.sprite_box), "fittedBox": fitted_box,
    }


def fit_color_xy(
    inputs: BirdInputs,
    *,
    max_shift: int = 32,
    scales: tuple[float, ...] = tuple(round(0.75 + index * 0.05, 2) for index in range(11)),
    max_aspect_distortion: float | None = 0.12,
    candidate_caps: tuple[float | None, ...] | None = None,
) -> dict:
    """Fit color with bounded independent X/Y scale and free translation."""
    if inputs.scene_crop is None:
        unscored = {"score": None, "verdict": "unscored", "evidence": "painted scene required"}
        if candidate_caps is not None:
            return {"candidates": [dict(unscored) for _ in candidate_caps]}
        return unscored

    cx0, cy0, _, _ = inputs.crop_box
    rgba = np.asarray(inputs.sprite.convert("RGBA"), dtype=np.uint8)
    source_rgb, source_alpha = rgba[:, :, :3], rgba[:, :, 3]
    scene = np.clip(inputs.scene_crop, 0, 255).astype(np.uint8)
    sx0, sy0, sx1, sy1 = inputs.sprite_box
    base_w, base_h = sx1 - sx0, sy1 - sy0
    origin_x, origin_y = sx0 - cx0, sy0 - cy0
    caps = candidate_caps or (max_aspect_distortion,)
    best_by_cap: list[tuple[float, float, float, float, float, int, int, int, int] | None] = [
        None for _ in caps
    ]

    for scale_x in scales:
        for scale_y in scales:
            distortion = max(scale_x, scale_y) / min(scale_x, scale_y) - 1.0
            width, height = max(1, round(base_w * scale_x)), max(1, round(base_h * scale_y))
            if width > scene.shape[1] or height > scene.shape[0]:
                continue
            rgb = cv2.resize(source_rgb, (width, height), interpolation=cv2.INTER_AREA)
            alpha = cv2.resize(source_alpha, (width, height), interpolation=cv2.INTER_AREA)
            mask = np.repeat((alpha > ALPHA_VISIBLE)[:, :, None], 3, axis=2).astype(np.uint8) * 255
            if not mask.any():
                continue
            x_min = max(0, origin_x - max_shift)
            x_max = min(scene.shape[1] - width, origin_x + max_shift)
            y_min = max(0, origin_y - max_shift)
            y_max = min(scene.shape[0] - height, origin_y + max_shift)
            if x_min > x_max or y_min > y_max:
                continue
            search = scene[y_min:y_max + height, x_min:x_max + width]
            window = cv2.matchTemplate(search, rgb, cv2.TM_SQDIFF_NORMED, mask=mask)
            window = np.nan_to_num(window, nan=1.0, posinf=1.0, neginf=1.0)
            wy, wx = np.unravel_index(int(np.argmin(window)), window.shape)
            score = max(0.0, 1.0 - min(float(window[wy, wx]), 1.0))
            scale_deviation = abs(scale_x - 1.0) + abs(scale_y - 1.0)
            candidate = (
                score, -distortion, -scale_deviation, scale_x, scale_y,
                x_min + int(wx), y_min + int(wy), width, height,
            )
            for index, cap in enumerate(caps):
                if cap is not None and distortion > cap + 1e-9:
                    continue
                if best_by_cap[index] is None or candidate > best_by_cap[index]:
                    best_by_cap[index] = candidate

    def result(best):
        if best is None:
            return {"score": 0.0, "verdict": "fail", "evidence": "empty or unplaceable sprite"}
        score, neg_distortion, _, scale_x, scale_y, x, y, width, height = best
        fitted_box = [cx0 + x, cy0 + y, cx0 + x + width, cy0 + y + height]
        return {
            "score": round(score, 4), "verdict": "pass",
            "scaleX": scale_x, "scaleY": scale_y,
            "aspectDistortion": round(-neg_distortion, 4),
            "dx": fitted_box[0] - sx0, "dy": fitted_box[1] - sy0,
            "originalBox": list(inputs.sprite_box), "fittedBox": fitted_box,
        }

    results = [result(best) for best in best_by_cap]
    return {"candidates": results} if candidate_caps is not None else results[0]


def fit_hybrid(
    inputs: BirdInputs,
    *,
    max_shift: int = 96,
    scales: tuple[float, ...] = (0.9, 0.95, 1.0, 1.05, 1.1),
    weights: tuple[float, float, float, float] = (0.45, 0.35, 0.15, 0.05),
) -> dict:
    """Fit with color, silhouette, boundary, scale, and hitbox constraints."""
    if inputs.clean_crop is None or inputs.scene_crop is None:
        return {"score": None, "verdict": "unscored", "evidence": "aligned clean/scene pair required"}

    weight_total = sum(weights)
    if weight_total <= 0 or any(weight < 0 for weight in weights):
        raise ValueError("hybrid weights must be non-negative with a positive sum")
    color_weight, silhouette_weight, edge_weight, scale_weight = (
        weight / weight_total for weight in weights
    )
    cx0, cy0, _, _ = inputs.crop_box
    scene = np.clip(inputs.scene_crop, 0, 255).astype(np.uint8)
    target = _alignment_target(inputs, max_shift=max_shift, scales=scales).astype(np.uint8)
    target_area = float(target.sum())
    target_edge = cv2.morphologyEx(target, cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8))
    target_edge_area = float(target_edge.sum())
    rgba = np.asarray(inputs.sprite.convert("RGBA"), dtype=np.uint8)
    source_rgb, source_alpha = rgba[:, :, :3], rgba[:, :, 3]
    sx0, sy0, sx1, sy1 = inputs.sprite_box
    # Scale around the cutout's native generated dimensions, not around the
    # currently stored silhouette fit. Otherwise an already oversized fit
    # becomes the new 1.0 prior and cannot recover (toymaker dog_01).
    base_w, base_h = inputs.sprite.size
    origin_x, origin_y = sx0 - cx0, sy0 - cy0
    best: tuple[float, float, int, int, int, int, dict[str, float]] | None = None

    for scale in scales:
        width, height = max(1, round(base_w * scale)), max(1, round(base_h * scale))
        if width > scene.shape[1] or height > scene.shape[0]:
            continue
        rgb = cv2.resize(source_rgb, (width, height), interpolation=cv2.INTER_AREA)
        alpha = cv2.resize(source_alpha, (width, height), interpolation=cv2.INTER_AREA)
        mask = (alpha > ALPHA_VISIBLE).astype(np.uint8)
        sprite_area = float(mask.sum())
        if not sprite_area:
            continue
        rgb_mask = np.repeat(mask[:, :, None], 3, axis=2).astype(np.uint8) * 255
        color_error = cv2.matchTemplate(scene, rgb, cv2.TM_SQDIFF_NORMED, mask=rgb_mask)
        color_score = 1.0 - np.clip(np.nan_to_num(color_error, nan=1.0, posinf=1.0, neginf=1.0), 0.0, 1.0)
        intersection = cv2.matchTemplate(target, mask, cv2.TM_CCORR)
        union = target_area + sprite_area - intersection
        silhouette_score = np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)
        sprite_edge = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8))
        edge_intersection = cv2.matchTemplate(target_edge, sprite_edge, cv2.TM_CCORR)
        edge_score = (2.0 * edge_intersection) / max(1.0, target_edge_area + float(sprite_edge.sum()))
        scale_score = 1.0 - min(1.0, abs(scale - 1.0) / 0.1)
        scores = (
            color_weight * color_score
            + silhouette_weight * silhouette_score
            + edge_weight * edge_score
            + scale_weight * scale_score
        )

        x_min, x_max = max(0, origin_x - max_shift), min(scores.shape[1] - 1, origin_x + max_shift)
        y_min, y_max = max(0, origin_y - max_shift), min(scores.shape[0] - 1, origin_y + max_shift)
        if x_min > x_max or y_min > y_max:
            continue
        window = scores[y_min:y_max + 1, x_min:x_max + 1].copy()
        if inputs.target_point is not None:
            tx, ty = inputs.target_point[0] - cx0, inputs.target_point[1] - cy0
            ys, xs = np.indices(window.shape)
            absolute_x, absolute_y = xs + x_min, ys + y_min
            safe = (
                (absolute_x <= tx) & (tx <= absolute_x + width)
                & (absolute_y <= ty) & (ty <= absolute_y + height)
            )
            window[~safe] = -1.0
        wy, wx = np.unravel_index(int(np.argmax(window)), window.shape)
        score = float(window[wy, wx])
        if score < 0:
            continue
        x, y = x_min + int(wx), y_min + int(wy)
        parts = {
            "color": float(color_score[y, x]),
            "silhouette": float(silhouette_score[y, x]),
            "edge": float(edge_score[y, x]),
            "scalePrior": scale_score,
        }
        candidate = (score, scale, x, y, width, height, parts)
        if best is None or candidate[:6] > best[:6]:
            best = candidate

    if best is None:
        return {"score": 0.0, "verdict": "fail", "hitboxSafe": False, "evidence": "no hitbox-safe candidate"}
    score, scale, x, y, width, height, parts = best
    fitted_box = [cx0 + x, cy0 + y, cx0 + x + width, cy0 + y + height]
    return {
        "score": round(score, 4), "verdict": "pass", "scale": scale,
        "dx": fitted_box[0] - sx0, "dy": fitted_box[1] - sy0,
        "originalBox": list(inputs.sprite_box), "fittedBox": fitted_box,
        "hitboxSafe": True, "components": {key: round(value, 4) for key, value in parts.items()},
        "weights": {
            "color": round(color_weight, 4), "silhouette": round(silhouette_weight, 4),
            "edge": round(edge_weight, 4), "scalePrior": round(scale_weight, 4),
        },
    }


def _fit_keypoints(inputs: BirdInputs, method: str) -> dict:
    """Fit a conservative similarity transform from local feature matches.

    The result is rejected unless RANSAC consensus is both strong and spread
    across the sprite. Sparse matches in one feather are worse than no match:
    they produce the spectacular diagonal collapses seen in affine prototypes.
    """
    if inputs.scene_crop is None:
        return {"score": None, "verdict": "unscored", "accepted": False, "evidence": "painted scene required"}
    rgba = np.asarray(inputs.sprite.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[:, :, 3]
    if int((alpha > ALPHA_VISIBLE).sum()) < 32:
        return {"score": 0.0, "verdict": "fail", "accepted": False, "evidence": "sprite alpha too small"}
    source = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2GRAY)
    source[alpha <= ALPHA_VISIBLE] = 0
    target = cv2.cvtColor(np.clip(inputs.scene_crop, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    if method == "features":
        detector = cv2.SIFT_create(nfeatures=1200, contrastThreshold=0.02, edgeThreshold=12)
        norm, ratio = cv2.NORM_L2, 0.72
    elif method == "orb":
        detector = cv2.ORB_create(nfeatures=1600, scaleFactor=1.15, nlevels=10, edgeThreshold=9, fastThreshold=7)
        norm, ratio = cv2.NORM_HAMMING, 0.78
    else:
        raise ValueError(f"unknown keypoint matcher: {method}")
    source_points, source_desc = detector.detectAndCompute(source, alpha)
    target_points, target_desc = detector.detectAndCompute(target, None)
    if source_desc is None or target_desc is None or len(source_points) < 3 or len(target_points) < 3:
        return {"score": 0.0, "verdict": "fail", "accepted": False, "evidence": "not enough grayscale features"}
    pairs = cv2.BFMatcher(norm).knnMatch(source_desc, target_desc, k=2)
    matches = [first for pair in pairs if len(pair) == 2 for first, second in [pair] if first.distance < ratio * second.distance]
    if len(matches) < 3:
        return {"score": 0.0, "verdict": "fail", "accepted": False, "matches": len(matches), "evidence": "not enough ratio-test matches"}
    source_xy = np.float32([source_points[m.queryIdx].pt for m in matches])
    target_xy = np.float32([target_points[m.trainIdx].pt for m in matches])
    matrix, inlier_mask = cv2.estimateAffinePartial2D(
        source_xy, target_xy, method=cv2.RANSAC, ransacReprojThreshold=4.0,
        maxIters=3000, confidence=0.995, refineIters=10,
    )
    if matrix is None or inlier_mask is None:
        return {"score": 0.0, "verdict": "fail", "accepted": False, "matches": len(matches), "evidence": "RANSAC found no similarity transform"}
    inliers = inlier_mask.ravel().astype(bool)
    inlier_count = int(inliers.sum())
    inlier_ratio = inlier_count / len(matches)
    inlier_source = source_xy[inliers]
    if inlier_count:
        hull_area = float(cv2.contourArea(cv2.convexHull(inlier_source))) if inlier_count >= 3 else 0.0
    else:
        hull_area = 0.0
    visible = np.argwhere(alpha > ALPHA_VISIBLE)
    sprite_area = max(1.0, float((visible[:, 0].max() - visible[:, 0].min() + 1) * (visible[:, 1].max() - visible[:, 1].min() + 1)))
    coverage = min(1.0, hull_area / sprite_area)
    a, b, tx = (float(value) for value in matrix[0])
    c, d, ty = (float(value) for value in matrix[1])
    scale = (a * a + c * c) ** 0.5
    rotation = float(np.degrees(np.arctan2(c, a)))
    projected = cv2.transform(source_xy[inliers, None, :], matrix)[:, 0, :] if inlier_count else np.empty((0, 2))
    reprojection = np.linalg.norm(projected - target_xy[inliers], axis=1) if inlier_count else np.asarray([999.0])
    median_error = float(np.median(reprojection))
    accepted = (
        inlier_count >= 4 and inlier_ratio >= 0.5 and coverage >= 0.08
        and 0.65 <= scale <= 1.35 and abs(rotation) <= 20.0 and median_error <= 3.5
    )
    h, w = source.shape
    center = np.asarray([w / 2.0, h / 2.0, 1.0])
    mapped_center = matrix @ center
    fitted_w, fitted_h = max(1, round(w * scale)), max(1, round(h * scale))
    cx0, cy0, _, _ = inputs.crop_box
    x0 = round(cx0 + mapped_center[0] - fitted_w / 2.0)
    y0 = round(cy0 + mapped_center[1] - fitted_h / 2.0)
    fitted_box = [x0, y0, x0 + fitted_w, y0 + fitted_h]
    if inputs.target_point is not None:
        px, py = inputs.target_point
        accepted = accepted and fitted_box[0] <= px <= fitted_box[2] and fitted_box[1] <= py <= fitted_box[3]
    sx0, sy0, _, _ = inputs.sprite_box
    score = min(1.0, 0.45 * inlier_ratio + 0.35 * min(1.0, coverage / 0.25) + 0.2 * max(0.0, 1.0 - median_error / 4.0))
    return {
        "score": round(score, 4), "verdict": "pass" if accepted else "fail", "accepted": accepted,
        "matches": len(matches), "inliers": inlier_count, "inlierRatio": round(inlier_ratio, 4),
        "coverage": round(coverage, 4), "medianReprojectionError": round(median_error, 3),
        "scale": round(scale, 4), "rotation": round(rotation, 3),
        "dx": x0 - sx0, "dy": y0 - sy0,
        "originalBox": list(inputs.sprite_box), "fittedBox": fitted_box,
        "evidence": None if accepted else f"{method} consensus failed conservative geometry gates",
    }


def fit_features(inputs: BirdInputs) -> dict:
    """SIFT + RANSAC similarity matching."""
    return _fit_keypoints(inputs, "features")


def fit_orb(inputs: BirdInputs) -> dict:
    """ORB + Hamming + RANSAC similarity matching."""
    return _fit_keypoints(inputs, "orb")


def fit_chamfer(
    inputs: BirdInputs,
    *,
    max_shift: int = 96,
    scales: tuple[float, ...] = (0.75, 0.85, 0.95, 1.0, 1.05, 1.15, 1.25),
) -> dict:
    """Fit alpha-boundary edges to the painted-change boundary."""
    if inputs.clean_crop is None or inputs.scene_crop is None:
        return {"score": None, "verdict": "unscored", "accepted": False, "evidence": "aligned clean/scene pair required"}
    target = _alignment_target(inputs, max_shift=max_shift, scales=scales).astype(np.uint8)
    target_edge = cv2.morphologyEx(target, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    distance = cv2.distanceTransform(1 - target_edge, cv2.DIST_L2, 3)
    rgba = np.asarray(inputs.sprite.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[:, :, 3]
    cx0, cy0, _, _ = inputs.crop_box
    sx0, sy0, _, _ = inputs.sprite_box
    origin_x, origin_y = sx0 - cx0, sy0 - cy0
    best = None
    for scale in scales:
        width, height = max(1, round(inputs.sprite.width * scale)), max(1, round(inputs.sprite.height * scale))
        if width > target.shape[1] or height > target.shape[0]:
            continue
        mask = (cv2.resize(alpha, (width, height), interpolation=cv2.INTER_AREA) > ALPHA_VISIBLE).astype(np.uint8)
        edge = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
        edge_area = float(edge.sum())
        if edge_area < 8:
            continue
        costs = cv2.matchTemplate(distance, edge.astype(np.float32), cv2.TM_CCORR) / edge_area
        x_min, x_max = max(0, origin_x - max_shift), min(costs.shape[1] - 1, origin_x + max_shift)
        y_min, y_max = max(0, origin_y - max_shift), min(costs.shape[0] - 1, origin_y + max_shift)
        if x_min > x_max or y_min > y_max:
            continue
        window = costs[y_min:y_max + 1, x_min:x_max + 1].copy()
        if inputs.target_point is not None:
            tx, ty = inputs.target_point[0] - cx0, inputs.target_point[1] - cy0
            ys, xs = np.indices(window.shape)
            absolute_x, absolute_y = xs + x_min, ys + y_min
            safe = ((absolute_x <= tx) & (tx <= absolute_x + width) & (absolute_y <= ty) & (ty <= absolute_y + height))
            window[~safe] = np.inf
        wy, wx = np.unravel_index(int(np.argmin(window)), window.shape)
        cost = float(window[wy, wx])
        if not np.isfinite(cost):
            continue
        candidate = (cost, abs(scale - 1.0), scale, x_min + int(wx), y_min + int(wy), width, height)
        if best is None or candidate < best:
            best = candidate
    if best is None:
        return {"score": 0.0, "verdict": "fail", "accepted": False, "evidence": "no hitbox-safe chamfer candidate"}
    cost, _, scale, x, y, width, height = best
    fitted_box = [cx0 + x, cy0 + y, cx0 + x + width, cy0 + y + height]
    score = float(np.exp(-cost / 4.0))
    return {
        "score": round(score, 4), "verdict": "pass", "accepted": True, "hitboxSafe": True,
        "scale": scale, "dx": fitted_box[0] - sx0, "dy": fitted_box[1] - sy0,
        "originalBox": list(inputs.sprite_box), "fittedBox": fitted_box,
        "meanEdgeDistance": round(cost, 3),
    }


def _best_match(results: dict[str, dict]) -> dict:
    """Select the strongest safe proposal; rejection preserves current geometry."""
    accepted_features = [
        (name, results.get(name, {})) for name in ("features", "orb")
        if results.get(name, {}).get("accepted") is True
    ]
    if accepted_features:
        name, feature = max(accepted_features, key=lambda item: float(item[1].get("score", 0.0)))
        return {**feature, "method": name}
    hybrid = results.get("hybrid", {})
    if hybrid.get("verdict") == "pass" and hybrid.get("hitboxSafe") is True:
        return {**hybrid, "accepted": True, "method": "hybrid"}
    color = results.get("color", {})
    return {**color, "accepted": color.get("verdict") == "pass", "method": "color"}


MATCHERS = {
    "silhouette": fit_silhouette,
    "color": fit_color,
    "hybrid": fit_hybrid,
    "features": fit_features,
    "orb": fit_orb,
    "chamfer": fit_chamfer,
}


def match_cutout(inputs: BirdInputs, methods: tuple[str, ...] = DEFAULT_MATCH_METHODS) -> dict[str, dict]:
    """Stable, swappable cutout-matching step used by CLI evaluation."""
    unknown = sorted(set(methods) - set(MATCHERS) - {"best"})
    if unknown:
        raise ValueError(f"unknown cutout matching method(s): {', '.join(unknown)}")
    required = [method for method in methods if method != "best"]
    if "best" in methods:
        # Chamfer is a diagnostic challenger, not a Safe-selector input. It is
        # both less reliable around scene edges and substantially more costly.
        for fallback in ("color", "hybrid", "features", "orb"):
            if fallback not in required:
                required.append(fallback)
    results = {method: MATCHERS[method](inputs) for method in required}
    if "best" in methods:
        results["best"] = _best_match(results)
    return {method: results[method] for method in methods}


def _alignment_target(inputs: BirdInputs, *, max_shift: int, scales: tuple[float, ...]) -> np.ndarray:
    target = _changed_mask(inputs).astype(np.uint8)
    cx0, cy0, cx1, cy1 = inputs.crop_box
    for nx0, ny0, nx1, ny1 in inputs.neighbor_boxes:
        ix0, iy0 = max(nx0, cx0), max(ny0, cy0)
        ix1, iy1 = min(nx1, cx1), min(ny1, cy1)
        if ix1 > ix0 and iy1 > iy0:
            target[iy0 - cy0:iy1 - cy0, ix0 - cx0:ix1 - cx0] = 0

    sx0, sy0, sx1, sy1 = inputs.sprite_box
    base_w, base_h = sx1 - sx0, sy1 - sy0
    origin_x, origin_y = sx0 - cx0, sy0 - cy0
    max_scale = max(scales, default=1.0)
    roi = np.zeros_like(target)
    roi_x0 = max(0, origin_x - max_shift)
    roi_y0 = max(0, origin_y - max_shift)
    roi_x1 = min(target.shape[1], origin_x + max_shift + round(base_w * max_scale))
    roi_y1 = min(target.shape[0], origin_y + max_shift + round(base_h * max_scale))
    roi[roi_y0:roi_y1, roi_x0:roi_x1] = 1
    target &= roi
    return target


def evaluate_bird(inputs: BirdInputs) -> dict:
    alpha, sprite_rgb = _alpha_in_crop(inputs)
    visible = alpha > (ALPHA_VISIBLE / 255.0)
    sprite_area = float(visible.sum())
    axes: dict[str, dict] = {}

    # Satellite specks: computable in every mode (sprite alpha alone).
    components = _connected_components(visible) if sprite_area else []
    specks = [c for c in components[1:] if int(c.sum()) >= SPECK_MIN_AREA]
    speck_area = float(sum(int(c.sum()) for c in specks))
    axes["specks"] = {
        "count": len(specks),
        "areaFraction": round(speck_area / sprite_area, 4) if sprite_area else 0.0,
        "verdict": "pass" if not specks else ("warn" if speck_area / sprite_area < 0.05 else "fail"),
    }

    if inputs.clean_crop is None or inputs.scene_crop is None or not sprite_area:
        reduced = {"score": None, "verdict": "unscored", "reducedInput": True}
        if not sprite_area:
            reduced = {"score": 0.0, "verdict": "fail", "evidence": "empty sprite alpha"}
        axes["exclusion"] = dict(reduced)
        axes["coherence"] = dict(reduced)
        return {"axes": axes, "spriteArea": int(sprite_area)}

    changed = _changed_mask(inputs)

    # Exclusion: sprite mass sitting on unchanged background. A sprite pixel
    # whose own color matches the clean bg beneath it is invisible, not a
    # leak — without this, white-bodied birds over light line-art regions
    # false-positived at leak ~0.5 (found live on japan_morning_market_a7a0).
    alpha_mass = float(alpha.sum())
    sprite_differs = (
        np.abs(sprite_rgb.astype(np.int16) - inputs.clean_crop.astype(np.int16)).sum(axis=2).astype(np.float32)
        > CHANGE_ABS_FLOOR
    )
    leak = float((alpha * (~changed & sprite_differs)).sum()) / alpha_mass if alpha_mass else 1.0
    axes["exclusion"] = {
        "score": round(1.0 - leak, 4),
        "verdict": _verdict(1.0 - leak, EXCLUSION_WARN, EXCLUSION_FAIL),
        "leakFraction": round(leak, 4),
    }

    # Coherence: painted content the sprite does not carry pops on pickup.
    # Neighbor sprites are part of the composed scene — mask them out.
    neighbor_mask = np.zeros(changed.shape, dtype=bool)
    cx0, cy0, cx1, cy1 = inputs.crop_box
    for nx0, ny0, nx1, ny1 in inputs.neighbor_boxes:
        ix0, iy0 = max(nx0, cx0), max(ny0, cy0)
        ix1, iy1 = min(nx1, cx1), min(ny1, cy1)
        if ix1 > ix0 and iy1 > iy0:
            neighbor_mask[iy0 - cy0:iy1 - cy0, ix0 - cx0:ix1 - cx0] = True
    pop = changed & ~visible & ~neighbor_mask
    pop_area = float(pop.sum())
    pop_ratio = pop_area / sprite_area
    score = max(0.0, 1.0 - pop_ratio)
    axes["coherence"] = {
        "score": round(score, 4),
        "verdict": _verdict(score, POP_WARN, POP_FAIL),
        "popArea": int(pop_area),
        "popRatio": round(pop_ratio, 4),
    }
    return {"axes": axes, "spriteArea": int(sprite_area)}


def _load_rgb(path: Path) -> np.ndarray:
    # Keep full 4K corpus images compact; arithmetic promotes the active crop
    # to int16 where subtraction is required.
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)


def _crop(arr: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    return arr[y0:y1, x0:x1]


def level_noise_floor(clean: np.ndarray, scene: np.ndarray, cleanup_boxes: list[tuple[int, int, int, int]]) -> float:
    diff = np.abs(scene.astype(np.int16) - clean.astype(np.int16)).sum(axis=2).astype(np.float32)
    outside = np.ones(diff.shape, dtype=bool)
    for x0, y0, x1, y1 in cleanup_boxes:
        outside[y0:y1, x0:x1] = False
    if not outside.any():
        return 0.0
    return float(np.median(diff[outside]))


def _alignment_preview(inputs: BirdInputs, alignment: dict) -> Image.Image:
    target = (_alignment_target(inputs, max_shift=32, scales=tuple(round(0.75 + index * 0.05, 2) for index in range(11))) * 255).astype(np.uint8)
    panels = []
    for box in (alignment["originalBox"], alignment["fittedBox"]):
        panel = np.zeros((*target.shape, 3), dtype=np.uint8)
        panel[:, :, 1] = target
        x0, y0, x1, y1 = box
        width, height = x1 - x0, y1 - y0
        alpha = np.asarray(inputs.sprite.convert("RGBA"))[:, :, 3]
        mask = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_NEAREST) > ALPHA_VISIBLE
        cx0, cy0, _, _ = inputs.crop_box
        px, py = x0 - cx0, y0 - cy0
        ix0, iy0 = max(0, px), max(0, py)
        ix1, iy1 = min(panel.shape[1], px + width), min(panel.shape[0], py + height)
        if ix1 > ix0 and iy1 > iy0:
            local = mask[iy0 - py:iy1 - py, ix0 - px:ix1 - px]
            panel[iy0:iy1, ix0:ix1, 0][local] = 255
        panels.append(panel)
    return Image.fromarray(np.concatenate(panels, axis=1), "RGB")


def evaluate_level_dir(
    level_dir: Path,
    preview_dir: Path | None = None,
    match_methods: tuple[str, ...] = DEFAULT_MATCH_METHODS,
    include_legacy_xy: bool = True,
) -> dict:
    """Evaluate an exported level directory (public/levels/<id>)."""
    level = json.loads((level_dir / "level.json").read_text())
    clean_path = next((p for p in (level_dir / "bg_00.png", level_dir / "color.png") if p.exists()), None)
    scene_path = level_dir / "color.png"
    reduced = clean_path is None or clean_path == scene_path or not scene_path.exists()
    clean = scene = None
    floor = 0.0
    cleanup_boxes = []
    for dog in level.get("dogs", []):
        c = (dog.get("sprite") or {}).get("cleanup")
        if c:
            cleanup_boxes.append((c["x"], c["y"], c["x"] + c["width"], c["y"] + c["height"]))
    if scene_path.exists():
        scene = _load_rgb(scene_path)
    if not reduced and clean_path is not None:
        candidate_clean = _load_rgb(clean_path)
        if scene is not None and candidate_clean.shape == scene.shape:
            clean = candidate_clean
            floor = level_noise_floor(clean, scene, cleanup_boxes)
        else:
            # Never stretch a mismatched clean/painted pair. Scene-only
            # matchers remain useful; alignment-dependent matchers are
            # explicitly unscored.
            reduced = True

    birds = []
    alignment_inputs: list[tuple[dict, BirdInputs]] = []
    for dog in level.get("dogs", []):
        sprite_meta = dog.get("sprite") or {}
        image_rel = sprite_meta.get("image")
        record: dict = {"dogId": dog.get("id")}
        sprite_path = None
        if image_rel:
            # level.json paths are public/-relative ("levels/<id>/dogs/...");
            # also resolve within level_dir so staged exports outside the
            # public tree evaluate identically.
            prefix = f"levels/{level_dir.name}/"
            candidates = [level_dir.parent.parent / image_rel]
            if image_rel.startswith(prefix):
                candidates.append(level_dir / image_rel[len(prefix):])
            sprite_path = next((c for c in candidates if c.exists()), None)
        if sprite_path is None:
            record["axes"] = {"exclusion": {"score": 0.0, "verdict": "fail", "evidence": "missing sprite"}}
            birds.append(record)
            continue
        sx, sy = sprite_meta["x"], sprite_meta["y"]
        sw, sh = sprite_meta["width"], sprite_meta["height"]
        sprite_box = (sx, sy, sx + sw, sy + sh)
        sidecar = sprite_path.with_suffix(".json")
        crop_box = None
        if sidecar.exists():
            crop_box = tuple(json.loads(sidecar.read_text()).get("sourceBox") or ()) or None
        if crop_box is None:
            pad = max(sw, sh) // 2
            crop_box = (sx - pad, sy - pad, sx + sw + pad, sy + sh + pad)
        # Evaluation must include both the current sprite and the human target.
        # Sidecar sourceBox can describe only the extracted cutout region; when
        # that extraction is wrong it otherwise hides the actual painted bird
        # from every matcher (hawaii dog_04).
        search_pad = max(sw, sh) + 96
        # Sprite anchors are the portable human-owned point. Some panoramic
        # levels store dog.x/y in a section-local frame while sprite geometry
        # is global, so raw dog coordinates reject valid candidates.
        target_x = round(sx + float(sprite_meta.get("anchorX", 0.5)) * sw)
        target_y = round(sy + float(sprite_meta.get("anchorY", 0.5)) * sh)
        crop_box = (
            min(crop_box[0], sx - 96, target_x - search_pad),
            min(crop_box[1], sy - 96, target_y - search_pad),
            max(crop_box[2], sx + sw + 96, target_x + search_pad),
            max(crop_box[3], sy + sh + 96, target_y + search_pad),
        )
        width = int(level.get("width") or 0) or (scene.shape[1] if scene is not None else crop_box[2])
        height = int(level.get("height") or 0) or (scene.shape[0] if scene is not None else crop_box[3])
        crop_box = (
            max(0, crop_box[0]), max(0, crop_box[1]),
            min(width, crop_box[2]), min(height, crop_box[3]),
        )
        neighbor_boxes = []
        for other in level.get("dogs", []):
            if other is dog:
                continue
            os_ = other.get("sprite") or {}
            if all(k in os_ for k in ("x", "y", "width", "height")):
                neighbor_boxes.append(
                    (os_["x"], os_["y"], os_["x"] + os_["width"], os_["y"] + os_["height"])
                )
        inputs = BirdInputs(
            dog_id=str(dog.get("id")),
            sprite=Image.open(sprite_path).convert("RGBA"),
            sprite_box=sprite_box,
            crop_box=crop_box,
            clean_crop=None if clean is None else _crop(clean, crop_box),
            scene_crop=None if scene is None else _crop(scene, crop_box),
            noise_floor=floor,
            neighbor_boxes=tuple(neighbor_boxes),
            target_point=(target_x, target_y),
        )
        record.update(evaluate_bird(inputs))
        record["alignment"] = fit_silhouette(inputs)
        matches = match_cutout(inputs, match_methods)
        record["cutoutMatches"] = matches
        record["colorAlignment"] = matches["color"] if "color" in matches else fit_color(inputs)
        if include_legacy_xy:
            xy_candidates = fit_color_xy(inputs, candidate_caps=(0.12, 0.25, None))["candidates"]
            record["colorXY12Alignment"] = xy_candidates[0]
            record["colorXY25Alignment"] = xy_candidates[1]
            record["colorXYUnlockedAlignment"] = xy_candidates[2]
        record["hybridAlignment"] = matches["hybrid"] if "hybrid" in matches else fit_hybrid(inputs)
        if inputs.clean_crop is not None and inputs.scene_crop is not None:
            from levelbuilder.golden_cutouts import cutout_quality_features

            cx0, cy0, _, _ = inputs.crop_box
            local_box = (sx - cx0, sy - cy0, sx + sw - cx0, sy + sh - cy0)
            quality_features = cutout_quality_features(
                inputs.clean_crop, inputs.scene_crop, inputs.sprite, local_box,
            )
            quality_features["boxAreaFraction"] = (sw * sh) / max(1, width * height)
            quality_features["precisionRecallGap"] = abs(
                quality_features["changedPrecision"] - quality_features["changedRecall"]
            )
            quality_features["qualityProduct"] = quality_features["changedIou"] * quality_features["colorSimilarity"]
            quality_features["logAreaFraction"] = math.log(max(1e-9, quality_features["boxAreaFraction"]))
            quality_features["logComponentCount"] = math.log1p(quality_features["componentCount"])
            hybrid = record["hybridAlignment"]
            fitted = hybrid.get("fittedBox") or list(sprite_box)
            movement = math.hypot(
                (fitted[0] + fitted[2] - sprite_box[0] - sprite_box[2]) / 2,
                (fitted[1] + fitted[3] - sprite_box[1] - sprite_box[3]) / 2,
            )
            components = hybrid.get("components") or {}
            record["qualityFeatures"] = quality_features
            record["selectionFeatures"] = {
                **quality_features,
                "hybridScore": float(hybrid.get("score") or 0.0),
                "hybridColor": float(components.get("color") or 0.0),
                "hybridSilhouette": float(components.get("silhouette") or 0.0),
                "hybridEdge": float(components.get("edge") or 0.0),
                "hybridScale": float(hybrid.get("scale") or 1.0),
                "hybridMovementNorm": movement / max(1.0, math.hypot(sw, sh)),
                "colorScore": float(record["colorAlignment"].get("score") or 0.0),
            }
        birds.append(record)
        alignment_inputs.append((record, inputs))

    alignment_scores = [
        float(bird["alignment"]["score"])
        for bird in birds
        if bird.get("alignment", {}).get("score") is not None
    ]
    alignment_threshold = ALIGNMENT_OUTLIER_SCORE
    if alignment_scores:
        median = float(np.median(alignment_scores))
        mad = float(np.median(np.abs(np.asarray(alignment_scores) - median)))
        alignment_threshold = max(ALIGNMENT_ABSOLUTE_FLOOR, median - 2.5 * mad)
        for bird in birds:
            alignment = bird.get("alignment", {})
            score = alignment.get("score")
            if score is None:
                continue
            alignment["outlier"] = float(score) < alignment_threshold
            alignment["verdict"] = "fail" if alignment["outlier"] else "pass"
    if preview_dir is not None:
        preview_dir.mkdir(parents=True, exist_ok=True)
        for bird, inputs in alignment_inputs:
            if bird["alignment"].get("outlier") is True and bird["alignment"].get("score") is not None:
                _alignment_preview(inputs, bird["alignment"]).save(
                    preview_dir / f"{level_dir.name}-{bird['dogId']}.png"
                )

    worst = {"pass": 0, "warn": 1, "fail": 2, "unscored": 0}
    summary = {
        "birds": len(birds),
        "reducedInput": reduced,
        "noiseFloor": round(floor, 2),
        "alignmentOutlierThreshold": round(alignment_threshold, 4),
        "fail": sum(1 for b in birds if any(a.get("verdict") == "fail" for a in b.get("axes", {}).values())),
        "warn": sum(
            1 for b in birds
            if max(worst.get(a.get("verdict"), 0) for a in b.get("axes", {}).values()) == 1
        ),
        "alignmentOutliers": sum(1 for bird in birds if bird.get("alignment", {}).get("outlier") is True),
    }
    return {"schemaVersion": SCHEMA_VERSION, "levelId": level.get("id"), "summary": summary, "birds": birds}


def evaluate_corpus(
    root: Path,
    level_ids: list[str] | None = None,
    preview_dir: Path | None = None,
    match_methods: tuple[str, ...] = DEFAULT_MATCH_METHODS,
    include_legacy_xy: bool = True,
    workers: int = 1,
    checkpoint_dir: Path | None = None,
    exclude_level_ids: set[str] | None = None,
) -> dict:
    level_dirs = [
        level_dir for level_dir in sorted(p for p in root.iterdir() if (p / "level.json").exists())
        if (not level_ids or level_dir.name in level_ids)
        and level_dir.name not in (exclude_level_ids or set())
    ]
    def evaluate(level_dir: Path) -> dict:
        return evaluate_level_dir(
            level_dir,
            None if preview_dir is None else preview_dir / level_dir.name,
            match_methods,
            include_legacy_xy,
        )
    if checkpoint_dir is not None:
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

    def evaluate_or_resume(level_dir: Path) -> dict:
        checkpoint = None if checkpoint_dir is None else checkpoint_dir / f"{level_dir.name}.json"
        if checkpoint is not None and checkpoint.is_file():
            try:
                saved = json.loads(checkpoint.read_text())
                if saved.get("levelId") == level_dir.name:
                    return saved
            except (OSError, ValueError):
                pass
        result = evaluate(level_dir)
        if checkpoint is not None:
            temporary = checkpoint.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(result, indent=1))
            temporary.replace(checkpoint)
        return result

    if workers > 1:
        # OpenCV otherwise creates its own pool inside every Python worker,
        # oversubscribing the host and making full-catalog runs less reliable.
        cv2.setNumThreads(1)
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="cutout-match") as pool:
            levels = list(pool.map(evaluate_or_resume, level_dirs))
    else:
        levels = [evaluate_or_resume(level_dir) for level_dir in level_dirs]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "root": str(root),
        "levels": levels,
        "summary": {
            "levels": len(levels),
            "birds": sum(lv["summary"]["birds"] for lv in levels),
            "fail": sum(lv["summary"]["fail"] for lv in levels),
            "warn": sum(lv["summary"]["warn"] for lv in levels),
            "alignmentOutliers": sum(lv["summary"]["alignmentOutliers"] for lv in levels),
        },
    }


def _atomic_write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def apply_match_report(
    root: Path,
    report: dict,
    *,
    method: str = "best",
    workspace_root: Path | None = None,
    dry_run: bool = False,
) -> dict:
    """Apply accepted matcher boxes to exports and their session sidecars.

    Cleanup boxes remain human-owned. Automatic matcher boxes must contain the
    stable pickup point. Explicit manual placement instead preserves the
    sprite's current relative anchor so a human can correct a bad mapping.
    """
    summary = {
        "method": method, "levels": 0, "birds": 0, "applied": 0,
        "unchanged": 0, "rejected": 0, "unsafe": 0, "sourceSidecarsUpdated": 0,
        "sourceSidecarsMissing": 0, "dryRun": dry_run,
        "changes": [],
    }
    for level_report in report.get("levels", []):
        level_id = level_report.get("levelId")
        if not isinstance(level_id, str):
            continue
        level_path = root / level_id / "level.json"
        if not level_path.is_file():
            continue
        level = json.loads(level_path.read_text())
        updated_level = copy.deepcopy(level)
        try:
            scene_width = int(level.get("width", 0))
            scene_height = int(level.get("height", 0))
        except (TypeError, ValueError):
            scene_width = scene_height = 0
        dogs = {dog.get("id"): dog for dog in updated_level.get("dogs", []) if isinstance(dog, dict)}
        sidecars: dict[Path, dict] = {}
        level_changed = False
        summary["levels"] += 1
        for bird in level_report.get("birds", []):
            summary["birds"] += 1
            dog = dogs.get(bird.get("dogId"))
            result = bird.get("cutoutMatches", {}).get(method, {})
            if not dog or result.get("accepted", result.get("verdict") == "pass") is not True:
                summary["rejected"] += 1
                continue
            box = result.get("fittedBox")
            if not (isinstance(box, list) and len(box) == 4):
                summary["rejected"] += 1
                continue
            try:
                x0, y0, x1, y1 = [int(round(float(value))) for value in box]
            except (KeyError, TypeError, ValueError):
                summary["rejected"] += 1
                continue
            width, height = x1 - x0, y1 - y0
            if (
                width <= 0
                or height <= 0
                or scene_width <= 0
                or scene_height <= 0
                or not (0 <= x0 < x1 <= scene_width and 0 <= y0 < y1 <= scene_height)
            ):
                summary["unsafe"] += 1
                continue
            sprite = dog.get("sprite")
            if not isinstance(sprite, dict):
                summary["rejected"] += 1
                continue
            try:
                if method == MANUAL_MATCH_METHOD:
                    anchor_x = round(float(sprite.get("anchorX", 0.5)), 4)
                    anchor_y = round(float(sprite.get("anchorY", 0.5)), 4)
                else:
                    target_x = round(
                        float(sprite.get("x", dog["x"]))
                        + float(sprite.get("anchorX", 0.5)) * float(sprite.get("width", 0))
                    )
                    target_y = round(
                        float(sprite.get("y", dog["y"]))
                        + float(sprite.get("anchorY", 0.5)) * float(sprite.get("height", 0))
                    )
            except (KeyError, TypeError, ValueError):
                summary["rejected"] += 1
                continue
            if method != MANUAL_MATCH_METHOD:
                if not (x0 <= target_x <= x1 and y0 <= target_y <= y1):
                    summary["unsafe"] += 1
                    continue
                anchor_x = round((target_x - x0) / width, 4)
                anchor_y = round((target_y - y0) / height, 4)
            updates = {
                "x": x0, "y": y0, "width": width, "height": height,
                "anchorX": anchor_x, "anchorY": anchor_y,
            }
            for key in ("flipX", "flipY"):
                if key in result:
                    updates[key] = result[key] is True
            cleanup_box = result.get("cleanupBox")
            cleanup_updates = None
            if cleanup_box is not None:
                try:
                    cx0, cy0, cx1, cy1 = [int(round(float(value))) for value in cleanup_box]
                except (TypeError, ValueError):
                    summary["unsafe"] += 1
                    continue
                if not (0 <= cx0 < cx1 <= scene_width and 0 <= cy0 < cy1 <= scene_height):
                    summary["unsafe"] += 1
                    continue
                cleanup_updates = {"x": cx0, "y": cy0, "width": cx1 - cx0, "height": cy1 - cy0}
            changed = any(sprite.get(key) != value for key, value in updates.items())
            changed = changed or (cleanup_updates is not None and sprite.get("cleanup") != cleanup_updates)
            if not changed:
                summary["unchanged"] += 1
                continue
            summary["changes"].append({
                "levelId": level_id,
                "dogId": bird.get("dogId"),
                "from": [sprite.get("x"), sprite.get("y"), sprite.get("x", 0) + sprite.get("width", 0), sprite.get("y", 0) + sprite.get("height", 0)],
                "to": [x0, y0, x1, y1],
                "selectedMethod": result.get("method", method),
                "score": result.get("score"),
            })
            sprite.update(updates)
            if cleanup_updates is not None:
                sprite["cleanup"] = cleanup_updates
            image = sprite.get("image")
            if isinstance(image, str):
                marker = f"levels/{level_id}/"
                relative = image.split(marker, 1)[-1] if marker in image else image
                metadata_relative = Path(relative).with_suffix(".json")
                for sidecar_path, is_source in (
                    (root / level_id / metadata_relative, False),
                    ((workspace_root / "levels" / level_id / metadata_relative) if workspace_root else Path(), True),
                ):
                    if is_source and workspace_root is None:
                        continue
                    if not sidecar_path.is_file():
                        if is_source:
                            summary["sourceSidecarsMissing"] += 1
                        continue
                    data = json.loads(sidecar_path.read_text())
                    sidecar_updates = {
                        "spriteBox": [x0, y0, x1, y1], "width": width, "height": height,
                        "anchorX": anchor_x, "anchorY": anchor_y,
                    }
                    if cleanup_box is not None:
                        sidecar_updates["cleanupBox"] = [cx0, cy0, cx1, cy1]
                    for key in ("flipX", "flipY"):
                        if key in result:
                            sidecar_updates[key] = result[key] is True
                    data.update(sidecar_updates)
                    sidecars[sidecar_path] = data
                    if is_source:
                        summary["sourceSidecarsUpdated"] += 1
            summary["applied"] += 1
            level_changed = True
        if not dry_run and level_changed:
            for path, data in sidecars.items():
                _atomic_write_json(path, data)
            _atomic_write_json(level_path, updated_level)
    return summary
