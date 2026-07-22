"""Deterministic validation and staging of immutable FTD level packages."""

from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from ..fs import atomic_write_json, ensure_durable_directory
from .level_schema import LevelFileV1, validate_level_geometry


@dataclass(frozen=True, slots=True)
class PackageDescriptor:
    package_id: str
    level_id: str
    digest: str
    path: Path
    files: tuple[dict[str, str | int], ...]


def _file_descriptor(path: Path, relative: str) -> dict[str, str | int]:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "path": relative,
        "size": path.stat().st_size,
        "sha256": digest.hexdigest(),
    }


def stage_package(source: Path, packages_root: Path) -> PackageDescriptor:
    """Validate a complete source tree, then install it under a content identity."""

    level_path = source / "level.json"
    level = LevelFileV1.model_validate_json(level_path.read_bytes())
    native_path = source / "native" / "level.json"
    native = LevelFileV1.model_validate_json(native_path.read_bytes()) if native_path.exists() else None
    validate_level_geometry(level, native=native)
    required = [level.colorImage]
    required.extend(
        dog.sprite.image.removeprefix(f"levels/{level.id}/")
        for dog in level.dogs
        if dog.sprite is not None
    )
    for relative in required:
        candidate = (source / relative).resolve(strict=False)
        if not candidate.is_relative_to(source.resolve()) or not candidate.is_file():
            raise ValueError(f"package is missing required asset {relative}")
    files = tuple(
        _file_descriptor(path, path.relative_to(source).as_posix())
        for path in sorted(source.rglob("*"))
        if path.is_file()
    )
    manifest = {"levelId": level.id, "files": files}
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    digest = hashlib.sha256(encoded).hexdigest()
    package_id = f"{level.id}:{digest}"
    destination = packages_root / level.id / digest
    if destination.exists():
        existing = (destination / "package-manifest.json").read_text()
        expected = json.dumps(manifest, indent=2)
        if existing != expected:
            raise ValueError("existing immutable package content does not match its identity")
    else:
        ensure_durable_directory(destination.parent)
        shutil.copytree(source, destination)
        atomic_write_json(destination / "package-manifest.json", manifest)
    return PackageDescriptor(package_id, level.id, digest, destination, files)
