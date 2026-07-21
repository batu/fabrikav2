"""Confined filesystem primitives and recoverable raw bundle publication."""

from __future__ import annotations

import base64
import errno
import fcntl
import hashlib
import json
import os
import re
import shutil
import uuid
from collections.abc import Callable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Literal, Protocol, TypedDict


class FilesystemContractError(RuntimeError):
    """Raised when the configured filesystem cannot honor the durability contract."""


class ImageWriter(Protocol):
    def save(self, path: Path, *, format: str) -> None: ...


@dataclass(frozen=True, slots=True)
class FilesystemProbeReport:
    root: Path
    device: int
    locking: bool
    atomic_replace: bool
    file_fsync: bool
    directory_fsync: bool


def _absolute(path: Path) -> Path:
    return Path(os.path.abspath(path.expanduser()))


def _reject_symlink_components(path: Path) -> None:
    absolute = _absolute(path)
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        if current.is_symlink():
            raise FilesystemContractError(f"filesystem path cannot traverse a symlink: {path}")


def _nearest_existing(path: Path) -> Path:
    current = _absolute(path)
    while not current.exists():
        if current.parent == current:
            raise FilesystemContractError(f"no existing ancestor for {path}")
        current = current.parent
    return current


def _device_id(path: Path) -> int:
    return _nearest_existing(path).stat().st_dev


def _validate_relative(relative: str | Path) -> PurePosixPath:
    raw = str(relative).replace("\\", "/")
    candidate = PurePosixPath(raw)
    if not raw or candidate.is_absolute() or any(part in ("", ".", "..") for part in candidate.parts):
        raise FilesystemContractError(f"path must remain confined beneath its root: {relative}")
    return candidate


def resolve_confined(root: Path, relative: str | Path) -> Path:
    """Resolve one relative path and reject lexical or symlink traversal."""

    confined_root = root.expanduser().resolve(strict=False)
    relative_path = _validate_relative(relative)
    candidate = confined_root.joinpath(*relative_path.parts).resolve(strict=False)
    if candidate != confined_root and not candidate.is_relative_to(confined_root):
        raise FilesystemContractError(f"path must remain confined beneath {confined_root}: {relative}")
    return candidate


def require_same_filesystem(first: Path, second: Path) -> None:
    if _device_id(first) != _device_id(second):
        raise FilesystemContractError(
            f"atomic staging and destination must use the same filesystem: {first} != {second}"
        )


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    except OSError as error:
        raise FilesystemContractError(f"directory fsync is unsupported for {path}: {error}") from error
    finally:
        os.close(descriptor)


