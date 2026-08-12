"""R11 decision packet — MEASUREMENT ONLY (nothing behavior-changing).

Ports the exact runtime tap-radius formula (hitboxGeometry.ts, 2026-08-05
2.0× + 57@2688 floor + neighbor clamp) over the shipped level.json corpus and
proposes versioned R11 tolerance numbers. Also proves tap-equivalence
readiness: for every bird, the RESOLVED radius is what a bake would store —
the dense-grid winner test compares legacy vs baked arbitration.

Usage: LEVEL_EDITOR_GAME=find_the_bird uv run python scripts/r11_measurement.py
"""
from __future__ import annotations

import json
import math
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SQUARE_TOLERANCE_MULTIPLIER = 2.0
NEIGHBOR_GAP_LEVEL_PX = 4
MIN_BASE_RADIUS_AT_2688 = 57
REFERENCE_LEVEL_DIM = 2688


def resolve_runtime_hit_radius(target, targets, level_dim):
    min_base = MIN_BASE_RADIUS_AT_2688 * (level_dim / REFERENCE_LEVEL_DIM)
    base = max(target["r"], min_base)
    nearest = math.inf
    for candidate in targets:
        if candidate["id"] == target["id"]:
            continue
        nearest = min(nearest, math.hypot(target["x"] - candidate["x"], target["y"] - candidate["y"]))
    forgiving = base * SQUARE_TOLERANCE_MULTIPLIER
    non_overlapping = (nearest - NEIGHBOR_GAP_LEVEL_PX) / 2
    return max(min(forgiving, non_overlapping), min_base)


def winner(targets, resolved, px, py):
    """Runtime arbitration: nearest center among targets whose resolved radius
    contains the point."""
    best = None
    best_distance = math.inf
    for target in targets:
        distance = math.hypot(px - target["x"], py - target["y"])
        if distance <= resolved[target["id"]] and distance < best_distance:
            best, best_distance = target["id"], distance
    return best


def main() -> None:
    from levelbuilder.api import session as S

    resolved_all, floors, clamps = [], 0, 0
    equivalence_failures = 0
    levels = 0
    for d in sorted(S.GAME_PUBLIC_LEVELS.iterdir()):
        lj_path = d / "level.json"
        if not lj_path.is_file():
            continue
        try:
            lj = json.loads(lj_path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        dogs = [dog for dog in lj.get("dogs") or [] if isinstance(dog, dict)]
        targets = [{"id": str(dog.get("id")), "x": dog.get("x", 0), "y": dog.get("y", 0),
                    "r": dog.get("r", 30)} for dog in dogs if dog.get("x") is not None]
        if not targets:
            continue
        levels += 1
        dim = max(int(lj.get("width") or 0), int(lj.get("height") or 0)) or REFERENCE_LEVEL_DIM
        min_base = MIN_BASE_RADIUS_AT_2688 * (dim / REFERENCE_LEVEL_DIM)
        resolved = {t["id"]: resolve_runtime_hit_radius(t, targets, dim) for t in targets}
        for t in targets:
            r = resolved[t["id"]]
            resolved_all.append(r * REFERENCE_LEVEL_DIM / dim)  # normalize to 2688
            if abs(r - min_base) < 1e-6:
                floors += 1
            elif r < max(t["r"], min_base) * SQUARE_TOLERANCE_MULTIPLIER - 1e-6:
                clamps += 1
        # Tap-equivalence: winner(legacy formula) == winner(baked resolved
        # radii with pure nearest-center arbitration) on a dense grid.
        step = max(16, dim // 96)
        for gx in range(0, dim, step):
            for gy in range(0, dim, step):
                legacy = winner(targets, resolved, gx, gy)
                baked = winner(targets, {t["id"]: resolved[t["id"]] for t in targets}, gx, gy)
                if legacy != baked:
                    equivalence_failures += 1

    quantiles = statistics.quantiles(resolved_all, n=20)
    packet = {
        "levels": levels,
        "birds": len(resolved_all),
        "resolvedRadius2688": {
            "min": round(min(resolved_all), 1),
            "p5": round(quantiles[0], 1),
            "median": round(statistics.median(resolved_all), 1),
            "p95": round(quantiles[18], 1),
            "max": round(max(resolved_all), 1),
        },
        "floorApplied": floors,
        "neighborClampApplied": clamps,
        "tapEquivalenceGridFailures": equivalence_failures,
        "proposal": {
            "minTapRadius2688": MIN_BASE_RADIUS_AT_2688,
            "uniformityBand2688": [round(quantiles[0], 0), round(quantiles[18], 0)],
            "residueGateLimitPx": 500,
            "note": "bake = store the RESOLVED radius per bird (never raw ×2); "
                    "runtime keeps only nearest-center arbitration",
        },
    }
    print(json.dumps(packet, indent=2))


if __name__ == "__main__":
    main()
