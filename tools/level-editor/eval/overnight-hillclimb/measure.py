from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import (
    ExtraTreesClassifier,
    GradientBoostingClassifier,
    HistGradientBoostingClassifier,
    RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    balanced_accuracy_score,
    precision_recall_fscore_support,
    roc_auc_score,
)
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import PolynomialFeatures, StandardScaler
from sklearn.svm import SVC

from levelbuilder.golden_cutouts import load_redo_samples, validate_manifest


HERE = Path(__file__).resolve().parent
EDITOR_ROOT = HERE.parents[1]
REPO_ROOT = EDITOR_ROOT.parents[1]
MANIFEST = EDITOR_ROOT / "eval/golden-cutout-placement-v1/manifest.json"
PLACEMENT_ROWS = EDITOR_ROOT / "eval/results/golden-cutout-v1/placement-evaluation.json"
LEVELS_ROOT = REPO_ROOT / "games/find_the_bird/public/levels"


def _iou(left: list[int], right: list[int]) -> float:
    intersection = max(0, min(left[2], right[2]) - max(left[0], right[0])) * max(
        0, min(left[3], right[3]) - max(left[1], right[1]),
    )
    union = (
        (left[2] - left[0]) * (left[3] - left[1])
        + (right[2] - right[0]) * (right[3] - right[1])
        - intersection
    )
    return intersection / union if union else 0.0


def _engineered(features: dict[str, float]) -> dict[str, float]:
    output = dict(features)
    if "hybridScale" in features:
        output.update({
            "scaleDeviation": abs(math.log(max(1e-6, features["hybridScale"]))),
            "movementSquared": features["hybridMovementNorm"] ** 2,
            "hybridColorGap": features["hybridScore"] - features["colorScore"],
            "colorSilhouetteProduct": features["hybridColor"] * features["hybridSilhouette"],
            "qualityProduct": features["changedIou"] * features["colorSimilarity"],
        })
    else:
        output.update({
            "precisionRecallGap": abs(features["changedPrecision"] - features["changedRecall"]),
            "qualityProduct": features["changedIou"] * features["colorSimilarity"],
            "logAreaFraction": math.log(max(1e-9, features["boxAreaFraction"])),
            "logComponentCount": math.log1p(features["componentCount"]),
        })
    return output


def _feature_matrix(
    rows: list[dict[str, Any]], config: dict[str, Any], *, placement: bool,
) -> tuple[np.ndarray, list[str]]:
    expanded = [_engineered(row["selectionFeatures"] if placement else row["features"]) for row in rows]
    base = list(expanded[0])
    feature_set = config.get("featureSet", "all")
    if feature_set == "quality":
        names = [name for name in base if not name.startswith(("hybrid", "colorScore", "scale", "movement"))]
    elif feature_set == "matcher":
        names = [
            name for name in base
            if name.startswith(("hybrid", "colorScore", "scale", "movement", "colorSilhouette"))
        ]
    elif feature_set == "compact":
        requested = (
            ["changedPrecision", "changedRecall", "changedIou", "colorSimilarity", "alphaCoverage",
             "hybridScore", "hybridSilhouette", "hybridEdge", "hybridMovementNorm", "scaleDeviation"]
            if placement else
            ["changedPrecision", "changedRecall", "changedIou", "colorSimilarity", "cleanDifference",
             "alphaCoverage", "speckFraction", "edgeTouchFraction", "boxAreaFraction"]
        )
        names = [name for name in requested if name in base]
    else:
        names = base
    dropped = set(config.get("featureDrop", []))
    names = [name for name in names if name not in dropped]
    if not names:
        raise ValueError("feature selection removed every feature")
    values = np.asarray([[float(row[name]) for name in names] for row in expanded], dtype=np.float64)
    if config.get("polynomialDegree", 1) > 1:
        degree = int(config["polynomialDegree"])
        transform = PolynomialFeatures(degree=degree, include_bias=False)
        values = transform.fit_transform(values)
        names = list(transform.get_feature_names_out(names))
    return values, names


