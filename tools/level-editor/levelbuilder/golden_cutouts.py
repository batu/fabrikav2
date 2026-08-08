"""Validation and loading for the human-reviewed cutout golden dataset.

The manifest keeps four different truths separate: approved final sprites,
placement trials, extraction padding, and redo decisions.  This module is the
single validation boundary used by the CLI and evaluation scripts.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


class GoldenDatasetError(ValueError):
    """The golden manifest or one of its content-addressed assets is invalid."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_asset(level_root: Path, relative: object, *, label: str) -> Path:
    if not isinstance(relative, str) or not relative:
        raise GoldenDatasetError(f"{label} path is missing")
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        raise GoldenDatasetError(f"{label} path escapes its level: {relative!r}")
    resolved = (level_root / path).resolve()
    try:
        resolved.relative_to(level_root.resolve())
    except ValueError as error:
        raise GoldenDatasetError(f"{label} path escapes its level: {relative!r}") from error
    if not resolved.is_file():
        raise GoldenDatasetError(f"{label} is missing: {resolved}")
    return resolved


def _box(value: object, *, label: str) -> tuple[int, int, int, int]:
    if not isinstance(value, list) or len(value) != 4 or any(not isinstance(item, int) for item in value):
        raise GoldenDatasetError(f"{label} must be four integers")
    x0, y0, x1, y1 = value
    if x1 <= x0 or y1 <= y0:
        raise GoldenDatasetError(f"{label} must have positive width and height")
    return x0, y0, x1, y1


def _rows(value: object, *, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise GoldenDatasetError(f"{label} must be an array of objects")
    return value


def cutout_quality_features(
    clean: np.ndarray,
    scene: np.ndarray,
    sprite: Image.Image,
    sprite_box: tuple[int, int, int, int],
    *,
    change_threshold: int = 30,
) -> dict[str, float]:
    """Measure one proposed cutout against aligned clean and painted scenes.

    These features describe quality only; they do not use the human redo label.
    Arrays are full-scene RGB images and ``sprite_box`` is in scene coordinates.
    """

    if clean.shape != scene.shape or clean.ndim != 3 or clean.shape[2] != 3:
        raise ValueError("clean and scene must be aligned HxWx3 arrays")
    x0, y0, x1, y1 = sprite_box
    if not (0 <= x0 < x1 <= scene.shape[1] and 0 <= y0 < y1 <= scene.shape[0]):
        raise ValueError("sprite_box must stay inside the scene")
    width, height = x1 - x0, y1 - y0
    rgba = np.asarray(sprite.convert("RGBA").resize((width, height), Image.Resampling.LANCZOS))
    alpha = rgba[:, :, 3] > 8
    visible = int(alpha.sum())
    area = max(1, width * height)
    clean_crop = clean[y0:y1, x0:x1].astype(np.int16)
    scene_crop = scene[y0:y1, x0:x1].astype(np.int16)
    changed = np.abs(scene_crop - clean_crop).sum(axis=2) > change_threshold
    changed_count = int(changed.sum())
    intersection = int((alpha & changed).sum())
    union = visible + changed_count - intersection

    if visible:
        scene_error = np.abs(rgba[:, :, :3].astype(np.int16) - scene_crop).mean(axis=2)
        clean_error = np.abs(rgba[:, :, :3].astype(np.int16) - clean_crop).mean(axis=2)
        color_similarity = 1.0 - float(scene_error[alpha].mean()) / 255.0
        clean_difference = float(clean_error[alpha].mean()) / 255.0
    else:
        color_similarity = 0.0
        clean_difference = 0.0

    component_count = 0
    speck_fraction = 0.0
    if visible:
        count, _, stats, _ = cv2.connectedComponentsWithStats(alpha.astype(np.uint8), connectivity=8)
        component_areas = sorted((int(stats[index, cv2.CC_STAT_AREA]) for index in range(1, count)), reverse=True)
        component_count = len(component_areas)
        speck_fraction = sum(component_areas[1:]) / visible if len(component_areas) > 1 else 0.0
    edge_pixels = np.concatenate((alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]))

    return {
        "alphaCoverage": visible / area,
        "changedPrecision": intersection / visible if visible else 0.0,
        "changedRecall": intersection / changed_count if changed_count else 0.0,
        "changedIou": intersection / union if union else 0.0,
        "colorSimilarity": max(0.0, min(1.0, color_similarity)),
        "cleanDifference": max(0.0, min(1.0, clean_difference)),
        "componentCount": float(component_count),
        "speckFraction": speck_fraction,
        "edgeTouchFraction": float(edge_pixels.mean()) if edge_pixels.size else 0.0,
        "boxAspect": width / height,
    }


