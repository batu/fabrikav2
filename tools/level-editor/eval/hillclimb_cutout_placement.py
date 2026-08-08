"""Tune the deterministic hybrid cutout matcher against frozen human placements.

The search is deliberately bounded and level-grouped. It never writes catalog data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
from PIL import Image

from levelbuilder.api.sprite_eval import BirdInputs, fit_color, fit_hybrid


HERE = Path(__file__).resolve().parent
DEFAULT_MANIFEST = HERE / "golden-cutout-placement-v1" / "manifest.json"
DEFAULT_LEVELS = HERE.parents[2] / "games" / "find_the_bird" / "public" / "levels"


@dataclass(frozen=True)
class Config:
    color: float = 0.45
    silhouette: float = 0.35
    edge: float = 0.15
    scale_prior: float = 0.05
    scale_min: float = 0.90
    scale_max: float = 1.10
    max_shift: int = 96

    def scales(self) -> tuple[float, ...]:
        count = round((self.scale_max - self.scale_min) / 0.05)
        return tuple(round(self.scale_min + index * 0.05, 2) for index in range(count + 1))

    def weights(self) -> tuple[float, float, float, float]:
        return self.color, self.silhouette, self.edge, self.scale_prior

    def as_dict(self) -> dict:
        return {
            "weights": {
                "color": self.color, "silhouette": self.silhouette,
                "edge": self.edge, "scalePrior": self.scale_prior,
            },
            "scaleMin": self.scale_min, "scaleMax": self.scale_max,
            "maxShift": self.max_shift,
        }


def _box_metrics(predicted: list[int], target: list[int]) -> dict[str, float]:
    px0, py0, px1, py1 = predicted
    tx0, ty0, tx1, ty1 = target
    intersection = max(0, min(px1, tx1) - max(px0, tx0)) * max(0, min(py1, ty1) - max(py0, ty0))
    union = (px1 - px0) * (py1 - py0) + (tx1 - tx0) * (ty1 - ty0) - intersection
    iou = intersection / union if union else 0.0
    center = math.hypot((px0 + px1 - tx0 - tx1) / 2, (py0 + py1 - ty0 - ty1) / 2)
    target_diag = max(1.0, math.hypot(tx1 - tx0, ty1 - ty0))
    width_error = abs(math.log(max(1, px1 - px0) / max(1, tx1 - tx0)))
    height_error = abs(math.log(max(1, py1 - py0) / max(1, ty1 - ty0)))
    loss = 0.5 * (1.0 - iou) + 0.25 * min(2.0, center / target_diag) + 0.125 * min(2.0, width_error) + 0.125 * min(2.0, height_error)
    return {"loss": loss, "iou": iou, "centerPx": center, "widthLogError": width_error, "heightLogError": height_error}


def _load_inputs(levels_root: Path, entry: dict) -> BirdInputs:
    level_dir = levels_root / entry["levelId"]
    level = json.loads((level_dir / "level.json").read_text())
    dog = next(dog for dog in level["dogs"] if dog["id"] == entry["dogId"])
    sprite_path = level_dir / entry["sprite"]
    actual_hash = hashlib.sha256(sprite_path.read_bytes()).hexdigest()
    if actual_hash != entry["spriteSha256"]:
        raise ValueError(f"golden sprite changed: {entry['levelId']}/{entry['dogId']} ({actual_hash})")
    clean_path = level_dir / "bg_00.png"
    scene_path = level_dir / "color.png"
    with Image.open(clean_path) as source:
        clean = np.asarray(source.convert("RGB"), dtype=np.uint8)
    with Image.open(scene_path) as source:
        scene = np.asarray(source.convert("RGB"), dtype=np.uint8)
    with Image.open(sprite_path) as source:
        sprite = source.convert("RGBA").copy()
    initial = tuple(entry["initialBox"])
    target_point = (int(dog["x"]), int(dog["y"]))
    sidecar = json.loads(sprite_path.with_suffix(".json").read_text())
    source_box = sidecar.get("sourceBox") or initial
    pad = max(initial[2] - initial[0], initial[3] - initial[1]) + 160
    crop = (
        max(0, min(source_box[0], initial[0] - 128, target_point[0] - pad)),
        max(0, min(source_box[1], initial[1] - 128, target_point[1] - pad)),
        min(scene.shape[1], max(source_box[2], initial[2] + 128, target_point[0] + pad)),
        min(scene.shape[0], max(source_box[3], initial[3] + 128, target_point[1] + pad)),
    )
    neighbors = []
    for other in level["dogs"]:
        if other["id"] == entry["dogId"] or not other.get("sprite"):
            continue
        value = other["sprite"]
        neighbors.append((value["x"], value["y"], value["x"] + value["width"], value["y"] + value["height"]))
    x0, y0, x1, y1 = crop
    return BirdInputs(
        dog_id=entry["dogId"], sprite=sprite, sprite_box=initial, crop_box=crop,
        clean_crop=clean[y0:y1, x0:x1], scene_crop=scene[y0:y1, x0:x1],
        neighbor_boxes=tuple(neighbors), target_point=target_point,
    )


def _evaluate(
    config: Config,
    samples: list[tuple[dict, BirdInputs]],
    cache: dict[tuple[Config, str, str], dict] | None = None,
) -> dict:
    rows = []
    for entry, inputs in samples:
        key = (config, entry["levelId"], entry["dogId"])
        row = cache.get(key) if cache is not None else None
        if row is None:
            match = fit_hybrid(inputs, max_shift=config.max_shift, scales=config.scales(), weights=config.weights())
            predicted = match.get("fittedBox") or list(inputs.sprite_box)
            metrics = _box_metrics(predicted, entry["targetBox"])
            row = {"levelId": entry["levelId"], "dogId": entry["dogId"], "predictedBox": predicted, "targetBox": entry["targetBox"], "matcherScore": match.get("score"), **metrics}
            if cache is not None:
                cache[key] = row
        rows.append(row)
    return {
        "loss": sum(row["loss"] for row in rows) / len(rows),
        "meanIou": sum(row["iou"] for row in rows) / len(rows),
        "meanCenterPx": sum(row["centerPx"] for row in rows) / len(rows),
        "rows": rows,
    }


def _neighbors(config: Config) -> list[Config]:
    candidates: set[Config] = set()
    for field in ("color", "silhouette", "edge", "scale_prior"):
        for delta in (-0.10, 0.10):
            value = round(max(0.0, getattr(config, field) + delta), 2)
            candidates.add(replace(config, **{field: value}))
    for field, values in (("scale_min", (0.75, 0.80, 0.85, 0.90, 0.95)), ("scale_max", (1.05, 1.10, 1.15, 1.20, 1.25)), ("max_shift", (64, 96, 128, 160))):
        for value in values:
            candidate = replace(config, **{field: value})
            if candidate.scale_min <= candidate.scale_max:
                candidates.add(candidate)
    candidates.discard(config)
    return sorted(candidates, key=lambda item: json.dumps(item.as_dict(), sort_keys=True))


def _hillclimb(
    samples: list[tuple[dict, BirdInputs]],
    cache: dict[tuple[Config, str, str], dict],
    *,
    max_steps: int = 8,
) -> tuple[Config, dict, list[dict]]:
    current = Config()
    current_score = _evaluate(current, samples, cache)
    history = [{"step": 0, "config": current.as_dict(), **{key: current_score[key] for key in ("loss", "meanIou", "meanCenterPx")}}]
    aggregate_cache = {current: current_score}
    for step in range(1, max_steps + 1):
        scored = []
        for candidate in _neighbors(current):
            if candidate not in aggregate_cache:
                aggregate_cache[candidate] = _evaluate(candidate, samples, cache)
            score = aggregate_cache[candidate]
            scored.append((score["loss"], candidate, score))
        _, candidate, score = min(scored, key=lambda item: (item[0], json.dumps(item[1].as_dict(), sort_keys=True)))
        if score["loss"] >= current_score["loss"] - 1e-9:
            break
        current, current_score = candidate, score
        history.append({"step": step, "config": current.as_dict(), **{key: current_score[key] for key in ("loss", "meanIou", "meanCenterPx")}})
    return current, current_score, history


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--levels-root", type=Path, default=DEFAULT_LEVELS)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    samples = [(entry, _load_inputs(args.levels_root, entry)) for entry in manifest["placement"]]
    baseline_config = Config()
    result_cache: dict[tuple[Config, str, str], dict] = {}
    baseline = _evaluate(baseline_config, samples, result_cache)
    winner, winner_score, history = _hillclimb(samples, result_cache)
    print(f"global hillclimb: {baseline['loss']:.4f} -> {winner_score['loss']:.4f}", flush=True)
    folds = []
    levels = sorted({entry["levelId"] for entry, _ in samples})
    for held_out in levels:
        train = [sample for sample in samples if sample[0]["levelId"] != held_out]
        test = [sample for sample in samples if sample[0]["levelId"] == held_out]
        fold_config, train_score, _ = _hillclimb(train, result_cache, max_steps=5)
        held_out_score = _evaluate(fold_config, test, result_cache)
        folds.append({"heldOutLevel": held_out, "config": fold_config.as_dict(), "trainLoss": train_score["loss"], "heldOut": held_out_score})
        print(f"held out {held_out}: {held_out_score['loss']:.4f}", flush=True)
    color_rows = []
    for entry, inputs in samples:
        result = fit_color(inputs, max_shift=160, scales=tuple(round(0.75 + i * 0.05, 2) for i in range(11)))
        predicted = result.get("fittedBox") or list(inputs.sprite_box)
        color_rows.append({"levelId": entry["levelId"], "dogId": entry["dogId"], "predictedBox": predicted, **_box_metrics(predicted, entry["targetBox"])})
    output = {
        "schemaVersion": 1,
        "manifest": str(args.manifest),
        "samples": len(samples),
        "levels": levels,
        "baseline": {"config": baseline_config.as_dict(), **baseline},
        "winner": {"config": winner.as_dict(), **winner_score},
        "history": history,
        "leaveOneLevelOut": folds,
        "colorBaseline": {"loss": sum(row["loss"] for row in color_rows) / len(color_rows), "rows": color_rows},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "baselineLoss": baseline["loss"], "winnerLoss": winner_score["loss"], "winner": winner.as_dict(), "folds": [{"heldOutLevel": fold["heldOutLevel"], "heldOutLoss": fold["heldOut"]["loss"]} for fold in folds]}, indent=2))


if __name__ == "__main__":
    main()
