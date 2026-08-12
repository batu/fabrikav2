"""Fail-closed export gate built on ftd-level-editor's schema authority.

The v2 tool (`ftd_editor.publishing`) owns `LevelFileV1`, geometry rules, and
catalog validation; this module adapts them per game. Policy differences from
the FTD corpus checker (`tools/ftd-level-editor/scripts/verify_public_levels.py`):
`levels-index.json` is FTD-legacy and not required here, `native/level.json`
is validated only when present, and catalog checks run only when a
catalog-manifest exists. A crash inside validation is a refusal, not a bypass.
"""

from __future__ import annotations

import json
import hashlib
from pathlib import Path


class ExportGateError(Exception):
    def __init__(self, level_id: str, violations: list[str]) -> None:
        self.level_id = level_id
        self.violations = violations
        super().__init__(
            f"export gate refused level {level_id!r}: " + "; ".join(violations)
        )


def _level_violations(level_dir: Path) -> list[str]:
    from ftd_editor.publishing.level_schema import LevelFileV1, validate_level_geometry

    violations: list[str] = []
    level_path = level_dir / "level.json"
    if not level_path.is_file():
        return [f"missing level.json in {level_dir.name}"]
    try:
        level = LevelFileV1.model_validate_json(level_path.read_bytes())
    except Exception as error:  # pydantic ValidationError and JSON errors alike
        return [f"level.json schema: {error}"]
    native = None
    native_path = level_dir / "native" / "level.json"
    if native_path.is_file():
        try:
            native = LevelFileV1.model_validate_json(native_path.read_bytes())
        except Exception as error:
            return [f"native/level.json schema: {error}"]
    try:
        validate_level_geometry(level, native=native)
    except Exception as error:
        violations.append(f"geometry: {error}")
    return violations


def _artifact_provenance_violations(level_dir: Path) -> list[str]:
    level_path = level_dir / "level.json"
    try:
        raw_level = json.loads(level_path.read_text())
    except (OSError, ValueError):
        return []
    revision = raw_level.get("artifactRevision")
    if revision is None:
        return []
    manifest_path = level_dir / "artifact-manifest.json"
    if not manifest_path.is_file():
        return ["provenance: canonical package is missing artifact-manifest.json"]
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, ValueError) as error:
        return [f"provenance: invalid artifact manifest ({error})"]
    violations: list[str] = []
    if manifest.get("contentRevision") != revision:
        violations.append("provenance: level and artifact manifest revisions disagree")
    scene = manifest.get("scene") or {}
    restore = manifest.get("restore") or {}
    if restore.get("sourceSceneSha256") != scene.get("sha256"):
        violations.append("provenance: restore was not derived from this scene revision")
    for label, descriptor in (("scene", scene), ("restore", restore)):
        relative = Path(str(descriptor.get("path") or ""))
        asset = level_dir / relative
        if relative.is_absolute() or ".." in relative.parts or not asset.is_file():
            violations.append(f"provenance: {label} asset is missing or unsafe")
            continue
        if hashlib.sha256(asset.read_bytes()).hexdigest() != descriptor.get("sha256"):
            violations.append(f"provenance: {label} asset hash mismatch")
    level_dogs = {dog.get("id"): dog for dog in raw_level.get("dogs") or [] if isinstance(dog, dict)}
    manifest_birds = manifest.get("birds") or []
    if len(level_dogs) != len(manifest_birds):
        violations.append("provenance: active bird set differs from the artifact manifest")
    slots: set[str] = set()
    for bird in manifest_birds:
        if not isinstance(bird, dict):
            violations.append("provenance: malformed bird entry")
            continue
        bird_id = bird.get("birdId")
        slot = bird.get("compatibilitySlot")
        dog = level_dogs.get(bird_id)
        if not isinstance(dog, dict) or dog.get("compatibilitySlot") != slot or slot in slots:
            violations.append(f"provenance: identity mapping mismatch for {bird_id}")
            continue
        slots.add(slot)
        sprite = bird.get("sprite") or {}
        if bird.get("cleanupSourceSpriteSha256") != sprite.get("sha256"):
            violations.append(f"provenance: cleanup sprite hash mismatch for {bird_id}")
        sprite_path = level_dir / Path(str(sprite.get("path") or ""))
        if not sprite_path.is_file() or hashlib.sha256(sprite_path.read_bytes()).hexdigest() != sprite.get("sha256"):
            violations.append(f"provenance: sprite asset hash mismatch for {bird_id}")
    return violations