def placement_box_metrics(predicted: list[int], target: list[int]) -> dict[str, float]:
    """Comparable translation/scale loss for one sprite placement."""

    px0, py0, px1, py1 = _box(predicted, label="predicted box")
    tx0, ty0, tx1, ty1 = _box(target, label="target box")
    intersection = max(0, min(px1, tx1) - max(px0, tx0)) * max(0, min(py1, ty1) - max(py0, ty0))
    union = (px1 - px0) * (py1 - py0) + (tx1 - tx0) * (ty1 - ty0) - intersection
    iou = intersection / union if union else 0.0
    center = math.hypot((px0 + px1 - tx0 - tx1) / 2, (py0 + py1 - ty0 - ty1) / 2)
    target_width, target_height = tx1 - tx0, ty1 - ty0
    width_error = abs((px1 - px0) - target_width) / target_width
    height_error = abs((py1 - py0) - target_height) / target_height
    diagonal = max(1.0, math.hypot(target_width, target_height))
    loss = (
        0.5 * (1.0 - iou)
        + 0.25 * min(2.0, center / diagonal)
        + 0.125 * min(2.0, width_error)
        + 0.125 * min(2.0, height_error)
    )
    return {
        "iou": iou,
        "centerPx": center,
        "widthError": width_error,
        "heightError": height_error,
        "loss": loss,
    }


def _portable_logistic(
    model: Any,
    feature_names: list[str],
    threshold: float = 0.5,
    *,
    max_movement_norm: float | None = None,
) -> dict[str, Any]:
    scaler = model.named_steps["standardscaler"]
    classifier = model.named_steps["logisticregression"]
    output = {
        "type": "standardized-logistic-v1",
        "featureNames": feature_names,
        "mean": [float(value) for value in scaler.mean_],
        "scale": [float(value) for value in scaler.scale_],
        "coefficients": [float(value) for value in classifier.coef_[0]],
        "intercept": float(classifier.intercept_[0]),
        "threshold": threshold,
    }
    if max_movement_norm is not None:
        output["maxMovementNorm"] = max_movement_norm
    return output


def predict_portable_logistic(model: dict[str, Any], features: dict[str, float]) -> float:
    """Run a serialized standardized logistic model without loading a pickle."""

    values = [float(features[name]) for name in model["featureNames"]]
    score = float(model["intercept"])
    for value, mean, scale, coefficient in zip(
        values, model["mean"], model["scale"], model["coefficients"], strict=True,
    ):
        score += ((value - mean) / scale if scale else 0.0) * coefficient
    return 1.0 / (1.0 + math.exp(-score))


def _portable_tree_ensemble(
    model: Any,
    feature_names: list[str],
    threshold: float = 0.5,
) -> dict[str, Any]:
    """Serialize a fitted binary sklearn tree ensemble as stable JSON."""

    classes = [int(value) for value in model.classes_]
    if classes != [0, 1]:
        raise ValueError(f"portable tree ensemble requires binary classes [0, 1], got {classes}")
    trees = []
    for estimator in model.estimators_:
        tree = estimator.tree_
        positive_probability = []
        for values in tree.value[:, 0, :]:
            total = float(values.sum())
            positive_probability.append(float(values[1] / total) if total else 0.0)
        trees.append({
            "childrenLeft": [int(value) for value in tree.children_left],
            "childrenRight": [int(value) for value in tree.children_right],
            "feature": [int(value) for value in tree.feature],
            "threshold": [float(value) for value in tree.threshold],
            "positiveProbability": positive_probability,
        })
    return {
        "type": "binary-tree-ensemble-v1",
        "featureNames": feature_names,
        "trees": trees,
        "threshold": threshold,
    }


def predict_portable_tree_ensemble(model: dict[str, Any], features: dict[str, float]) -> float:
    """Run a serialized binary tree ensemble without loading a pickle."""

    values = [float(features[name]) for name in model["featureNames"]]
    probabilities = []
    for tree in model["trees"]:
        node = 0
        while tree["childrenLeft"][node] != tree["childrenRight"][node]:
            feature = tree["feature"][node]
            node = (
                tree["childrenLeft"][node]
                if values[feature] <= tree["threshold"][node]
                else tree["childrenRight"][node]
            )
        probabilities.append(float(tree["positiveProbability"][node]))
    return sum(probabilities) / len(probabilities) if probabilities else 0.0


def should_apply_portable_placement(model: dict[str, Any], features: dict[str, float]) -> bool:
    """Apply a proposed placement only when probability and displacement are safe."""

    if predict_portable_logistic(model, features) < float(model.get("threshold", 0.5)):
        return False
    movement_cap = model.get("maxMovementNorm")
    return movement_cap is None or float(features["hybridMovementNorm"]) <= float(movement_cap)


