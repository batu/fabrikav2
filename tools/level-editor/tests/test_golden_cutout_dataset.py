import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from levelbuilder.golden_cutouts import (
    _portable_tree_ensemble,
    GoldenDatasetError,
    cutout_quality_features,
    evaluate_redo_classifier,
    placement_box_metrics,
    predict_portable_logistic,
    predict_portable_tree_ensemble,
    should_apply_portable_placement,
    validate_manifest,
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fixture(tmp_path):
    levels = tmp_path / "levels"
    level = levels / "level_a"
    sprite = level / "dogs" / "dog_00" / "sprite_000.png"
    sprite.parent.mkdir(parents=True)
    sprite.write_bytes(b"approved-sprite")
    (level / "color.png").write_bytes(b"scene")
    manifest = {
        "schemaVersion": 2,
        "reviewedLevels": [{
            "levelId": "level_a",
            "approvedBirds": 1,
            "correctedBirds": 0,
            "keepBirds": 1,
            "scene": "color.png",
            "sceneSha256": _sha(b"scene"),
            "approval": "full-level-human-review",
        }],
        "approved": [{
            "levelId": "level_a",
            "dogId": "dog_00",
            "sprite": "dogs/dog_00/sprite_000.png",
            "spriteSha256": _sha(b"approved-sprite"),
            "targetBox": [10, 20, 30, 40],
            "placementVerdict": "keep",
            "placementTrialAvailable": True,
            "extractionVerdict": "approved",
            "needsRedo": False,
            "redoAction": "keep",
        }],
        "placementTrials": [{
            "levelId": "level_a",
            "dogId": "dog_00",
            "sprite": "dogs/dog_00/sprite_000.png",
            "spriteSha256": _sha(b"approved-sprite"),
            "initialBox": [10, 20, 30, 40],
            "targetBox": [10, 20, 30, 40],
            "trialType": "keep",
        }],
        "redoDataset": {
            "positive": 0,
            "negative": 1,
            "excludedUnconfirmed": 0,
            "fullSceneRegenerationExamples": 0,
            "splitUnit": "levelId",
        },
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest))
    return path, levels, manifest


def test_validate_manifest_accepts_complete_level_review(tmp_path):
    path, levels, _ = _fixture(tmp_path)

    summary = validate_manifest(path, levels)

    assert summary == {
        "levels": 1,
        "approved": 1,
        "placementCorrections": 0,
        "placementKeeps": 1,
        "placementExcluded": 0,
        "redoPositive": 0,
        "redoNegative": 1,
        "redoExcluded": 0,
    }


def test_validate_manifest_rejects_duplicate_bird_labels(tmp_path):
    path, levels, manifest = _fixture(tmp_path)
    manifest["approved"].append(dict(manifest["approved"][0]))
    path.write_text(json.dumps(manifest))

    with pytest.raises(GoldenDatasetError, match="duplicate approved bird"):
        validate_manifest(path, levels)


def test_validate_manifest_rejects_changed_approved_sprite(tmp_path):
    path, levels, _ = _fixture(tmp_path)
    (levels / "level_a" / "dogs" / "dog_00" / "sprite_000.png").write_bytes(b"changed")

    with pytest.raises(GoldenDatasetError, match="approved sprite hash mismatch"):
        validate_manifest(path, levels)


def test_validate_manifest_rejects_bird_missing_from_placement_trials(tmp_path):
    path, levels, manifest = _fixture(tmp_path)
    manifest["placementTrials"] = []
    path.write_text(json.dumps(manifest))

    with pytest.raises(GoldenDatasetError, match="placement trial availability mismatch"):
        validate_manifest(path, levels)


def test_cutout_quality_features_separate_matching_color_from_wrong_color():
    clean = np.full((60, 60, 3), 100, dtype=np.uint8)
    scene = clean.copy()
    scene[20:40, 20:40] = (220, 50, 30)
    alpha = np.full((20, 20), 255, dtype=np.uint8)
    good = Image.fromarray(np.dstack([
        np.full_like(alpha, 220), np.full_like(alpha, 50), np.full_like(alpha, 30), alpha,
    ]), "RGBA")
    wrong = Image.fromarray(np.dstack([
        np.full_like(alpha, 20), np.full_like(alpha, 40), np.full_like(alpha, 230), alpha,
    ]), "RGBA")

    good_features = cutout_quality_features(clean, scene, good, (20, 20, 40, 40))
    wrong_features = cutout_quality_features(clean, scene, wrong, (20, 20, 40, 40))

    assert good_features["changedPrecision"] == pytest.approx(1.0)
    assert good_features["colorSimilarity"] > 0.99
    assert wrong_features["changedPrecision"] == pytest.approx(1.0)
    assert wrong_features["colorSimilarity"] < 0.5