def _sprite_quality_violations(level_dir: Path) -> list[str]:
    """Deterministic sprite-quality axes (plan 2026-07-31-002 R9).

    Fast local image math only — semantic judging happens at inpaint/repair
    time, not here. Under sprite-only compositing a fresh export passes by
    construction; a failure means the package would ship visible pop-in,
    background-leak sprites, or satellite specks.
    """
    import os

    # Default OFF since 2026-08-03: paint-first compositing is the shipped
    # policy (sprite-only compositing was rejected on design grounds — birds
    # must stay embedded in the painted scene). The exclusion/coherence axes
    # assume scene == clean bg + sprite and false-positive against painted
    # scenes; opt back in with FTD_SPRITE_QUALITY_GATE=1 only for sprite-only
    # experiments.
    if os.environ.get("FTD_SPRITE_QUALITY_GATE", "0").strip().lower() in {"0", "false", "no"}:
        return []
    from levelbuilder.api.sprite_eval import evaluate_level_dir

    report = evaluate_level_dir(level_dir)
    violations = []
    for bird in report["birds"]:
        for axis, data in bird.get("axes", {}).items():
            if data.get("verdict") == "fail":
                detail = data.get("evidence") or f"score={data.get('score')}"
                violations.append(f"sprite quality: {bird['dogId']} {axis} fail ({detail})")
    return violations


def validate_level_dir(public_root: Path, level_id: str, *, sprite_quality: bool = True) -> None:
    """Raise ExportGateError when the freshly written package is not game-legal."""
    try:
        violations = _level_violations(public_root / level_id)
        if not violations:
            violations = _artifact_provenance_violations(public_root / level_id)
        if not violations and sprite_quality:
            violations = _sprite_quality_violations(public_root / level_id)
    except ExportGateError:
        raise
    except Exception as error:
        # Gate unavailable is a refusal, never a silent pass.
        raise ExportGateError(level_id, [f"gate unavailable: {error}"]) from error
    if violations:
        raise ExportGateError(level_id, violations)


def validate_corpus(public_root: Path, *, require_levels_index: bool = False) -> dict:
    """Validate every level package plus the catalog manifest when present.

    Returns a summary dict; raises ExportGateError on the first failing level
    or catalog problem.
    """
    # pathlib.glob matches dot-directories, and .catalog-staging-* /
    # .catalog-backup-* dirs survive a SIGKILL mid-export — they are not levels.
    level_paths = sorted(
        path for path in public_root.glob("*/level.json")
        if not path.parent.name.startswith(".")
    )
    for path in level_paths:
        validate_level_dir(public_root, path.parent.name)
    catalog_checked = False
    catalog_path = public_root / "catalog-manifest.json"
    if catalog_path.is_file():
        from ftd_editor.publishing.catalog import validate_catalog, verify_catalog_assets

        try:
            catalog = validate_catalog(json.loads(catalog_path.read_text()))
            levels = json.loads(catalog_path.read_text()).get("levels") or []
            if levels:
                verify_catalog_assets(catalog, public_root.parent)
            catalog_checked = True
        except ExportGateError:
            raise
        except Exception as error:
            raise ExportGateError("catalog-manifest", [str(error)]) from error
    if require_levels_index and not (public_root / "levels-index.json").is_file():
        raise ExportGateError("levels-index", ["levels-index.json required for this game"])
    return {
        "levels": len(level_paths),
        "catalogChecked": catalog_checked,
    }