def validate_manifest(manifest_path: Path, levels_root: Path) -> dict[str, int]:
    """Validate dataset structure, counts, and every current content hash."""

    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise GoldenDatasetError(f"cannot read golden manifest: {error}") from error
    if manifest.get("schemaVersion") != 2:
        raise GoldenDatasetError("golden manifest schemaVersion must be 2")

    reviewed_rows = _rows(manifest.get("reviewedLevels"), label="reviewedLevels")
    reviewed: dict[str, dict[str, Any]] = {}
    for row in reviewed_rows:
        level_id = row.get("levelId")
        if not isinstance(level_id, str) or not level_id:
            raise GoldenDatasetError("reviewed levelId is missing")
        if level_id in reviewed:
            raise GoldenDatasetError(f"duplicate reviewed level: {level_id}")
        level_root = levels_root / level_id
        scene = _safe_asset(level_root, row.get("scene"), label=f"{level_id} scene")
        if _sha256(scene) != row.get("sceneSha256"):
            raise GoldenDatasetError(f"reviewed scene hash mismatch: {level_id}")
        reviewed[level_id] = row

    approved_rows = _rows(manifest.get("approved"), label="approved")
    approved: dict[tuple[str, str], dict[str, Any]] = {}
    for row in approved_rows:
        level_id, dog_id = row.get("levelId"), row.get("dogId")
        if level_id not in reviewed or not isinstance(dog_id, str) or not dog_id:
            raise GoldenDatasetError(f"approved bird references an unknown level or dog: {level_id}/{dog_id}")
        key = (level_id, dog_id)
        if key in approved:
            raise GoldenDatasetError(f"duplicate approved bird: {level_id}/{dog_id}")
        sprite = _safe_asset(levels_root / level_id, row.get("sprite"), label=f"{level_id}/{dog_id} sprite")
        if _sha256(sprite) != row.get("spriteSha256"):
            raise GoldenDatasetError(f"approved sprite hash mismatch: {level_id}/{dog_id}")
        _box(row.get("targetBox"), label=f"{level_id}/{dog_id} targetBox")
        if row.get("placementVerdict") not in {"corrected", "keep"}:
            raise GoldenDatasetError(f"invalid placement verdict: {level_id}/{dog_id}")
        if row.get("extractionVerdict") != "approved":
            raise GoldenDatasetError(f"final extraction is not approved: {level_id}/{dog_id}")
        if row.get("needsRedo") not in {True, False, None}:
            raise GoldenDatasetError(f"invalid needsRedo label: {level_id}/{dog_id}")
        approved[key] = row

    trial_rows = _rows(manifest.get("placementTrials"), label="placementTrials")
    trials: dict[tuple[str, str], dict[str, Any]] = {}
    for row in trial_rows:
        key = (row.get("levelId"), row.get("dogId"))
        if key not in approved:
            raise GoldenDatasetError(f"placement trial has no approved target: {key[0]}/{key[1]}")
        if key in trials:
            raise GoldenDatasetError(f"duplicate placement trial: {key[0]}/{key[1]}")
        _box(row.get("initialBox"), label=f"{key[0]}/{key[1]} initialBox")
        target = _box(row.get("targetBox"), label=f"{key[0]}/{key[1]} targetBox")
        if list(target) != approved[key].get("targetBox"):
            raise GoldenDatasetError(f"placement target mismatch: {key[0]}/{key[1]}")
        if row.get("spriteSha256") != approved[key].get("spriteSha256"):
            raise GoldenDatasetError(f"placement sprite hash mismatch: {key[0]}/{key[1]}")
        if row.get("trialType") not in {"correction", "keep"}:
            raise GoldenDatasetError(f"invalid placement trial type: {key[0]}/{key[1]}")
        trials[key] = row

    for key, row in approved.items():
        available = row.get("placementTrialAvailable") is True
        if available != (key in trials):
            raise GoldenDatasetError(f"placement trial availability mismatch: {key[0]}/{key[1]}")

    for level_id, row in reviewed.items():
        level_approved = [item for item in approved_rows if item["levelId"] == level_id]
        corrected = sum(item["placementVerdict"] == "corrected" for item in level_approved)
        kept = len(level_approved) - corrected
        expected = (row.get("approvedBirds"), row.get("correctedBirds"), row.get("keepBirds"))
        if expected != (len(level_approved), corrected, kept):
            raise GoldenDatasetError(
                f"reviewed level counts mismatch: {level_id} expected {expected}, "
                f"found {(len(level_approved), corrected, kept)}"
            )

    redo_positive = sum(row.get("needsRedo") is True for row in approved_rows)
    redo_negative = sum(row.get("needsRedo") is False for row in approved_rows)
    redo_excluded = len(approved_rows) - redo_positive - redo_negative
    redo = manifest.get("redoDataset") or {}
    if (redo.get("positive"), redo.get("negative"), redo.get("excludedUnconfirmed")) != (
        redo_positive,
        redo_negative,
        redo_excluded,
    ):
        raise GoldenDatasetError("redoDataset summary does not match approved labels")

    return {
        "levels": len(reviewed),
        "approved": len(approved),
        "placementCorrections": sum(row.get("trialType") == "correction" for row in trial_rows),
        "placementKeeps": sum(row.get("trialType") == "keep" for row in trial_rows),
        "placementExcluded": len(approved) - len(trials),
        "redoPositive": redo_positive,
        "redoNegative": redo_negative,
        "redoExcluded": redo_excluded,
    }


