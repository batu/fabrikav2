from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import numpy as np
import pytest
from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("generation_time_experiment", HERE / "run_experiment.py")
assert SPEC is not None and SPEC.loader is not None
EXPERIMENT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = EXPERIMENT
SPEC.loader.exec_module(EXPERIMENT)


def _gradient_key_background(size: int = 128) -> Image.Image:
    y = np.linspace(0.0, 1.0, size, dtype=np.float32)[:, None]
    top = np.array([248.0, 4.0, 247.0], dtype=np.float32)
    bottom = np.array([235.0, 31.0, 232.0], dtype=np.float32)
    row = top[None, :] * (1.0 - y[:, :, None]) + bottom[None, :] * y[:, :, None]
    rgb = np.repeat(row, size, axis=1).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def test_chroma_key_removes_generated_gradient_and_preserves_subject_color() -> None:
    background = _gradient_key_background().convert("RGBA")
    high_res = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    draw = ImageDraw.Draw(high_res)
    draw.ellipse((116, 92, 396, 420), fill=(22, 181, 159, 255))
    subject = high_res.resize(background.size, Image.Resampling.LANCZOS)
    background.alpha_composite(subject)

    cutout = EXPERIMENT.chroma_key(background.convert("RGB"))
    alpha = np.asarray(cutout.getchannel("A"))
    rgb = np.asarray(cutout.convert("RGB"))

    assert cutout.width < 100
    assert cutout.height < 110
    assert max(alpha[0].max(), alpha[-1].max(), alpha[:, 0].max(), alpha[:, -1].max()) == 0
    opaque = rgb[alpha == 255]
    assert np.median(opaque, axis=0) == pytest.approx((22, 181, 159), abs=2)


def test_chroma_key_rejects_background_only() -> None:
    with pytest.raises(RuntimeError, match="no foreground component"):
        EXPERIMENT.chroma_key(_gradient_key_background())


def test_cost_estimate_uses_recorded_standard_tier_token_classes() -> None:
    usage = {
        "input_tokens_details": {"text_tokens": 162, "image_tokens": 81},
        "output_tokens_details": {"image_tokens": 196},
    }
    assert EXPERIMENT._estimated_cost_usd(usage) == 0.007338
