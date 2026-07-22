"""Provider-free cutover rehearsal primitives for Find the Dog."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, Mapping

from .fs import ensure_durable_directory, fsync_tree, require_same_filesystem


class CutoverError(RuntimeError):
    """A rehearsal precondition failed closed."""


LegacyDisposition = Literal[
    "succeeded", "failed_terminal", "failed_retryable", "cancelled", "resolved"
]
_TERMINAL_DISPOSITIONS = frozenset(
    {"succeeded", "failed_terminal", "failed_retryable", "cancelled", "resolved"}
)


@dataclass(frozen=True, slots=True)
class LegacyArchiveRecord:
    """Historical identity only; deliberately lacks execution or ownership state."""

    request_id: str
    kind: str
    input_hash: str
    attempt_id: str
    disposition: str
    artifacts: tuple[dict[str, str], ...]

    def validate(self) -> None:
        if not all((self.request_id, self.kind, self.input_hash, self.attempt_id)):
            raise ValueError("legacy identity fields must be non-empty")
        if self.disposition not in _TERMINAL_DISPOSITIONS:
            raise ValueError("legacy disposition must be terminal or explicitly resolved")
        if not self.input_hash.startswith("sha256:"):
            raise ValueError("legacy Input Hash must be a sha256 digest")
        for artifact in self.artifacts:
            if set(artifact) != {"checksum", "locator"}:
                raise ValueError("legacy artifact requires only checksum and locator")
            if not artifact["checksum"].startswith("sha256:") or not artifact["locator"]:
                raise ValueError("legacy artifact checksum and locator are required")


@dataclass(frozen=True, slots=True)
class InventoryFile:
    relative_path: str
    size: int
    checksum: str


@dataclass(frozen=True, slots=True)
class TreeInventory:
    root: str
    files: tuple[InventoryFile, ...]
    checksum: str


@dataclass(frozen=True, slots=True)
class CloneReport:
    source: TreeInventory
    destination: TreeInventory
    excluded: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class FrozenCandidate:
    candidate_commit: str
    evidence_checksum: str
    gates: tuple[tuple[str, bool], ...]
    blocked_gates: tuple[str, ...]
    activation_allowed: bool


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def inventory_tree(root: Path, *, exclude_names: tuple[str, ...] = ()) -> TreeInventory:
    """Hash every regular file in a symlink-free tree without modifying it."""

    resolved = root.resolve(strict=True)
    files: list[InventoryFile] = []
    for path in sorted(resolved.rglob("*")):
        relative = path.relative_to(resolved).as_posix()
        if path.is_symlink():
            raise CutoverError(f"inventory refuses symlink: {relative}")
        if path.is_file() and path.name not in exclude_names:
            files.append(InventoryFile(relative, path.stat().st_size, _sha256_file(path)))
    payload = [asdict(item) for item in files]
    checksum = "sha256:" + hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return TreeInventory(str(resolved), tuple(files), checksum)


def set_tree_read_only(root: Path) -> None:
    """Remove write bits from a disposable clone before drain/copy rehearsal."""

    resolved = root.resolve(strict=True)
    for path in (resolved, *resolved.rglob("*")):
        if path.is_symlink():
            raise CutoverError(f"read-only rehearsal refuses symlink: {path}")
        mode = stat.S_IMODE(path.stat().st_mode)
        os.chmod(path, mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))


def _assert_read_only(root: Path) -> None:
    writable = [
        path
        for path in (root, *root.rglob("*"))
        if not path.is_symlink()
        and stat.S_IMODE(path.stat().st_mode)
        & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
    ]
    if writable:
        raise CutoverError(f"source must be read-only before copy: {writable[0]}")


def copy_authoring_clone(source: Path, destination: Path) -> CloneReport:
    """Copy a quiesced clone once, excluding every possible v1 runnable ledger file."""

    excluded = ("jobs.sqlite", "jobs.sqlite-shm", "jobs.sqlite-wal")
    source = source.resolve(strict=True)
    _assert_read_only(source)
    if destination.exists() and any(destination.iterdir()):
        raise CutoverError("destination must be absent or empty")
    destination = ensure_durable_directory(destination)
    require_same_filesystem(source, destination)
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        if path.name in excluded:
            continue
        target = destination / relative
        if path.is_symlink():
            raise CutoverError(f"copy refuses symlink: {relative}")
        if path.is_dir():
            target.mkdir(exist_ok=True)
        elif path.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    fsync_tree(destination)
    source_inventory = inventory_tree(source, exclude_names=excluded)
    destination_inventory = inventory_tree(destination)
    source_members = tuple((item.relative_path, item.size, item.checksum) for item in source_inventory.files)
    destination_members = tuple(
        (item.relative_path, item.size, item.checksum) for item in destination_inventory.files
    )
    if source_members != destination_members:
        raise CutoverError("cloned authoring inventory differs from source")
    return CloneReport(source_inventory, destination_inventory, tuple(name for name in excluded if (source / name).exists()))


def freeze_candidate(
    evidence_root: Path,
    *,
    candidate_commit: str,
    required_gates: Mapping[str, bool],
) -> FrozenCandidate:
    """Bind evidence to one commit while keeping human/external gates visibly blocked."""

    if len(candidate_commit) != 40 or any(char not in "0123456789abcdef" for char in candidate_commit):
        raise ValueError("candidate commit must be one exact lowercase Git SHA")
    inventory = inventory_tree(evidence_root)
    gates = tuple(sorted((name, bool(value)) for name, value in required_gates.items()))
    blocked = tuple(name for name, passed in gates if not passed)
    return FrozenCandidate(
        candidate_commit=candidate_commit,
        evidence_checksum=inventory.checksum,
        gates=gates,
        blocked_gates=blocked,
        activation_allowed=not blocked,
    )
