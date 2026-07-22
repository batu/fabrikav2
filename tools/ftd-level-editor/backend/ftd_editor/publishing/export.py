"""Deterministic validation and staging of immutable FTD level packages."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..fs import (
    atomic_write_json,
    ensure_durable_directory,
    exclusive_file_lock,
    fsync_directory,
    fsync_tree,
)
from .level_schema import LevelFileV1, validate_level_geometry


@dataclass(frozen=True, slots=True)
class PackageDescriptor:
    package_id: str
    level_id: str
    digest: str
    path: Path
    files: tuple[dict[str, str | int], ...]


_SAFE_LEVEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$")


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
    if not _SAFE_LEVEL_ID.fullmatch(level.id):
        raise ValueError(f"invalid package level id: {level.id!r}")
    for member in source.rglob("*"):
        if member.is_symlink():
            raise ValueError(f"package source cannot contain a symlink: {member}")
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
    expected = json.dumps(manifest, indent=2)

    def validate_installed() -> None:
        try:
            existing = (destination / "package-manifest.json").read_text()
        except FileNotFoundError as error:
            raise ValueError("existing immutable package is incomplete") from error
        if existing != expected:
            raise ValueError("existing immutable package content does not match its identity")
        expected_paths = {str(item["path"]) for item in files} | {"package-manifest.json"}
        actual_paths = {
            path.relative_to(destination).as_posix()
            for path in destination.rglob("*")
            if path.is_file()
        }
        if actual_paths != expected_paths:
            raise ValueError("existing immutable package membership does not match its identity")
        for item in files:
            path = destination / str(item["path"])
            actual = _file_descriptor(path, str(item["path"]))
            if actual != item:
                raise ValueError("existing immutable package bytes do not match its identity")

    ensure_durable_directory(destination.parent)
    with exclusive_file_lock(destination.parent / ".package-install.lock"):
        if destination.exists():
            validate_installed()
        else:
            stage = destination.parent / f".{digest}.{uuid.uuid4().hex}.tmp"
            try:
                shutil.copytree(source, stage)
                atomic_write_json(stage / "package-manifest.json", manifest)
                fsync_tree(stage)
                os.rename(stage, destination)
                fsync_directory(destination.parent)
            finally:
                shutil.rmtree(stage, ignore_errors=True)
    return PackageDescriptor(package_id, level.id, digest, destination, files)