def _git_bytes(repo_root: Path, revision: str, path: Path) -> bytes:
    try:
        relative = path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError as error:
        raise GoldenDatasetError(f"review input is outside the repository: {path}") from error
    try:
        return subprocess.check_output(
            ["git", "show", f"{revision}:{relative}"],
            cwd=repo_root,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode(errors="replace").strip()
        raise GoldenDatasetError(f"cannot load frozen review input {revision}:{relative}: {detail}") from error


def load_redo_samples(manifest_path: Path, levels_root: Path) -> tuple[list[str], list[dict[str, Any]]]:
    """Load labeled review inputs and deterministic quality features."""

    validate_manifest(manifest_path, levels_root)
    manifest = json.loads(manifest_path.read_text())
    try:
        repo_root = Path(subprocess.check_output(
            ["git", "-C", str(levels_root), "rev-parse", "--show-toplevel"],
            text=True,
            stderr=subprocess.PIPE,
        ).strip())
    except subprocess.CalledProcessError as error:
        raise GoldenDatasetError("levels root must be inside the repository to load rejected sprites") from error

    feature_names = [
        "alphaCoverage", "changedPrecision", "changedRecall", "changedIou",
        "colorSimilarity", "cleanDifference", "componentCount", "speckFraction",
        "edgeTouchFraction", "boxAspect", "boxAreaFraction",
        "precisionRecallGap", "qualityProduct", "logAreaFraction", "logComponentCount",
    ]
    arrays: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    rows: list[dict[str, Any]] = []
    for entry in manifest["approved"]:
        label = entry.get("needsRedo")
        if label is None:
            continue
        level_id = entry["levelId"]
        level_root = levels_root / level_id
        if level_id not in arrays:
            clean = np.asarray(Image.open(level_root / "bg_00.png").convert("RGB"), dtype=np.uint8)
            scene = np.asarray(Image.open(level_root / "color.png").convert("RGB"), dtype=np.uint8)
            if clean.shape != scene.shape:
                raise GoldenDatasetError(f"clean and painted scenes differ in size: {level_id}")
            arrays[level_id] = clean, scene
        clean, scene = arrays[level_id]
        review = entry.get("reviewInput") or {}
        sprite_path = level_root / entry["sprite"]
        if isinstance(review.get("gitCommit"), str):
            sprite_bytes = _git_bytes(repo_root, review["gitCommit"], sprite_path)
        else:
            sprite_bytes = sprite_path.read_bytes()
        if hashlib.sha256(sprite_bytes).hexdigest() != review.get("spriteSha256"):
            raise GoldenDatasetError(f"review input hash mismatch: {level_id}/{entry['dogId']}")
        with Image.open(io.BytesIO(sprite_bytes)) as source:
            sprite = source.convert("RGBA")
        if review.get("flipX") is True:
            sprite = sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if review.get("flipY") is True:
            sprite = sprite.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        box = _box(review.get("spriteBox"), label=f"{level_id}/{entry['dogId']} reviewInput.spriteBox")
        features = cutout_quality_features(clean, scene, sprite, box)
        features["boxAreaFraction"] = ((box[2] - box[0]) * (box[3] - box[1])) / (scene.shape[0] * scene.shape[1])
        features["precisionRecallGap"] = abs(features["changedPrecision"] - features["changedRecall"])
        features["qualityProduct"] = features["changedIou"] * features["colorSimilarity"]
        features["logAreaFraction"] = math.log(max(1e-9, features["boxAreaFraction"]))
        features["logComponentCount"] = math.log1p(features["componentCount"])
        rows.append({
            "levelId": level_id,
            "dogId": entry["dogId"],
            "label": bool(label),
            "redoAction": entry["redoAction"],
            "features": {name: float(features[name]) for name in feature_names},
        })
        sprite.close()
    return feature_names, rows


def evaluate_redo_classifier(manifest_path: Path, levels_root: Path) -> dict[str, Any]:
    """Evaluate compact redo classifiers with leave-one-level-out predictions."""

    from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
        average_precision_score,
        balanced_accuracy_score,
        confusion_matrix,
        precision_recall_fscore_support,
        roc_auc_score,
    )
    from sklearn.model_selection import LeaveOneGroupOut
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    feature_names, samples = load_redo_samples(manifest_path, levels_root)
    x = np.asarray([[row["features"][name] for name in feature_names] for row in samples], dtype=np.float64)
    y = np.asarray([row["label"] for row in samples], dtype=np.int8)
    groups = np.asarray([row["levelId"] for row in samples])
    models = {
        "logistic-balanced": lambda: make_pipeline(
            StandardScaler(),
            LogisticRegression(C=0.5, class_weight="balanced", max_iter=5000, random_state=0),
        ),
        "forest-shallow-balanced": lambda: RandomForestClassifier(
            n_estimators=500,
            max_depth=3,
            min_samples_leaf=3,
            max_features="sqrt",
            class_weight="balanced_subsample",
            random_state=0,
            n_jobs=1,
        ),
        "extra-trees-depth-4-balanced": lambda: ExtraTreesClassifier(
            n_estimators=500,
            max_depth=4,
            min_samples_leaf=3,
            max_features="sqrt",
            class_weight="balanced",
            random_state=0,
            n_jobs=1,
        ),
    }
    logo = LeaveOneGroupOut()
    results: dict[str, Any] = {}
    for name, factory in models.items():
        probability = np.zeros(len(samples), dtype=np.float64)
        folds = []
        for train, test in logo.split(x, y, groups):
            model = factory()
            model.fit(x[train], y[train])
            probability[test] = model.predict_proba(x[test])[:, 1]
            folds.append({
                "heldOutLevel": str(groups[test][0]),
                "train": int(len(train)),
                "test": int(len(test)),
                "positives": int(y[test].sum()),
            })
        prediction = probability >= 0.5
        precision, recall, f1, _ = precision_recall_fscore_support(
            y, prediction, average="binary", zero_division=0,
        )
        tn, fp, fn, tp = confusion_matrix(y, prediction, labels=[0, 1]).ravel()
        results[name] = {
            "threshold": 0.5,
            "balancedAccuracy": float(balanced_accuracy_score(y, prediction)),
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "rocAuc": float(roc_auc_score(y, probability)),
            "averagePrecision": float(average_precision_score(y, probability)),
            "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
            "folds": folds,
            "predictions": [
                {
                    "levelId": row["levelId"],
                    "dogId": row["dogId"],
                    "actual": bool(row["label"]),
                    "probability": round(float(probability[index]), 6),
                    "predicted": bool(prediction[index]),
                }
                for index, row in enumerate(samples)
            ],
        }
    winner_name = max(results, key=lambda key: (results[key]["averagePrecision"], results[key]["f1"]))
    production = models[winner_name]()
    production.fit(x, y)
    production_model = (
        _portable_logistic(production, feature_names)
        if winner_name == "logistic-balanced"
        else _portable_tree_ensemble(production, feature_names)
    )
    return {
        "schemaVersion": 1,
        "split": "leave-one-level-out",
        "levels": sorted(set(groups.tolist())),
        "samples": len(samples),
        "positive": int(y.sum()),
        "negative": int(len(y) - y.sum()),
        "featureNames": feature_names,
        "models": results,
        "winner": winner_name,
        "recommendedProduction": winner_name,
        "predictionMode": "review-ranking-only",
        "productionModel": production_model,
    }


