#!/usr/bin/env python
"""Measure menu-element displacement between two Pixel 6a transition frames.

The fade changes brightness and reveals gameplay underneath, so raw RGB equality
is not meaningful. This compares high-gradient pixels after normalizing each
crop, then searches every integer offset in a small radius. The winning offset
is the measured element displacement; the gate passes only when every winner is
exactly (0, 0).

Run from the Pixelsmith checkout so its Pillow and NumPy dependencies are used:

    uv run python /path/to/assert_transition_displacement.py \
      --before frame-019.png --midpoint frame-021.png --out displacement.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


# Pixel 6a native screenrecord coordinates (1080 x 2400). Each crop includes a
# small amount of surrounding field so a displaced edge cannot escape the crop.
ELEMENT_BOXES = {
    "coin_pill": (35, 250, 390, 450),
    "settings_gear": (820, 250, 1045, 460),
    "title_banner": (80, 430, 1000, 720),
    "board_preview": (120, 650, 960, 1320),
    "saga_chain": (350, 1250, 730, 1710),
    "current_level_node": (290, 1620, 790, 2010),
    "level_button": (210, 1950, 870, 2320),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def gradient_magnitude(image: np.ndarray) -> np.ndarray:
    gradient_x = np.zeros_like(image)
    gradient_y = np.zeros_like(image)
    gradient_x[:, 1:-1] = image[:, 2:] - image[:, :-2]
    gradient_y[1:-1] = image[2:] - image[:-2]
    return np.hypot(gradient_x, gradient_y)


def normalized(values: np.ndarray) -> np.ndarray:
    return (values - values.mean()) / (values.std() + 1e-6)


def measure(
    before_gradient: np.ndarray,
    midpoint_gradient: np.ndarray,
    box: tuple[int, int, int, int],
    radius: int,
) -> dict[str, object]:
    x0, y0, x1, y1 = box
    template = before_gradient[y0:y1, x0:x1]
    # Compare the strongest 22% of edge pixels. Flat fade/background pixels do
    # not carry position information and would dilute the displacement signal.
    mask = template > np.percentile(template, 78)
    template_pixels = normalized(template[mask])
    candidates: list[dict[str, float | int]] = []

    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            sample = midpoint_gradient[y0 + dy : y1 + dy, x0 + dx : x1 + dx]
            sample_pixels = normalized(sample[mask])
            candidates.append(
                {
                    "dx_px": dx,
                    "dy_px": dy,
                    "normalized_edge_pixel_mad": float(
                        np.mean(np.abs(template_pixels - sample_pixels))
                    ),
                }
            )

    candidates.sort(key=lambda candidate: candidate["normalized_edge_pixel_mad"])
    winner, runner_up = candidates[:2]
    return {
        "box_px": [x0, y0, x1, y1],
        "edge_pixel_count": int(mask.sum()),
        "dx_px": winner["dx_px"],
        "dy_px": winner["dy_px"],
        "normalized_edge_pixel_mad": winner["normalized_edge_pixel_mad"],
        "runner_up": runner_up,
        "zero_displacement": winner["dx_px"] == 0 and winner["dy_px"] == 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", required=True, type=Path)
    parser.add_argument("--midpoint", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--search-radius", type=int, default=8)
    args = parser.parse_args()

    before = np.asarray(Image.open(args.before).convert("L"), dtype=np.float32)
    midpoint = np.asarray(Image.open(args.midpoint).convert("L"), dtype=np.float32)
    if before.shape != (2400, 1080) or midpoint.shape != before.shape:
        raise SystemExit(
            f"expected two 1080x2400 Pixel frames, got {before.shape} and {midpoint.shape}"
        )

    before_gradient = gradient_magnitude(before)
    midpoint_gradient = gradient_magnitude(midpoint)
    elements = {
        name: measure(
            before_gradient,
            midpoint_gradient,
            box,
            args.search_radius,
        )
        for name, box in ELEMENT_BOXES.items()
    }
    passed = all(element["zero_displacement"] for element in elements.values())
    report = {
        "schema": "marble-run-transition-displacement/v1",
        "method": (
            "integer-offset search minimizing mean absolute pixel difference "
            "between normalized high-gradient pixels"
        ),
        "before": {
            "path": str(args.before.resolve()),
            "sha256": sha256(args.before),
        },
        "midpoint": {
            "path": str(args.midpoint.resolve()),
            "sha256": sha256(args.midpoint),
        },
        "search_radius_px": args.search_radius,
        "elements": elements,
        "gate": {
            "requirement": "every element dx_px=0 and dy_px=0",
            "pass": passed,
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["gate"]))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
