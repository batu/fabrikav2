import base64
import json

import numpy as np
import pytest
from PIL import Image

from levelbuilder.api.placement_eval import (
    evaluate_level,
    mask_metrics,
    residue_metrics,
    runtime_sprite_box,
    select_subject,
    summarize,
)


def test_position_and_scale_errors_reduce_current_overlap():
    target = np.zeros((100, 100), bool)
    target[30:70, 30:70] = True
    shifted = np.roll(target, 15, axis=1)
    small = np.zeros_like(target)
    small[40:60, 40:60] = True
    exact = mask_metrics(target, target)
    assert exact["score"] == 100
    assert exact["centerErrorPx"] == 0
    assert mask_metrics(shifted, target)["score"] < 60
    assert mask_metrics(small, target)["widthRatio"] == 0.5
    assert mask_metrics(small, target)["score"] == 25


def test_runtime_box_uses_anchor_and_flip_not_stale_editor_xy():
    dog = {
        "x": 100,
        "y": 100,
        "sprite": {
            "x": 999,
            "y": 999,
            "width": 80,
            "height": 40,
            "anchorX": 0.25,
            "anchorY": 0.5,
        },
    }
    assert runtime_sprite_box(dog) == (80, 80, 160, 120)
    dog["sprite"]["flipX"] = True
    assert runtime_sprite_box(dog) == (40, 80, 120, 120)


def test_empty_mask_is_unscored_not_perfect():
    empty = np.zeros((20, 20), bool)
    assert mask_metrics(empty, empty)["score"] is None


def test_mask_selection_cannot_choose_by_sprite_overlap():
    small = np.zeros((100, 100), bool)
    small[30:70, 30:70] = True
    whole = np.ones_like(small)
    mask, confidence, reasons = select_subject(
        np.stack([whole, small]), [0.99, 0.9], (50, 50)
    )
    assert np.array_equal(mask, small)
    assert confidence == 0.9
    assert not reasons


def test_ambiguous_and_missing_birds_remain_in_coverage():
    result = summarize(
        [
            {"status": "scored", "score": 90},
            {"status": "uncertain", "score": 10},
            {"status": "error", "score": None},
        ]
    )
    assert result["birds"] == 3
    assert result["scored"] == 1
    assert result["coverage"] == pytest.approx(1 / 3)
    assert result["meanScore"] == 90
    assert result["rankable"] is False


def test_residue_detects_bird_outside_cleanup_and_contaminated_restore():
    scene = np.zeros((40, 40, 3), np.uint8)
    scene[10:30, 10:30] = (180, 50, 20)
    subject = np.zeros((40, 40), bool)
    subject[10:30, 10:30] = True
    erase = np.ones_like(subject)
    clean = np.zeros_like(scene)
    result = residue_metrics(scene, clean, subject, erase)
    assert result["remainingPixels"] == 0
    erase[:, 25:] = False
    result = residue_metrics(scene, clean, subject, erase)
    assert result["outsideCleanupPixels"] == 100
    assert result["flagged"] is True
    erase[:] = True
    result = residue_metrics(scene, scene.copy(), subject, erase)
    assert result["restoreMatchPixels"] == 400
    assert result["flagged"] is True


def test_exported_level_audit_is_read_only_and_uses_restore_bytes(tmp_path):
    root = tmp_path / "public" / "levels"
    folder = root / "example"
    folder.mkdir(parents=True)
    scene = np.zeros((100, 100, 3), np.uint8)
    scene[40:60, 40:60] = (220, 50, 20)
    Image.fromarray(scene).save(folder / "color.png")
    Image.fromarray(np.zeros_like(scene)).save(folder / "bg_00.png")
    Image.new("RGBA", (20, 20), (220, 50, 20, 255)).save(folder / "sprite.png")
    level = {
        "width": 100,
        "height": 100,
        "colorImage": "levels/example/color.png",
        "dogs": [
            {
                "id": "bird",
                "x": 50,
                "y": 50,
                "r": 10,
                "sprite": {
                    "image": "levels/example/sprite.png",
                    "width": 20,
                    "height": 20,
                    "cleanup": {"x": 40, "y": 40, "width": 20, "height": 20},
                },
            }
        ],
    }
    (folder / "level.json").write_text(json.dumps(level))
    before = {p.name: p.read_bytes() for p in folder.iterdir()}

    class Response:
        def raise_for_status(self):
            return self

        def json(self):
            mask = np.zeros((1, 80, 80), np.uint8)
            mask[:, 30:50, 30:50] = 1
            return {
                "shape": list(mask.shape),
                "scores": [0.95],
                "masks_packed_b64": base64.b64encode(
                    np.packbits(mask).tobytes()
                ).decode(),
            }

    class Client:
        @property
        def identity(self):
            return {"model": "test"}

        def predict(self, request):
            return Response().json()

    cache = tmp_path / "cache"
    cache.mkdir()
    report = evaluate_level(root, "example", Client(), cache)
    assert report["summary"]["scored"] == 1
    assert report["birds"][0]["score"] == 100
    assert report["birds"][0]["residueFirst"]["remainingPixels"] == 0
    assert {p.name: p.read_bytes() for p in folder.iterdir()} == before


def test_placement_cli_does_not_change_legacy_output_contract():
    from levelbuilder.cli.main import build_parser

    parser = build_parser()
    legacy = parser.parse_args(
        ["evaluate-sprites", "--game", "find_the_bird", "--out", "scores.json"]
    )
    assert legacy.out == "scores.json"
    assert not hasattr(legacy, "sam3_command")
    audit = parser.parse_args(
        [
            "evaluate-placements",
            "--game",
            "find_the_bird",
            "--out",
            "audit",
            "--sam3-command",
            "worker",
        ]
    )
    assert audit.sam3_command == "worker"


def test_selection_marks_wrong_target_uncertain():
    mask = np.zeros((1, 100, 100), bool)
    mask[:, 10:30, 10:30] = True
    _, _, reasons = select_subject(mask, [0.99], (70, 70))
    assert reasons


def test_failed_level_does_not_claim_verified_input_hashes(tmp_path, monkeypatch):
    from contextlib import nullcontext
    from types import SimpleNamespace

    from levelbuilder.api import placement_segmenter
    from levelbuilder.api.placement_eval import evaluate_catalog

    root = tmp_path / "levels"
    root.mkdir()
    catalog = root / "catalog.json"
    catalog.write_text(json.dumps({"levels": [{"id": "missing"}]}))
    monkeypatch.setattr(
        placement_segmenter,
        "Sam3Process",
        lambda command: nullcontext(SimpleNamespace(identity={"model": "test"})),
    )
    report = evaluate_catalog(
        root, catalog, tmp_path / "audit", "fake-worker", progress=lambda message: None
    )
    assert report["inputsUnchanged"] is None
    assert report["levels"][0]["summary"]["errors"] == 1
    assert (tmp_path / "audit" / "report" / "index.html").exists()


def test_vertical_and_combined_flip_origins():
    dog = {
        "x": 100.5,
        "y": 101.5,
        "sprite": {
            "width": 80,
            "height": 40,
            "anchorX": 0.25,
            "anchorY": 0.25,
            "flipY": True,
        },
    }
    assert runtime_sprite_box(dog) == (80, 72, 160, 112)
    dog["sprite"]["flipX"] = True
    assert runtime_sprite_box(dog) == (40, 72, 120, 112)