def _load_placement_samples(manifest_path: Path, levels_root: Path) -> list[dict[str, Any]]:
    from levelbuilder.api.sprite_eval import BirdInputs

    validate_manifest(manifest_path, levels_root)
    manifest = json.loads(manifest_path.read_text())
    level_cache: dict[str, tuple[dict[str, Any], np.ndarray, np.ndarray]] = {}
    samples = []
    for trial in manifest["placementTrials"]:
        level_id = trial["levelId"]
        level_root = levels_root / level_id
        if level_id not in level_cache:
            level = json.loads((level_root / "level.json").read_text())
            clean = np.asarray(Image.open(level_root / "bg_00.png").convert("RGB"), dtype=np.uint8)
            scene = np.asarray(Image.open(level_root / "color.png").convert("RGB"), dtype=np.uint8)
            if clean.shape != scene.shape:
                raise GoldenDatasetError(f"clean and painted scenes differ in size: {level_id}")
            level_cache[level_id] = level, clean, scene
        level, clean, scene = level_cache[level_id]
        dog = next((item for item in level.get("dogs", []) if item.get("id") == trial["dogId"]), None)
        if dog is None or not isinstance(dog.get("sprite"), dict):
            raise GoldenDatasetError(f"placement dog is missing from level.json: {level_id}/{trial['dogId']}")
        current = dog["sprite"]
        sprite_path = level_root / trial["sprite"]
        if _sha256(sprite_path) != trial["spriteSha256"]:
            raise GoldenDatasetError(f"placement sprite hash mismatch: {level_id}/{trial['dogId']}")
        sprite = Image.open(sprite_path).convert("RGBA")
        if trial.get("initialFlipX") is True:
            sprite = sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if trial.get("initialFlipY") is True:
            sprite = sprite.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        initial = tuple(int(value) for value in trial["initialBox"])
        target = tuple(int(value) for value in trial["targetBox"])
        target_point = (
            round(float(current["x"]) + float(current.get("anchorX", 0.5)) * float(current["width"])),
            round(float(current["y"]) + float(current.get("anchorY", 0.5)) * float(current["height"])),
        )
        sidecar = json.loads(sprite_path.with_suffix(".json").read_text())
        source = sidecar.get("sourceBox") or sidecar.get("cleanupBox") or list(initial)
        pad = max(initial[2] - initial[0], initial[3] - initial[1], target[2] - target[0], target[3] - target[1]) + 160
        crop = (
            max(0, min(int(source[0]), initial[0] - 160, target[0] - 96, target_point[0] - pad)),
            max(0, min(int(source[1]), initial[1] - 160, target[1] - 96, target_point[1] - pad)),
            min(scene.shape[1], max(int(source[2]), initial[2] + 160, target[2] + 96, target_point[0] + pad)),
            min(scene.shape[0], max(int(source[3]), initial[3] + 160, target[3] + 96, target_point[1] + pad)),
        )
        neighbors = []
        for other in level.get("dogs", []):
            if other.get("id") == trial["dogId"] or not isinstance(other.get("sprite"), dict):
                continue
            value = other["sprite"]
            neighbors.append((
                int(value["x"]), int(value["y"]),
                int(value["x"] + value["width"]), int(value["y"] + value["height"]),
            ))
        x0, y0, x1, y1 = crop
        samples.append({
            "trial": trial,
            "inputs": BirdInputs(
                dog_id=trial["dogId"],
                sprite=sprite,
                sprite_box=initial,
                crop_box=crop,
                clean_crop=clean[y0:y1, x0:x1],
                scene_crop=scene[y0:y1, x0:x1],
                neighbor_boxes=tuple(neighbors),
                target_point=target_point,
            ),
        })
    return samples