def _model(config: dict[str, Any]) -> Any:
    name = config.get("model", "logistic")
    class_weight = config.get("classWeight", "balanced")
    class_weight = None if class_weight in {None, "none"} else class_weight
    if name == "logistic":
        return make_pipeline(
            StandardScaler(),
            LogisticRegression(
                C=float(config.get("C", 0.5)),
                class_weight=class_weight,
                max_iter=5000,
                penalty=config.get("penalty", "l2"),
                solver="liblinear" if config.get("penalty") == "l1" else "lbfgs",
                random_state=0,
            ),
        )
    if name == "forest":
        return RandomForestClassifier(
            n_estimators=int(config.get("estimators", 500)),
            max_depth=config.get("maxDepth", 3),
            min_samples_leaf=int(config.get("minLeaf", 3)),
            max_features=config.get("maxFeatures", "sqrt"),
            class_weight="balanced_subsample" if class_weight else None,
            random_state=0,
            n_jobs=1,
        )
    if name == "extra_trees":
        return ExtraTreesClassifier(
            n_estimators=int(config.get("estimators", 500)),
            max_depth=config.get("maxDepth", 4),
            min_samples_leaf=int(config.get("minLeaf", 3)),
            max_features=config.get("maxFeatures", "sqrt"),
            class_weight=class_weight,
            random_state=0,
            n_jobs=1,
        )
    if name == "gradient_boosting":
        return GradientBoostingClassifier(
            n_estimators=int(config.get("estimators", 100)),
            learning_rate=float(config.get("learningRate", 0.05)),
            max_depth=int(config.get("maxDepth", 2)),
            min_samples_leaf=int(config.get("minLeaf", 3)),
            random_state=0,
        )
    if name == "hist_gradient_boosting":
        return HistGradientBoostingClassifier(
            learning_rate=float(config.get("learningRate", 0.08)),
            max_iter=int(config.get("estimators", 100)),
            max_depth=config.get("maxDepth", 3),
            min_samples_leaf=int(config.get("minLeaf", 8)),
            l2_regularization=float(config.get("l2", 0.1)),
            class_weight=class_weight,
            random_state=0,
        )
    if name == "svc":
        return make_pipeline(
            StandardScaler(),
            SVC(
                C=float(config.get("C", 1.0)),
                gamma=config.get("gamma", "scale"),
                kernel=config.get("kernel", "rbf"),
                class_weight=class_weight,
                probability=True,
                random_state=0,
            ),
        )
    if name == "knn":
        return make_pipeline(
            StandardScaler(),
            KNeighborsClassifier(
                n_neighbors=int(config.get("neighbors", 9)),
                weights=config.get("weights", "distance"),
                p=int(config.get("p", 2)),
            ),
        )
    raise ValueError(f"unknown model: {name}")


def _sample_weights(y: np.ndarray) -> np.ndarray:
    positives = max(1, int(y.sum()))
    negatives = max(1, int(len(y) - y.sum()))
    return np.where(y == 1, len(y) / (2 * positives), len(y) / (2 * negatives))


def _fit(model: Any, x: np.ndarray, y: np.ndarray, config: dict[str, Any]) -> Any:
    if config.get("model") == "gradient_boosting" and config.get("classWeight", "balanced") == "balanced":
        model.fit(x, y, sample_weight=_sample_weights(y))
    else:
        model.fit(x, y)
    return model


def _probability(model: Any, x: np.ndarray) -> np.ndarray:
    return np.asarray(model.predict_proba(x)[:, 1], dtype=np.float64)


def _placement_labels(rows: list[dict[str, Any]], config: dict[str, Any]) -> np.ndarray:
    label = config.get("label", "correction")
    if label == "correction":
        return np.asarray([row["trialType"] == "correction" for row in rows], dtype=np.int8)
    if label == "improvement":
        margin = float(config.get("minImprovement", 0.0))
        return np.asarray([
            row["baselineMetrics"]["loss"] - row["hybridMetrics"]["loss"] > margin
            for row in rows
        ], dtype=np.int8)
    raise ValueError(f"unknown placement label: {label}")


def _collision_guard(
    rows: list[dict[str, Any]], applied: list[bool], probability: list[float], threshold: float,
) -> list[bool]:
    output = [False] * len(rows)
    current = [list(row["initialBox"]) for row in rows]
    for index in sorted(range(len(rows)), key=lambda item: probability[item], reverse=True):
        if not applied[index]:
            continue
        proposed = rows[index]["hybridPrediction"]
        collision = any(
            other != index
            and _iou(proposed, current[other]) >= threshold
            and _iou(rows[index]["initialBox"], rows[other]["initialBox"]) < 0.1
            for other in range(len(rows))
        )
        if not collision:
            output[index] = True
            current[index] = proposed
    return output


