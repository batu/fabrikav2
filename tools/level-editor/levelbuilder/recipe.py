"""P2d.1 slice — the versioned canonical recipe.

One object describes the current default generation lane (values transcribed
from PIPELINE.md, the canonical magenta lane, 2026-08-12) WITHOUT changing any
behavior: this module only names what the lane already does, so UI and CLI can
resolve the same effective recipe, hash it deterministically, and diff
proposed changes before spending money. Sessions without a recipe resolve to
this default; old revisions are never rewritten.

Out of scope tonight (by the overnight brief): experiment-manifest UI,
adopt-winner, cost-ledger UI, R11 enforcement, radius migration.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

SCHEMA_VERSION = 1


class RecipeError(ValueError):
    """A recipe payload is malformed — loud, never defaulted away."""


# The canonical default lane. Values are the measured/decided ones recorded in
# PIPELINE.md; changing a value here IS a lane change and needs a dry-run diff.
DEFAULT_RECIPE: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "name": "canonical-magenta-v1",
    "models": {
        "background": "google/gemini-3-pro-image",
        "inpaint": "google/gemini-2.5-flash-image",
        "placementScoring": "google/gemini-3.6-flash",
        "cutout": "google/gemini-2.5-flash-image",
        "upscale": "fal-ai/esrgan",
    },
    "dimensions": {
        "workingCanvas": [2688, 2688],
        "magentaSend": [2048, 2048],
        "upscaleTargetLongEdge": 2688,
    },
    "placement": {
        "strategy": "smart",
        "radius": 38,
        "candidatePoolFloorMultiplier": 2,
    },
    "inpaint": {"mode": "magenta"},
    "cutout": {
        "extractor": "flatkey",
        "grid": "2x2",
        "gridCap": 3,
    },
    "export": {"webpMaxLongEdge": 2560, "webpQuality": 70},
    "variantSlots": {},
    "difficultyMix": {"easyRatio": 1.0, "twoPass": False},
    "birdCount": {"count": 15},
    "paintSize": {"relativeScale": 1.0},
}

_OVERRIDABLE = frozenset(DEFAULT_RECIPE) - {"schemaVersion", "name"}


def serialize_recipe(recipe: dict[str, Any]) -> str:
    """Deterministic canonical serialization (sorted keys, no whitespace drift)."""
    return json.dumps(recipe, sort_keys=True, separators=(",", ":")) + "\n"


def recipe_hash(recipe: dict[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(serialize_recipe(recipe).encode("utf-8")).hexdigest()


def _merge(base: Any, override: Any, path: str) -> Any:
    if isinstance(base, dict):
        if not isinstance(override, dict):
            raise RecipeError(f"recipe field {path} must be an object, got {type(override).__name__}")
        merged = dict(base)
        for key, value in override.items():
            if key not in base:
                raise RecipeError(f"unknown recipe field: {path}.{key}" if path else f"unknown recipe field: {key}")
            merged[key] = _merge(base[key], value, f"{path}.{key}" if path else key)
        return merged
    return override


def resolve_recipe(session_raw: dict[str, Any] | None) -> dict[str, Any]:
    """The one resolution: session override merged over the canonical default.

    Backward-read: a session with no recipe field resolves to the default.
    Unknown fields and unsupported schemaVersions are loud (refuse to guess).
    """
    override = (session_raw or {}).get("recipe")
    if override is None:
        return json.loads(serialize_recipe(DEFAULT_RECIPE))
    if not isinstance(override, dict):
        raise RecipeError(f"recipe must be an object, got {type(override).__name__}")
    version = override.get("schemaVersion", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise RecipeError(f"unsupported recipe schemaVersion: {version!r}")
    unknown = set(override) - _OVERRIDABLE - {"schemaVersion"}
    if unknown:
        raise RecipeError(f"unknown recipe field: {sorted(unknown)[0]}")
    resolved = dict(DEFAULT_RECIPE)
    for key, value in override.items():
        if key == "schemaVersion":
            continue
        resolved[key] = _merge(DEFAULT_RECIPE[key], value, key)
    return json.loads(serialize_recipe(resolved))


def _flatten(recipe: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for key, value in recipe.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            flat.update(_flatten(value, path))
        else:
            flat[path] = value
    return flat


def recipe_diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Semantic diff between two resolved recipes: {path: {from, to}}."""
    flat_before, flat_after = _flatten(before), _flatten(after)
    diff: dict[str, dict[str, Any]] = {}
    for path in sorted(set(flat_before) | set(flat_after)):
        if flat_before.get(path) != flat_after.get(path):
            diff[path] = {"from": flat_before.get(path), "to": flat_after.get(path)}
    return diff


def main() -> None:  # CLI parity: python -m levelbuilder.recipe [--session <id>]
    import argparse

    parser = argparse.ArgumentParser(description="Resolve and print the effective recipe (read-only).")
    parser.add_argument("--session", default=None, help="session id to resolve against")
    args = parser.parse_args()
    session_raw = None
    if args.session:
        from .api import session as S

        session_raw = S.load_session_raw(args.session)
    resolved = resolve_recipe(session_raw)
    print(serialize_recipe(resolved), end="")
    print(f"# hash: {recipe_hash(resolved)}")
    if session_raw is not None:
        diff = recipe_diff(json.loads(serialize_recipe(DEFAULT_RECIPE)), resolved)
        print(f"# diff vs default: {json.dumps(diff) if diff else 'none'}")


if __name__ == "__main__":
    main()
