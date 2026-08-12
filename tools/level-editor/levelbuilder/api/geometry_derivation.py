"""Geometry vNEXT derivation core — the CL-11/CL-12 foundation.

Definitions implemented exactly as the plan's stress-tested model specifies:
- §2 restore source: quality-gated paint-diff (scene − clean bg); a globally
  distributed footprint fails closed as needs_review (repaint-drift detector).
- §3 restore ownership: a COMPLETE per-pixel partition of the accepted diff —
  components are split across the Voronoi partition (nearest hitbox center),
  never treated as an indivisible unit.
- Restore regions (CL-12): bbox of a bird's owned paint + margin — provably
  contains the whole painted bird including props.
- Residue gate (CL-11): perceptual diff of the all-picked-up composite vs the
  clean bg; count + heatmap.
- Dependency hash: scene sha, clean sha, and the complete hitbox set — any
  input change stales the whole partition (vNEXT §3).

Pure functions over numpy arrays; no I/O, no session coupling — callers feed
resolved (verified) pixels and canonical birds.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

import numpy as np

# Perceptual threshold for "painted" (per-pixel channel-sum difference), and
# the fail-closed gate: if more than this fraction of the frame diffs, the
# footprint is globally distributed (repaint drift), not bird paint.
DIFF_THRESHOLD = 60
GLOBAL_FOOTPRINT_LIMIT = 0.20


@dataclass(frozen=True)
class PaintDiff:
    mask: np.ndarray          # bool (H, W)
    needs_review: bool
    diff_fraction: float


@dataclass(frozen=True)
class Ownership:
    owner: np.ndarray         # int32 (H, W); bird index, -1 outside the diff
    bird_ids: tuple[str, ...]


@dataclass(frozen=True)
class ResidueReport:
    residue_pixels: int
    heatmap: np.ndarray       # bool (H, W)


def derive_paint_diff(scene: np.ndarray, clean: np.ndarray, *, threshold: int = DIFF_THRESHOLD) -> PaintDiff:
    if scene.shape != clean.shape:
        raise ValueError(f"scene {scene.shape} and clean {clean.shape} shapes differ")
    delta = np.abs(scene.astype(np.int16) - clean.astype(np.int16)).sum(axis=2)
    mask = delta > threshold
    fraction = float(mask.mean())
    return PaintDiff(mask=mask, needs_review=fraction > GLOBAL_FOOTPRINT_LIMIT, diff_fraction=fraction)


def derive_ownership(mask: np.ndarray, birds: list[dict[str, Any]]) -> Ownership:
    """Per-pixel Voronoi assignment of the accepted diff to the nearest
    hitbox center. Deterministic: ties break by stable bird order (the birds
    list as given, which callers pass in birdId-stable order)."""
    if not birds:
        raise ValueError("ownership requires at least one bird")
    ys, xs = np.nonzero(mask)
    owner = np.full(mask.shape, -1, dtype=np.int32)
    if len(ys):
        centers = np.array([[b["hitbox"]["y"], b["hitbox"]["x"]] for b in birds], dtype=np.float64)
        # (P, B) distance matrix; argmin picks the first (stable) bird on ties.
        dy = ys[:, None] - centers[None, :, 0]
        dx = xs[:, None] - centers[None, :, 1]
        nearest = (dy * dy + dx * dx).argmin(axis=1)
        owner[ys, xs] = nearest
    return Ownership(owner=owner, bird_ids=tuple(str(b["birdId"]) for b in birds))


def derive_restore_regions(
    ownership: Ownership, birds: list[dict[str, Any]], *, margin: int = 8,
) -> dict[str, dict[str, int]]:
    """CL-12: each bird's crop = bbox of its owned paint + margin (clamped to
    the frame). Birds owning no paint fall back to a hitbox-radius box."""
    height, width = ownership.owner.shape
    regions: dict[str, dict[str, int]] = {}
    for index, bird in enumerate(birds):
        pixels = np.nonzero(ownership.owner == index)
        if len(pixels[0]):
            y0, y1 = int(pixels[0].min()), int(pixels[0].max())
            x0, x1 = int(pixels[1].min()), int(pixels[1].max())
        else:
            hitbox = bird["hitbox"]
            radius = int(hitbox.get("r", 30))
            y0 = y1 = int(hitbox["y"])
            x0 = x1 = int(hitbox["x"])
            y0 -= radius; y1 += radius; x0 -= radius; x1 += radius
        x0 = max(0, x0 - margin); y0 = max(0, y0 - margin)
        x1 = min(width - 1, x1 + margin); y1 = min(height - 1, y1 + margin)
        regions[str(bird["birdId"])] = {
            "x": x0, "y": y0, "width": x1 - x0 + 1, "height": y1 - y0 + 1,
        }
    return regions


def residue_report(composite: np.ndarray, clean: np.ndarray, *, threshold: int = DIFF_THRESHOLD) -> ResidueReport:
    """CL-11: paint surviving in the all-picked-up composite. Under the vNEXT
    model this is ~0 by construction — the gate's standing job is catching
    stale overrides and derivation/runtime disagreement."""
    diff = derive_paint_diff(composite, clean, threshold=threshold)
    return ResidueReport(residue_pixels=int(diff.mask.sum()), heatmap=diff.mask)


def derivation_dependency_hash(scene_sha256: str, clean_sha256: str, birds: list[dict[str, Any]]) -> str:
    """vNEXT §3: the partition depends on scene, clean bg, and the COMPLETE
    hitbox set (+ sprite geometry when present) — any change stales it all."""
    payload = {
        "scene": scene_sha256,
        "clean": clean_sha256,
        "birds": [
            {
                "birdId": str(b["birdId"]),
                "hitbox": {k: int(b["hitbox"][k]) for k in ("x", "y", "r")},
                "sprite": (
                    {k: int(b["sprite"]["placement"][k]) for k in ("x", "y", "width", "height")}
                    if isinstance((b.get("sprite") or {}).get("placement"), dict) else None
                ),
            }
            for b in sorted(birds, key=lambda item: str(item["birdId"]))
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()