def _placement_summary(rows: list[dict[str, Any]], predicted_key: str) -> dict[str, Any]:
    scored = []
    for row in rows:
        metrics = placement_box_metrics(row[predicted_key], row["targetBox"])
        flip_error = float(
            bool(row.get("predictedFlipX", row["initialFlipX"])) != bool(row["targetFlipX"])
        ) + float(
            bool(row.get("predictedFlipY", row["initialFlipY"])) != bool(row["targetFlipY"])
        )
        scored.append({**row, **metrics, "flipError": flip_error, "totalLoss": metrics["loss"] + 0.1 * flip_error})

    def means(subset: list[dict[str, Any]]) -> dict[str, float]:
        if not subset:
            return {"loss": 0.0, "iou": 0.0, "centerPx": 0.0, "flipError": 0.0}
        return {
            "loss": float(np.mean([row["totalLoss"] for row in subset])),
            "iou": float(np.mean([row["iou"] for row in subset])),
            "centerPx": float(np.mean([row["centerPx"] for row in subset])),
            "flipError": float(np.mean([row["flipError"] for row in subset])),
        }

    corrections = [row for row in scored if row["trialType"] == "correction"]
    keeps = [row for row in scored if row["trialType"] == "keep"]
    return {
        "all": means(scored),
        "corrections": means(corrections),
        "keeps": means(keeps),
        "balancedLoss": 0.5 * means(corrections)["loss"] + 0.5 * means(keeps)["loss"],
        "rows": scored,
    }


def _selector_predictions(
    rows: list[dict[str, Any]], method: str, threshold: float, movement_cap: float,
) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        candidate = row[method]
        proposed = candidate["fittedBox"]
        initial = row["initialBox"]
        movement = math.hypot(
            (proposed[0] + proposed[2] - initial[0] - initial[2]) / 2,
            (proposed[1] + proposed[3] - initial[1] - initial[3]) / 2,
        )
        applied = float(candidate.get("score") or 0.0) >= threshold and movement <= movement_cap
        output.append({**row, "selectedBox": proposed if applied else initial, "applied": applied})
    return output


