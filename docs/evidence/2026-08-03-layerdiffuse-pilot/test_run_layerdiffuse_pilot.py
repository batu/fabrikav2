from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import numpy as np
import pytest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "layerdiffuse_pilot", HERE / "run_layerdiffuse_pilot.py"
)
assert SPEC is not None and SPEC.loader is not None
PILOT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PILOT
SPEC.loader.exec_module(PILOT)


def test_square_box_centers_rectangular_variant_without_leaving_source() -> None:
    assert PILOT._square_box((1708, 1088, 2240, 1692), (4096, 4096)) == (
        1672,
        1088,
        2276,
        1692,
    )
    assert PILOT._square_box((0, 5, 10, 25), (30, 30)) == (0, 5, 20, 25)


def test_workflow_pins_official_background_conditioned_contract() -> None:
    case = {"caseId": "bird-case", "prompt": "one bird", "seed": 25}
    generation = {
        "width": 512,
        "height": 512,
        "steps": 28,
        "cfg": 7.0,
        "sampler": "dpmpp_2m",
        "scheduler": "karras",
        "negativePrompt": "text",
    }

    workflow = PILOT._workflow(case, generation)

    assert workflow["5"]["inputs"] == {"width": 512, "height": 512, "batch_size": 2}
    assert workflow["6"]["inputs"]["config"] == (
        "SD15, Background, attn_sharing, Batch size (2N)"
    )
    assert workflow["9"]["inputs"]["sd_version"] == "SD15"
    assert workflow["10"]["inputs"]["images"] == ["9", 0]
    assert workflow["11"]["inputs"]["images"] == ["9", 1]


def test_component_count_reports_satellite_foregrounds() -> None:
    alpha = np.zeros((8, 8), dtype=np.uint8)
    alpha[1:3, 1:3] = 255
    alpha[5:7, 5:7] = 255

    assert PILOT._component_count(alpha) == 2


def test_wait_for_history_surfaces_remote_execution_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        PILOT,
        "_http_json",
        lambda _url: {
            "prompt-25": {
                "status": {
                    "status_str": "error",
                    "completed": False,
                    "messages": [["execution_error", {"message": "device mismatch"}]],
                }
            }
        },
    )

    with pytest.raises(RuntimeError, match="device mismatch"):
        PILOT._wait_for_history("http://example.invalid", "prompt-25")
