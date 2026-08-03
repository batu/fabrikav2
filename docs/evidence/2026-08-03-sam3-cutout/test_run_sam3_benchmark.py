from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "run_sam3_benchmark", HERE / "run_sam3_benchmark.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def _fixture(tmp_path: Path) -> tuple[Path, Path]:
    source_root = tmp_path / "source"
    level = source_root / "level-a"
    dog_dir = level / "dogs" / "dog_01"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (10, 10), (240, 240, 240)).save(level / "bg_00.png")
    Image.new("RGB", (4, 4), (20, 30, 40)).save(dog_dir / "variant_000.png")
    _write_json(dog_dir / "variant_000.box.json", {"box": [2, 2, 6, 6]})
    _write_json(
        level / "session.json",
        {
            "dogs": [
                {"index": 1, "id": "bird-a", "activeVariant": 0},
                {"index": 0, "id": "other", "activeVariant": 0},
            ]
        },
    )
    _write_json(
        level / "hitboxes.json",
        [
            {"x": 1, "y": 1, "r": 1, "id": "other"},
            {"x": 4, "y": 4, "r": 2, "id": "bird-a"},
        ],
    )
    manifest = tmp_path / "manifest.json"
    _write_json(
        manifest,
        {
            "cases": [
                {
                    "caseId": "level-a__dog_01",
                    "levelId": "level-a",
                    "dogDir": "dog_01",
                    "birdId": "bird-a",
                    "activeVariant": 0,
                    "hitbox": {"x": 4, "y": 4, "r": 2},
                    "sourceBox": [2, 2, 6, 6],
                    "paintedCrop": "level-a/dogs/dog_01/variant_000.png",
                    "variantBox": "level-a/dogs/dog_01/variant_000.box.json",
                    "candidatePath": "level-a/dog_01.png",
                    "tags": ["held_item"],
                    "note": "stable-id fixture",
                }
            ]
        },
    )
    return source_root, manifest


def test_prepare_joins_dog_and_hitbox_by_stable_id(tmp_path: Path) -> None:
    source_root, manifest = _fixture(tmp_path)
    work = tmp_path / "work"

    prepared = MODULE.prepare_inputs(manifest, source_root, work)

    assert prepared["cases"][0]["birdId"] == "bird-a"
    assert prepared["cases"][0]["geometry"] == {"cx": 2.0, "cy": 2.0, "radius": 2.0}
    assert (work / "inputs" / "level-a__dog_01" / "painted.png").is_file()
    assert (work / "inputs" / "level-a__dog_01" / "clean.png").is_file()


def test_prepare_rejects_duplicate_stable_id(tmp_path: Path) -> None:
    source_root, manifest = _fixture(tmp_path)
    session_path = source_root / "level-a" / "session.json"
    session = json.loads(session_path.read_text())
    session["dogs"].append({"index": 9, "id": "bird-a", "activeVariant": 0})
    _write_json(session_path, session)

    with pytest.raises(MODULE.BenchmarkError, match="found 2"):
        MODULE.prepare_inputs(manifest, source_root, tmp_path / "work")


def test_choose_mask_prefers_hitbox_anchored_changed_subject() -> None:
    clean = np.zeros((12, 12, 3), dtype=np.uint8)
    painted = clean.copy()
    painted[4:9, 4:9] = 200
    wrong = np.zeros((12, 12), dtype=np.float32)
    wrong[0:3, 0:3] = 0.95
    right = np.zeros((12, 12), dtype=np.float32)
    right[4:9, 4:9] = 0.95

    chosen, diagnostics = MODULE.choose_mask(
        [
            {"prompt": "the bird", "masks": np.stack([wrong]), "scores": [0.9]},
            {
                "prompt": "the bird and what it holds",
                "masks": np.stack([right]),
                "scores": [0.7],
            },
        ],
        clean=clean,
        painted=painted,
        geometry={"cx": 6.0, "cy": 6.0, "radius": 3.0},
    )

    assert chosen is not None
    assert float(chosen[6, 6]) == pytest.approx(0.95)
    assert diagnostics["chosen"]["prompt"] == "the bird and what it holds"


def test_decontamination_recovers_foreground_from_known_clean_background() -> None:
    clean = np.full((2, 2, 3), 255, dtype=np.uint8)
    painted = np.full((2, 2, 3), 128, dtype=np.uint8)
    alpha = np.full((2, 2), 0.5, dtype=np.float32)

    rgba = MODULE.decontaminated_rgba(painted, clean, alpha)

    assert int(rgba[..., :3].max()) <= 2
    assert np.all(rgba[..., 3] == 128)