def _fsync_file(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    except OSError as error:
        raise FilesystemContractError(f"file fsync is unsupported for {path}: {error}") from error
    finally:
        os.close(descriptor)


def ensure_durable_directory(path: Path) -> Path:
    """Create a symlink-free directory chain and durably link every new component."""

    destination = _absolute(path)
    _reject_symlink_components(destination)
    missing: list[Path] = []
    current = destination
    while not current.exists():
        if current.is_symlink():
            raise FilesystemContractError(f"filesystem path cannot be a symlink: {current}")
        if current.parent == current:
            raise FilesystemContractError(f"no existing ancestor for {destination}")
        missing.append(current)
        current = current.parent
    if not current.is_dir():
        raise FilesystemContractError(f"filesystem parent is not a directory: {current}")
    for directory in reversed(missing):
        directory.mkdir()
        _fsync_directory(directory)
        _fsync_directory(directory.parent)
    return destination


def _hash_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def probe_filesystem_contract(root: Path) -> FilesystemProbeReport:
    """Prove the lock, same-directory replace, and fsync semantics U2 relies on."""

    approved_root = ensure_durable_directory(root)
    probe = approved_root / f".ftd-fs-probe-{uuid.uuid4().hex}"
    probe.mkdir()
    lock_path = probe / "lock"
    source = probe / "source"
    destination = probe / "destination"
    first_lock: int | None = None
    second_lock: int | None = None
    try:
        first_lock = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        second_lock = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(first_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            fcntl.flock(second_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.EAGAIN):
                raise FilesystemContractError(f"filesystem lock probe failed: {error}") from error
        else:
            raise FilesystemContractError("filesystem lock probe allowed two exclusive owners")

        source.write_bytes(b"source")
        _fsync_file(source)
        destination.write_bytes(b"old")
        _fsync_file(destination)
        os.replace(source, destination)
        if destination.read_bytes() != b"source" or source.exists():
            raise FilesystemContractError("same-directory atomic replace probe failed")
        _fsync_directory(probe)
        return FilesystemProbeReport(
            root=approved_root,
            device=approved_root.stat().st_dev,
            locking=True,
            atomic_replace=True,
            file_fsync=True,
            directory_fsync=True,
        )
    except FilesystemContractError:
        raise
    except OSError as error:
        raise FilesystemContractError(f"filesystem semantics probe failed for {approved_root}: {error}") from error
    finally:
        if second_lock is not None:
            os.close(second_lock)
        if first_lock is not None:
            os.close(first_lock)
        shutil.rmtree(probe, ignore_errors=True)


def _atomic_target(
    target: Path,
    write_temp: Callable[[Path], None],
    *,
    staging_dir: Path | None,
    before_replace: Callable[[], None] | None,
) -> None:
    requested_target = _absolute(target)
    if requested_target.is_symlink():
        raise FilesystemContractError(f"atomic destination cannot be a symlink: {target}")
    destination_parent = ensure_durable_directory(requested_target.parent)
    destination = destination_parent / requested_target.name
    stage_parent = ensure_durable_directory(staging_dir or destination_parent)
    require_same_filesystem(destination.parent, stage_parent)
    temporary = stage_parent / f".{destination.name}.{uuid.uuid4().hex}.tmp"
    try:
        write_temp(temporary)
        _fsync_file(temporary)
        if before_replace is not None:
            before_replace()
        os.replace(temporary, destination)
        _fsync_directory(destination.parent)
        if stage_parent != destination.parent:
            _fsync_directory(stage_parent)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_write_bytes(
    target: Path,
    content: bytes,
    *,
    staging_dir: Path | None = None,
    before_replace: Callable[[], None] | None = None,
) -> None:
    _atomic_target(
        target,
        lambda temporary: temporary.write_bytes(content),
        staging_dir=staging_dir,
        before_replace=before_replace,
    )


def encode_json(value: Any) -> bytes:
    """Match v1's established ``json.dump(..., indent=2)`` byte shape."""

    return json.dumps(value, indent=2).encode("utf-8")


def atomic_write_json(
    target: Path,
    value: Any,
    *,
    staging_dir: Path | None = None,
    before_replace: Callable[[], None] | None = None,
) -> None:
    atomic_write_bytes(
        target,
        encode_json(value),
        staging_dir=staging_dir,
        before_replace=before_replace,
    )


def atomic_write_image(
    target: Path,
    image: ImageWriter,
    *,
    image_format: str,
    staging_dir: Path | None = None,
    before_replace: Callable[[], None] | None = None,
) -> None:
    _atomic_target(
        target,
        lambda temporary: image.save(temporary, format=image_format),
        staging_dir=staging_dir,
        before_replace=before_replace,
    )


@dataclass(frozen=True, slots=True)
class RawBundleMember:
    relative_path: str
    content: bytes

    def __post_init__(self) -> None:
        _validate_relative(self.relative_path)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


@dataclass(frozen=True, slots=True)
class RawBundle:
    """An untyped but exact all-or-nothing set of FTD-owned files."""

    kind: str
    members: tuple[RawBundleMember, ...]
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.kind:
            raise FilesystemContractError("bundle kind is required")
        if not self.members:
            raise FilesystemContractError("bundle must contain at least one member")
        paths = [member.relative_path for member in self.members]
        if len(paths) != len(set(paths)):
            raise FilesystemContractError("bundle contains duplicate member paths")

    @classmethod
    def from_bytes(
        cls,
        *,
        kind: str,
        members: Sequence[tuple[str, bytes]],
        metadata: Mapping[str, Any] | None = None,
    ) -> RawBundle:
        return cls(
            kind=kind,
            members=tuple(RawBundleMember(path, bytes(content)) for path, content in members),
            metadata=dict(metadata or {}),
        )

    def manifest(self) -> dict[str, Any]:
        return {
            "format": 1,
            "kind": self.kind,
            "metadata": dict(self.metadata),
            "members": [
                {
                    "path": member.relative_path,
                    "sha256": member.sha256,
                    "size": len(member.content),
                }
                for member in self.members
            ],
        }


@dataclass(frozen=True, slots=True)
class PublishedBundle:
    selection: str
    bundle_id: str
    path: Path
    kind: str


_BUNDLE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$")
BundlePhase = Literal["staged", "candidate_installed", "selector_swapped", "committed"]
_PHASES: frozenset[str] = frozenset(
    {"staged", "candidate_installed", "selector_swapped", "committed"}
)


class RecoveryRecord(TypedDict):
    format: int
    transactionId: str
    phase: BundlePhase
    selection: str
    bundleId: str
    previousSelector: str | None


class AtomicBundleStore:
    """Install immutable complete bundles and atomically select one revision."""

    def __init__(self, root: Path):
        self.root = _absolute(root)
        _reject_symlink_components(self.root)
        self.bundles_dir = self.root / "bundles"
        self.selectors_dir = self.root / "selectors"
        self.staging_dir = self.root / ".staging"
        self.records_dir = self.root / ".recovery"
        self._prepared = False

    def prepare(self) -> None:
        if self._prepared:
            return
        for directory in (
            self.root,
            self.bundles_dir,
            self.selectors_dir,
            self.staging_dir,
            self.records_dir,
        ):
            ensure_durable_directory(directory)
        require_same_filesystem(self.root, self.staging_dir)
        self._prepared = True

    def _bundle_path(self, bundle_id: str) -> Path:
        if not _BUNDLE_ID.fullmatch(bundle_id):
            raise FilesystemContractError(f"invalid bundle id: {bundle_id!r}")
        return resolve_confined(self.bundles_dir, bundle_id)

    def _selector_path(self, selection: str) -> Path:
        relative = _validate_relative(selection)
        return resolve_confined(self.selectors_dir, str(relative) + ".json")

    def _write_record(self, record: RecoveryRecord) -> Path:
        path = resolve_confined(self.records_dir, f"{record['transactionId']}.json")
        atomic_write_json(path, record)
        return path

    def _stage_bundle(self, stage: Path, bundle: RawBundle) -> None:
        ensure_durable_directory(stage)
        for member in bundle.members:
            destination = resolve_confined(stage, member.relative_path)
            ensure_durable_directory(destination.parent)
            destination.write_bytes(member.content)
            _fsync_file(destination)
        atomic_write_json(stage / ".ftd-bundle.json", bundle.manifest())
        for directory in sorted(
            (path for path in stage.rglob("*") if path.is_dir()),
            key=lambda path: len(path.parts),
            reverse=True,
        ):
            _fsync_directory(directory)
        _fsync_directory(stage)
        self._validate_bundle(stage)

    def _validate_bundle(self, path: Path) -> dict[str, Any]:
        manifest_path = path / ".ftd-bundle.json"
        try:
            manifest = json.loads(manifest_path.read_text())
            declared = manifest["members"]
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
            raise FilesystemContractError(f"invalid bundle manifest at {manifest_path}") from error
        expected_files = {".ftd-bundle.json"}
        for item in declared:
            try:
                relative = str(item["path"])
                expected_hash = str(item["sha256"])
                expected_size = int(item["size"])
            except (KeyError, TypeError, ValueError) as error:
                raise FilesystemContractError(f"invalid member record in {manifest_path}") from error
            member = resolve_confined(path, relative)
            if not member.is_file() or member.is_symlink():
                raise FilesystemContractError(f"bundle member is not one regular file: {relative}")
            actual_size, actual_hash = _hash_file(member)
            if actual_size != expected_size or actual_hash != expected_hash:
                raise FilesystemContractError(f"bundle member hash mismatch: {relative}")
            expected_files.add(relative)
        actual_files: set[str] = set()
        for path_item in path.rglob("*"):
            if path_item.is_symlink():
                raise FilesystemContractError(f"bundle contains an unsafe symlink: {path_item}")
            if path_item.is_file():
                actual_files.add(path_item.relative_to(path).as_posix())
        if actual_files != expected_files:
            raise FilesystemContractError("bundle membership does not match its recovery manifest")
        return manifest

    def publish(
        self,
        selection: str,
        bundle: RawBundle,
        *,
        bundle_id: str | None = None,
        after_phase: Callable[[BundlePhase], None] | None = None,
    ) -> PublishedBundle:
        self.prepare()
        with self._lifecycle_lock(exclusive=False):
            return self._publish_locked(
                selection,
                bundle,
                bundle_id=bundle_id,
                after_phase=after_phase,
            )

    def _publish_locked(
        self,
        selection: str,
        bundle: RawBundle,
        *,
        bundle_id: str | None,
        after_phase: Callable[[BundlePhase], None] | None,
    ) -> PublishedBundle:
        transaction_id = uuid.uuid4().hex
        chosen_id = bundle_id or transaction_id
        candidate = self._bundle_path(chosen_id)
        if candidate.exists():
            raise FilesystemContractError(f"immutable bundle already exists: {chosen_id}")
        selector = self._selector_path(selection)
        ensure_durable_directory(selector.parent)
        stage = resolve_confined(self.staging_dir, transaction_id)
        try:
            previous = selector.read_bytes()
        except FileNotFoundError:
            previous = None
        record: RecoveryRecord = {
            "format": 1,
            "transactionId": transaction_id,
            "phase": "staged",
            "selection": selection,
            "bundleId": chosen_id,
            "previousSelector": base64.b64encode(previous).decode("ascii") if previous is not None else None,
        }
        try:
            self._stage_bundle(stage, bundle)
            self._checkpoint(record, "staged", after_phase)

            os.replace(stage, candidate)
            _fsync_directory(self.bundles_dir)
            _fsync_directory(self.staging_dir)
            self._checkpoint(record, "candidate_installed", after_phase)

            selector_value = {
                "format": 1,
                "selection": selection,
                "bundleId": chosen_id,
                "kind": bundle.kind,
                "manifestSha256": hashlib.sha256(encode_json(bundle.manifest())).hexdigest(),
            }
            atomic_write_json(selector, selector_value)
            self._checkpoint(record, "selector_swapped", after_phase)

            self._checkpoint(record, "committed", after_phase)
            self._finish_record(record)
            return PublishedBundle(selection, chosen_id, candidate, bundle.kind)
        except Exception:
            self._reconcile_record(record)
            raise

    def _checkpoint(
        self,
        record: RecoveryRecord,
        phase: BundlePhase,
        callback: Callable[[BundlePhase], None] | None,
    ) -> None:
        record["phase"] = phase
        self._write_record(record)
        if callback is not None:
            callback(phase)

    def _read_selector_bundle_id(self, selector: Path) -> str | None:
        try:
            content = selector.read_text()
        except FileNotFoundError:
            return None
        try:
            value = json.loads(content)
            bundle_id = value["bundleId"]
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
            raise FilesystemContractError(f"invalid bundle selector: {selector}") from error
        if not isinstance(bundle_id, str) or not _BUNDLE_ID.fullmatch(bundle_id):
            raise FilesystemContractError(f"invalid bundle selector id: {selector}")
        return bundle_id

    def _selector_references(self, bundle_id: str) -> bool:
        if not self.selectors_dir.exists():
            return False
        for selector in self.selectors_dir.rglob("*.json"):
            if self._read_selector_bundle_id(selector) == bundle_id:
                return True
        return False

    def _finish_record(self, record: Mapping[str, Any]) -> None:
        record_path = resolve_confined(self.records_dir, f"{record['transactionId']}.json")
        record_path.unlink(missing_ok=True)
        if self.records_dir.exists():
            _fsync_directory(self.records_dir)

    @contextmanager
    def _lifecycle_lock(self, *, exclusive: bool):
        lock_path = self.root / ".lifecycle.lock"
        descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            operation = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
            fcntl.flock(descriptor, operation)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def _reconcile_record(self, record: Mapping[str, Any]) -> None:
        phase = record.get("phase")
        if phase not in _PHASES:
            raise ValueError(f"invalid bundle recovery record phase: {phase!r}")
        transaction_id = str(record["transactionId"])
        bundle_id = str(record["bundleId"])
        selection = str(record["selection"])
        stage = resolve_confined(self.staging_dir, transaction_id)
        candidate = self._bundle_path(bundle_id)
        selector = self._selector_path(selection)
        if phase != "committed" and self._read_selector_bundle_id(selector) == bundle_id:
            encoded_previous = record.get("previousSelector")
            if encoded_previous is None:
                selector.unlink(missing_ok=True)
                if selector.parent.exists():
                    _fsync_directory(selector.parent)
            else:
                try:
                    previous = base64.b64decode(str(encoded_previous), validate=True)
                except ValueError as error:
                    raise ValueError("invalid previous selector in recovery record") from error
                atomic_write_bytes(selector, previous)
        if phase != "committed" and candidate.exists() and not self._selector_references(bundle_id):
            shutil.rmtree(candidate)
            _fsync_directory(self.bundles_dir)
        if stage.exists():
            shutil.rmtree(stage)
            _fsync_directory(self.staging_dir)
        self._finish_record(record)

    def recover(self) -> None:
        self.prepare()
        with self._lifecycle_lock(exclusive=True):
            self._recover_locked()

    def _recover_locked(self) -> None:
        records: list[dict[str, Any]] = []
        for path in sorted(self.records_dir.glob("*.json")):
            try:
                value = json.loads(path.read_text())
                if not isinstance(value, dict) or value.get("format") != 1:
                    raise ValueError
                records.append(value)
            except (OSError, json.JSONDecodeError, ValueError) as error:
                raise ValueError(f"invalid bundle recovery record: {path}") from error
        for record in records:
            self._reconcile_record(record)
        for stale in self.staging_dir.iterdir():
            if stale.is_dir() and not stale.is_symlink():
                shutil.rmtree(stale)
            else:
                stale.unlink()
        _fsync_directory(self.staging_dir)

    def _resolve_bundle(self, selection: str) -> tuple[Path, dict[str, Any]]:
        self.prepare()
        selector = self._selector_path(selection)
        bundle_id = self._read_selector_bundle_id(selector)
        if bundle_id is None:
            raise FileNotFoundError(f"bundle selection does not exist: {selection}")
        bundle = self._bundle_path(bundle_id)
        if not bundle.is_dir() or bundle.is_symlink():
            raise FilesystemContractError(f"selected bundle is missing or unsafe: {bundle_id}")
        return bundle, self._validate_bundle(bundle)

    def resolve(self, selection: str) -> Path:
        bundle, _ = self._resolve_bundle(selection)
        return bundle

    def resolve_manifest(self, selection: str) -> dict[str, Any]:
        _, manifest = self._resolve_bundle(selection)
        return manifest

    def manifests(self, *, kind: str | None = None) -> list[dict[str, Any]]:
        self.prepare()
        manifests: list[dict[str, Any]] = []
        for bundle in sorted(self.bundles_dir.iterdir()):
            if not bundle.is_dir() or bundle.is_symlink():
                continue
            manifest = self._validate_bundle(bundle)
            if kind is None or manifest.get("kind") == kind:
                manifests.append(manifest)
        return manifests
