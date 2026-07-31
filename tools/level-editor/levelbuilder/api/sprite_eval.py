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
from dataclasses import dataclass
from pathlib import Path

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


def _verdict(score: float, warn: float, fail: float) -> str:
    # warn/fail are defect-fraction thresholds; score = 1 - defect fraction.
    defect = 1.0 - score
    if defect > fail:
        return "fail"
    if defect > warn:
        return "warn"
    return "pass"


def _alpha_in_crop(inputs: BirdInputs) -> np.ndarray:
    """Sprite alpha placed on the crop_box canvas, float 0..1."""
    cx0, cy0, cx1, cy1 = inputs.crop_box
    canvas = np.zeros((cy1 - cy0, cx1 - cx0), dtype=np.float32)
    sx0, sy0, sx1, sy1 = inputs.sprite_box
    alpha = np.asarray(inputs.sprite.convert("RGBA"), dtype=np.float32)[:, :, 3] / 255.0
    # Intersect sprite box with crop box.
    ix0, iy0 = max(sx0, cx0), max(sy0, cy0)
    ix1, iy1 = min(sx1, cx1), min(sy1, cy1)
    if ix1 <= ix0 or iy1 <= iy0:
        return canvas
    canvas[iy0 - cy0:iy1 - cy0, ix0 - cx0:ix1 - cx0] = alpha[
        iy0 - sy0:iy1 - sy0, ix0 - sx0:ix1 - sx0
    ]
    return canvas


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
    diff = np.abs(inputs.scene_crop - inputs.clean_crop).sum(axis=2).astype(np.float32)
    threshold = max(CHANGE_ABS_FLOOR, NOISE_MULT * inputs.noise_floor)
    return diff > threshold


def evaluate_bird(inputs: BirdInputs) -> dict:
    alpha = _alpha_in_crop(inputs)
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

    # Exclusion: sprite mass sitting on unchanged background.
    alpha_mass = float(alpha.sum())
    leak = float((alpha * ~changed).sum()) / alpha_mass if alpha_mass else 1.0
    axes["exclusion"] = {
        "score": round(1.0 - leak, 4),
        "verdict": _verdict(1.0 - leak, EXCLUSION_WARN, EXCLUSION_FAIL),
        "leakFraction": round(leak, 4),
    }

    # Coherence: painted content the sprite does not carry pops on pickup.
    pop = changed & ~visible
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
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)


def _crop(arr: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    return arr[y0:y1, x0:x1]


def level_noise_floor(clean: np.ndarray, scene: np.ndarray, cleanup_boxes: list[tuple[int, int, int, int]]) -> float:
    diff = np.abs(scene - clean).sum(axis=2).astype(np.float32)
    outside = np.ones(diff.shape, dtype=bool)
    for x0, y0, x1, y1 in cleanup_boxes:
        outside[y0:y1, x0:x1] = False
    if not outside.any():
        return 0.0
    return float(np.median(diff[outside]))


def evaluate_level_dir(level_dir: Path) -> dict:
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
    if not reduced:
        clean = _load_rgb(clean_path)
        scene = _load_rgb(scene_path)
        floor = level_noise_floor(clean, scene, cleanup_boxes)

    birds = []
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
        width = int(level.get("width") or 0) or (scene.shape[1] if scene is not None else crop_box[2])
        height = int(level.get("height") or 0) or (scene.shape[0] if scene is not None else crop_box[3])
        crop_box = (
            max(0, crop_box[0]), max(0, crop_box[1]),
            min(width, crop_box[2]), min(height, crop_box[3]),
        )
        inputs = BirdInputs(
            dog_id=str(dog.get("id")),
            sprite=Image.open(sprite_path).convert("RGBA"),
            sprite_box=sprite_box,
            crop_box=crop_box,
            clean_crop=None if reduced else _crop(clean, crop_box),
            scene_crop=None if reduced else _crop(scene, crop_box),
            noise_floor=floor,
        )
        record.update(evaluate_bird(inputs))
        birds.append(record)

    worst = {"pass": 0, "warn": 1, "fail": 2, "unscored": 0}
    summary = {
        "birds": len(birds),
        "reducedInput": reduced,
        "noiseFloor": round(floor, 2),
        "fail": sum(1 for b in birds if any(a.get("verdict") == "fail" for a in b.get("axes", {}).values())),
        "warn": sum(
            1 for b in birds
            if max(worst.get(a.get("verdict"), 0) for a in b.get("axes", {}).values()) == 1
        ),
    }
    return {"schemaVersion": SCHEMA_VERSION, "levelId": level.get("id"), "summary": summary, "birds": birds}


def evaluate_corpus(root: Path, level_ids: list[str] | None = None) -> dict:
    levels = []
    for level_dir in sorted(p for p in root.iterdir() if (p / "level.json").exists()):
        if level_ids and level_dir.name not in level_ids:
            continue
        levels.append(evaluate_level_dir(level_dir))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "root": str(root),
        "levels": levels,
        "summary": {
            "levels": len(levels),
            "birds": sum(lv["summary"]["birds"] for lv in levels),
            "fail": sum(lv["summary"]["fail"] for lv in levels),
            "warn": sum(lv["summary"]["warn"] for lv in levels),
        },
    }