def _apply_policy(
    rows: list[dict[str, Any]], probability: np.ndarray, config: dict[str, Any], threshold: float, cap: float,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    by_level: dict[str, list[int]] = defaultdict(list)
    proposed = []
    for index, row in enumerate(rows):
        applied = bool(
            probability[index] >= threshold
            and row["selectionFeatures"]["hybridMovementNorm"] <= cap
        )
        proposed.append(applied)
        by_level[row["levelId"]].append(index)
    if config.get("collisionGuard", False):
        guarded = [False] * len(rows)
        for indices in by_level.values():
            local = _collision_guard(
                [rows[index] for index in indices],
                [proposed[index] for index in indices],
                [float(probability[index]) for index in indices],
                float(config.get("collisionIou", 0.35)),
            )
            for index, accepted in zip(indices, local, strict=True):
                guarded[index] = accepted
        proposed = guarded
    for row, score, applied in zip(rows, probability, proposed, strict=True):
        output.append({**row, "probability": float(score), "applied": applied})
    return output


def _placement_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    scored = []
    by_level: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        metrics = row["hybridMetrics"] if row["applied"] else row["baselineMetrics"]
        flip_error = float(bool(row["initialFlipX"]) != bool(row["targetFlipX"])) + float(
            bool(row["initialFlipY"]) != bool(row["targetFlipY"]),
        )
        loss = float(metrics["loss"]) + 0.1 * flip_error
        scored.append((row, metrics, loss))
        by_level[row["levelId"]].append(loss)
    corrections = [(row, metrics, loss) for row, metrics, loss in scored if row["trialType"] == "correction"]
    keeps = [(row, metrics, loss) for row, metrics, loss in scored if row["trialType"] == "keep"]

    def mean(group: list[tuple[dict[str, Any], dict[str, float], float]], key: str) -> float:
        return float(np.mean([metrics[key] for _, metrics, _ in group]))

    correction_loss = float(np.mean([loss for _, _, loss in corrections]))
    keep_loss = float(np.mean([loss for _, _, loss in keeps]))
    selected = [row for row, _, _ in scored if row["applied"]]
    wrong_jumps = sum(row["selectionFeatures"]["hybridMovementNorm"] > 0.45 for row in selected)
    duplicate_claims = 0
    identity_errors = 0
    selected_by_level: dict[str, list[dict[str, Any]]] = defaultdict(list)
    all_by_level: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row, _, _ in scored:
        all_by_level[row["levelId"]].append(row)
        if row["applied"]:
            selected_by_level[row["levelId"]].append(row)
    for level_id, level_selected in selected_by_level.items():
        for index, row in enumerate(level_selected):
            for other in level_selected[index + 1:]:
                if (
                    _iou(row["hybridPrediction"], other["hybridPrediction"]) >= 0.35
                    and _iou(row["initialBox"], other["initialBox"]) < 0.1
                ):
                    duplicate_claims += 1
            own = _iou(row["hybridPrediction"], row["targetBox"])
            best_other = max(
                (_iou(row["hybridPrediction"], other["targetBox"]) for other in all_by_level[level_id]
                 if other["dogId"] != row["dogId"]),
                default=0.0,
            )
            if best_other > own + 0.05:
                identity_errors += 1
    return {
        "balancedLoss": 0.5 * (correction_loss + keep_loss),
        "correctionIou": mean(corrections, "iou"),
        "keepIou": mean(keeps, "iou"),
        "correctionCenterPx": mean(corrections, "centerPx"),
        "keepCenterPx": mean(keeps, "centerPx"),
        "wrongNeighborJumps": wrong_jumps,
        "duplicateTargetClaims": duplicate_claims,
        "targetIdentityErrors": identity_errors,
        "worstLevelLoss": max(float(np.mean(values)) for values in by_level.values()),
        "maxBirdLoss": max(loss for _, _, loss in scored),
        "applied": len(selected),
    }


def _policy_key(summary: dict[str, Any], threshold: float, cap: float) -> tuple[Any, ...]:
    violations = (
        summary["wrongNeighborJumps"]
        + summary["duplicateTargetClaims"]
        + summary["targetIdentityErrors"]
        + int(summary["keepIou"] < 0.975)
        + int(summary["correctionIou"] < 0.7)
    )
    return violations, summary["balancedLoss"], summary["worstLevelLoss"], -threshold, cap


def evaluate_placement(config: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(PLACEMENT_ROWS.read_text())
    rows = payload["rows"]
    x, feature_names = _feature_matrix(rows, config, placement=True)
    y = _placement_labels(rows, config)
    levels = sorted({row["levelId"] for row in rows})
    selected_rows: list[dict[str, Any]] = []
    folds = []
    for held_out in levels:
        train_indices = [index for index, row in enumerate(rows) if row["levelId"] != held_out]
        test_indices = [index for index, row in enumerate(rows) if row["levelId"] == held_out]
        inner_probability = np.zeros(len(train_indices), dtype=np.float64)
        train_levels = sorted({rows[index]["levelId"] for index in train_indices})
        for inner_held_out in train_levels:
            inner_train_positions = [
                position for position, index in enumerate(train_indices)
                if rows[index]["levelId"] != inner_held_out
            ]
            inner_test_positions = [
                position for position, index in enumerate(train_indices)
                if rows[index]["levelId"] == inner_held_out
            ]
            inner_train = [train_indices[position] for position in inner_train_positions]
            inner_test = [train_indices[position] for position in inner_test_positions]
            model = _fit(_model(config), x[inner_train], y[inner_train], config)
            inner_probability[inner_test_positions] = _probability(model, x[inner_test])
        inner_rows = [rows[index] for index in train_indices]
        choices = []
        for threshold in config.get("thresholds", [0.5, 0.6, 0.7, 0.8]):
            for cap in config.get("movementCaps", [0.25, 0.35, 0.45]):
                selected = _apply_policy(inner_rows, inner_probability, config, float(threshold), float(cap))
                summary = _placement_summary(selected)
                choices.append((_policy_key(summary, float(threshold), float(cap)), float(threshold), float(cap)))
        _, threshold, cap = min(choices, key=lambda item: item[0])
        outer_model = _fit(_model(config), x[train_indices], y[train_indices], config)
        probability = _probability(outer_model, x[test_indices])
        selected = _apply_policy(
            [rows[index] for index in test_indices], probability, config, threshold, cap,
        )
        selected_rows.extend(selected)
        folds.append({
            "heldOutLevel": held_out,
            "threshold": threshold,
            "movementCap": cap,
            "applied": sum(row["applied"] for row in selected),
        })
    summary = _placement_summary(selected_rows)
    summary["featureCount"] = len(feature_names)
    summary["folds"] = folds
    return summary, selected_rows


def evaluate_redo(config: dict[str, Any]) -> dict[str, Any]:
    _, rows = load_redo_samples(MANIFEST, LEVELS_ROOT)
    x, feature_names = _feature_matrix(rows, config, placement=False)
    y = np.asarray([row["label"] for row in rows], dtype=np.int8)
    levels = sorted({row["levelId"] for row in rows})
    probability = np.zeros(len(rows), dtype=np.float64)
    for held_out in levels:
        train = [index for index, row in enumerate(rows) if row["levelId"] != held_out]
        test = [index for index, row in enumerate(rows) if row["levelId"] == held_out]
        model = _fit(_model(config), x[train], y[train], config)
        probability[test] = _probability(model, x[test])
    threshold = float(config.get("threshold", 0.5))
    prediction = probability >= threshold
    precision, recall, f1, _ = precision_recall_fscore_support(
        y, prediction, average="binary", zero_division=0,
    )
    return {
        "averagePrecision": float(average_precision_score(y, probability)),
        "rocAuc": float(roc_auc_score(y, probability)),
        "balancedAccuracy": float(balanced_accuracy_score(y, prediction)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "featureCount": len(feature_names),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    arguments = parser.parse_args()
    started = time.monotonic()
    config_bytes = arguments.config.read_bytes()
    config = json.loads(config_bytes)
    validation = validate_manifest(MANIFEST, LEVELS_ROOT)
    placement, selected_rows = evaluate_placement(config["placement"])
    redo = evaluate_redo(config["redo"])
    redo_weight = float(config.get("redoWeight", 0.05))
    output = {
        "config_name": config.get("name", arguments.config.stem),
        "config_sha256": hashlib.sha256(config_bytes).hexdigest(),
        "manifest_sha256": hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
        "manifest_valid": int(validation["approved"] == 162),
        "objective_loss": placement["balancedLoss"] + redo_weight * (1.0 - redo["averagePrecision"]),
        "placement_balanced_loss": placement["balancedLoss"],
        "correction_iou": placement["correctionIou"],
        "keep_iou": placement["keepIou"],
        "correction_center_px": placement["correctionCenterPx"],
        "wrong_neighbor_jumps": placement["wrongNeighborJumps"],
        "duplicate_target_claims": placement["duplicateTargetClaims"],
        "target_identity_errors": placement["targetIdentityErrors"],
        "worst_level_loss": placement["worstLevelLoss"],
        "max_bird_loss": placement["maxBirdLoss"],
        "placement_apply_count": placement["applied"],
        "placement_feature_count": placement["featureCount"],
        "redo_average_precision": redo["averagePrecision"],
        "redo_roc_auc": redo["rocAuc"],
        "redo_precision": redo["precision"],
        "redo_recall": redo["recall"],
        "redo_f1": redo["f1"],
        "redo_feature_count": redo["featureCount"],
        "runtime_seconds": time.monotonic() - started,
        "fold_policies": placement["folds"],
        "changed_placements": [
            {
                "levelId": row["levelId"],
                "dogId": row["dogId"],
                "trialType": row["trialType"],
                "probability": row["probability"],
                "movementNorm": row["selectionFeatures"]["hybridMovementNorm"],
                "initialBox": row["initialBox"],
                "selectedBox": row["hybridPrediction"],
                "targetBox": row["targetBox"],
            }
            for row in selected_rows if row["applied"]
        ],
    }
    print(json.dumps(output, sort_keys=True))


if __name__ == "__main__":
    main()