def test_cutout_quality_features_penalize_oversized_alpha():
    clean = np.full((60, 60, 3), 100, dtype=np.uint8)
    scene = clean.copy()
    scene[25:35, 25:35] = 220
    sprite = Image.new("RGBA", (30, 30), (220, 220, 220, 255))

    features = cutout_quality_features(clean, scene, sprite, (15, 15, 45, 45))

    assert features["changedPrecision"] == pytest.approx(100 / 900)
    assert features["changedRecall"] == pytest.approx(1.0)


def test_placement_box_metrics_are_zero_for_exact_target():
    metrics = placement_box_metrics([10, 20, 50, 80], [10, 20, 50, 80])

    assert metrics == {
        "iou": 1.0,
        "centerPx": 0.0,
        "widthError": 0.0,
        "heightError": 0.0,
        "loss": 0.0,
    }


def test_placement_box_metrics_penalize_translation_and_scale():
    metrics = placement_box_metrics([20, 30, 70, 90], [10, 20, 50, 80])

    assert metrics["iou"] < 1.0
    assert metrics["centerPx"] > 0
    assert metrics["widthError"] == pytest.approx(0.25)
    assert metrics["heightError"] == pytest.approx(0.0)
    assert metrics["loss"] > 0


def test_portable_logistic_prediction_applies_saved_standardization():
    model = {
        "featureNames": ["a", "b"],
        "mean": [2.0, 5.0],
        "scale": [2.0, 1.0],
        "coefficients": [1.0, -0.5],
        "intercept": 0.0,
    }

    probability = predict_portable_logistic(model, {"a": 4.0, "b": 5.0})

    assert probability == pytest.approx(1 / (1 + np.exp(-1.0)))


def test_portable_placement_rejects_neighbor_jump_despite_high_probability():
    model = {
        "featureNames": ["signal"],
        "mean": [0.0],
        "scale": [1.0],
        "coefficients": [8.0],
        "intercept": 0.0,
        "threshold": 0.6,
        "maxMovementNorm": 0.45,
    }

    assert should_apply_portable_placement(
        model, {"signal": 1.0, "hybridMovementNorm": 0.4},
    )
    assert not should_apply_portable_placement(
        model, {"signal": 1.0, "hybridMovementNorm": 0.604},
    )


def test_portable_tree_ensemble_matches_sklearn_probability():
    from sklearn.ensemble import ExtraTreesClassifier

    x = np.asarray([[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0], [2.0, 2.0]])
    y = np.asarray([0, 0, 0, 1, 1])
    classifier = ExtraTreesClassifier(
        n_estimators=25, max_depth=3, min_samples_leaf=1, random_state=0,
    ).fit(x, y)
    portable = _portable_tree_ensemble(classifier, ["a", "b"])

    for values in x:
        expected = classifier.predict_proba(values.reshape(1, -1))[0, 1]
        actual = predict_portable_tree_ensemble(portable, {"a": values[0], "b": values[1]})
        assert actual == pytest.approx(expected)


def test_frozen_redo_evaluation_recommends_review_only_extra_trees():
    editor_root = Path(__file__).resolve().parents[1]
    repo_root = editor_root.parents[1]
    report = evaluate_redo_classifier(
        editor_root / "eval/golden-cutout-placement-v1/manifest.json",
        repo_root / "games/find_the_bird/public/levels",
    )

    assert report["winner"] == "extra-trees-depth-4-balanced"
    assert report["recommendedProduction"] == report["winner"]
    assert report["predictionMode"] == "review-ranking-only"
    assert report["models"][report["winner"]]["averagePrecision"] == pytest.approx(0.6639843301623036)
    assert report["productionModel"]["type"] == "binary-tree-ensemble-v1"