def evaluate_placement_trials(
    manifest_path: Path,
    levels_root: Path,
    *,
    workers: int = 4,
) -> dict[str, Any]:
    """Compare placement matchers and tune conservative selectors by held-out level."""

    from levelbuilder.api.sprite_eval import fit_color, fit_hybrid

    samples = _load_placement_samples(manifest_path, levels_root)

    def propose(sample: dict[str, Any]) -> dict[str, Any]:
        trial = sample["trial"]
        inputs = sample["inputs"]
        scales = tuple(round(0.75 + index * 0.05, 2) for index in range(11))
        color = fit_color(inputs, max_shift=160, scales=scales)
        hybrid = fit_hybrid(inputs, max_shift=160, scales=scales)
        cx0, cy0, _, _ = inputs.crop_box
        sx0, sy0, sx1, sy1 = inputs.sprite_box
        quality = cutout_quality_features(
            inputs.clean_crop,
            inputs.scene_crop,
            inputs.sprite,
            (sx0 - cx0, sy0 - cy0, sx1 - cx0, sy1 - cy0),
        )
        fitted = hybrid.get("fittedBox") or list(trial["initialBox"])
        width, height = max(1, sx1 - sx0), max(1, sy1 - sy0)
        movement = math.hypot(
            (fitted[0] + fitted[2] - sx0 - sx1) / 2,
            (fitted[1] + fitted[3] - sy0 - sy1) / 2,
        )
        components = hybrid.get("components") or {}
        selection_features = {
            **quality,
            "hybridScore": float(hybrid.get("score") or 0.0),
            "hybridColor": float(components.get("color") or 0.0),
            "hybridSilhouette": float(components.get("silhouette") or 0.0),
            "hybridEdge": float(components.get("edge") or 0.0),
            "hybridScale": float(hybrid.get("scale") or 1.0),
            "hybridMovementNorm": movement / math.hypot(width, height),
            "colorScore": float(color.get("score") or 0.0),
        }
        return {
            **trial,
            "color": color,
            "hybrid": hybrid,
            "selectionFeatures": selection_features,
            "initialPrediction": list(trial["initialBox"]),
            "colorPrediction": color.get("fittedBox") or list(trial["initialBox"]),
            "hybridPrediction": hybrid.get("fittedBox") or list(trial["initialBox"]),
        }

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        rows = list(pool.map(propose, samples))
    for sample in samples:
        sample["inputs"].sprite.close()

    baseline = _placement_summary(rows, "initialPrediction")
    raw = {
        "color": _placement_summary(rows, "colorPrediction"),
        "hybrid": _placement_summary(rows, "hybridPrediction"),
    }
    levels = sorted({row["levelId"] for row in rows})
    selectors = {}
    for method in ("color", "hybrid"):
        selected_rows = []
        folds = []
        for held_out in levels:
            train = [row for row in rows if row["levelId"] != held_out]
            test = [row for row in rows if row["levelId"] == held_out]
            choices = []
            for threshold in tuple(round(0.35 + index * 0.05, 2) for index in range(14)) + (1.01,):
                for cap in (24.0, 48.0, 72.0, 96.0, 128.0, 192.0, 10_000.0):
                    candidate = _selector_predictions(train, method, threshold, cap)
                    score = _placement_summary(candidate, "selectedBox")
                    choices.append((score["balancedLoss"], -threshold, cap, threshold, score))
            _, _, cap, threshold, train_score = min(choices, key=lambda item: item[:3])
            selected = _selector_predictions(test, method, threshold, cap)
            selected_rows.extend(selected)
            folds.append({
                "heldOutLevel": held_out,
                "threshold": threshold,
                "movementCap": cap,
                "trainBalancedLoss": train_score["balancedLoss"],
                "applied": sum(row["applied"] for row in selected),
                "test": len(selected),
            })
        selectors[method] = {**_placement_summary(selected_rows, "selectedBox"), "folds": folds}

    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    selection_feature_names = list(rows[0]["selectionFeatures"])
    selection_x = np.asarray([
        [row["selectionFeatures"][name] for name in selection_feature_names]
        for row in rows
    ], dtype=np.float64)
    selection_y = np.asarray([row["trialType"] == "correction" for row in rows], dtype=np.int8)
    learned_factories = {
        "logistic-hybrid": lambda: make_pipeline(
            StandardScaler(),
            LogisticRegression(C=0.5, class_weight="balanced", max_iter=5000, random_state=0),
        ),
        "forest-hybrid": lambda: RandomForestClassifier(
            n_estimators=500, max_depth=3, min_samples_leaf=3, max_features="sqrt",
            class_weight="balanced_subsample", random_state=0, n_jobs=1,
        ),
    }
    learned_selectors = {}
    for name, factory in learned_factories.items():
        selected_rows = []
        predictions = []
        folds = []
        for held_out in levels:
            train_indices = [index for index, row in enumerate(rows) if row["levelId"] != held_out]
            test_indices = [index for index, row in enumerate(rows) if row["levelId"] == held_out]
            model = factory()
            model.fit(selection_x[train_indices], selection_y[train_indices])
            probability = model.predict_proba(selection_x[test_indices])[:, 1]
            fold_rows = []
            for index, score in zip(test_indices, probability):
                applied = float(score) >= 0.5
                row = {
                    **rows[index],
                    "selectedBox": rows[index]["hybridPrediction"] if applied else rows[index]["initialBox"],
                    "applied": applied,
                }
                fold_rows.append(row)
                selected_rows.append(row)
                predictions.append({
                    "levelId": row["levelId"], "dogId": row["dogId"],
                    "actualCorrection": row["trialType"] == "correction",
                    "probability": round(float(score), 6), "applied": applied,
                })
            folds.append({
                "heldOutLevel": held_out,
                "test": len(fold_rows),
                "corrections": sum(row["trialType"] == "correction" for row in fold_rows),
                "applied": sum(row["applied"] for row in fold_rows),
            })
        learned_selectors[name] = {
            **_placement_summary(selected_rows, "selectedBox"),
            "threshold": 0.5,
            "folds": folds,
            "predictions": predictions,
        }
    # A score alone can approve a visually catastrophic jump to a neighboring
    # bird.  Keep the portable model, but use a deliberately conservative
    # probability threshold and a box-diagonal-normalized displacement cap.
    # The cap still admits the largest known beneficial correction (0.385) and
    # rejects the observed wrong-bird jump (0.604).
    safe_threshold = 0.6
    safe_movement_cap = 0.45
    logistic_predictions = {
        (row["levelId"], row["dogId"]): row
        for row in learned_selectors["logistic-hybrid"]["predictions"]
    }
    safe_rows = []
    safe_predictions = []
    for row in rows:
        prediction = logistic_predictions[(row["levelId"], row["dogId"])]
        applied = (
            float(prediction["probability"]) >= safe_threshold
            and float(row["selectionFeatures"]["hybridMovementNorm"]) <= safe_movement_cap
        )
        safe_rows.append({
            **row,
            "selectedBox": row["hybridPrediction"] if applied else row["initialBox"],
            "applied": applied,
        })
        safe_predictions.append({
            **prediction,
            "applied": applied,
            "movementNorm": round(float(row["selectionFeatures"]["hybridMovementNorm"]), 6),
        })
    learned_selectors["logistic-hybrid-safe"] = {
        **_placement_summary(safe_rows, "selectedBox"),
        "threshold": safe_threshold,
        "maxMovementNorm": safe_movement_cap,
        "folds": learned_selectors["logistic-hybrid"]["folds"],
        "predictions": safe_predictions,
    }
    production_selector = learned_factories["logistic-hybrid"]()
    production_selector.fit(selection_x, selection_y)

    def compact(summary: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in summary.items() if key != "rows"}

    return {
        "schemaVersion": 1,
        "split": "leave-one-level-out",
        "levels": levels,
        "samples": len(rows),
        "corrections": sum(row["trialType"] == "correction" for row in rows),
        "keeps": sum(row["trialType"] == "keep" for row in rows),
        "baseline": compact(baseline),
        "raw": {name: compact(summary) for name, summary in raw.items()},
        "selectors": {
            name: {**compact(summary), "folds": summary["folds"]}
            for name, summary in selectors.items()
        },
        "selectionFeatureNames": selection_feature_names,
        "learnedSelectors": {
            name: {**compact(summary), "folds": summary["folds"], "predictions": summary["predictions"]}
            for name, summary in learned_selectors.items()
        },
        "recommendedProduction": "logistic-hybrid-safe",
        "productionModel": _portable_logistic(
            production_selector,
            selection_feature_names,
            threshold=safe_threshold,
            max_movement_norm=safe_movement_cap,
        ),
        "rows": [
            {
                **row,
                "baselineMetrics": placement_box_metrics(row["initialPrediction"], row["targetBox"]),
                "colorMetrics": placement_box_metrics(row["colorPrediction"], row["targetBox"]),
                "hybridMetrics": placement_box_metrics(row["hybridPrediction"], row["targetBox"]),
            }
            for row in rows
        ],
    }
