"""Deterministic read-only identity and artifact census for FTD cutover."""

from __future__ import annotations

import hashlib
import heapq
import io
import json
import math
import os
import re
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Literal


IdentityClassification = Literal["stable", "rebindable", "ambiguous", "unsupported"]
LegacyBoxSource = Literal[
    "active", "fallback_variant_000", "fallback_first_available", "unavailable"
]
LegacyIssueCode = Literal[
    "ambiguous_distance",
    "ambiguous_identity",
    "dangling_dog_entry",
    "duplicate_stable_ids",
    "fallback_variant_box",
    "incomplete_binding",
    "invalid_variant_box",
    "missing_artifact",
    "partial_stable_identity",
    "positional_permutation",
    "session_id_mismatch",
    "stable_id_mismatch",
    "unbound_dog",
    "unsafe_artifact",
    "unsafe_dog_folder",
    "unsafe_session_entry",
    "unexpected_dog_folder",
    "unsupported_active_variant",
    "unsupported_dog_index",
    "unsupported_hitbox",
    "unsupported_shape",
]
_UNSUPPORTED_CODES: frozenset[LegacyIssueCode] = frozenset(
    {
        "unsupported_shape",
        "unsupported_dog_index",
        "unsupported_active_variant",
        "unsupported_hitbox",
        "invalid_variant_box",
        "missing_artifact",
        "unsafe_artifact",
        "unsafe_dog_folder",
        "unsafe_session_entry",
        "session_id_mismatch",
        "unexpected_dog_folder",
    }
)
_AMBIGUOUS_CODES: frozenset[LegacyIssueCode] = frozenset(
    {
        "duplicate_stable_ids",
        "stable_id_mismatch",
        "partial_stable_identity",
        "ambiguous_distance",
        "ambiguous_identity",
        "unbound_dog",
        "incomplete_binding",
        "dangling_dog_entry",
        "fallback_variant_box",
        "positional_permutation",
    }
)
_KNOWN_CODES = _UNSUPPORTED_CODES | _AMBIGUOUS_CODES
_DOG_FOLDER_RE = re.compile(r"^dog_(\d+)$")
_DOG_TOMBSTONE_RE = re.compile(r"^deleted_dog_(\d+)\.[A-Za-z0-9_-]{8}$")
_VARIANT_RE = re.compile(r"^variant_(\d{3})\.png$")
_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


@dataclass(frozen=True, slots=True)
class LegacyArtifact:
    relative_path: str
    checksum: str
    size: int


@dataclass(frozen=True, slots=True)
class LegacyBindingProvenance:
    dog_index: int
    hitbox_index: int | None
    folder_name: str
    variant_index: int
    box_source: LegacyBoxSource


@dataclass(frozen=True, slots=True)
class LegacySessionCensus:
    session_id: str
    classification: IdentityClassification
    issue_codes: tuple[LegacyIssueCode, ...]
    bindings: tuple[tuple[int, int], ...]
    binding_provenance: tuple[LegacyBindingProvenance, ...]
    live_dog_folders: tuple[str, ...]
    tombstone_dog_folders: tuple[str, ...]
    artifacts: tuple[LegacyArtifact, ...]
    session_checksum: str


@dataclass(frozen=True, slots=True)
class LegacyCensusReport:
    source_tree_checksum: str
    report_checksum: str
    sessions: tuple[LegacySessionCensus, ...]
    unexplained_count: int


def _digest_bytes(content: bytes) -> str:
    return f"sha256:{hashlib.sha256(content).hexdigest()}"


def _digest_frame(digest: Any, *parts: str | bytes | int) -> None:
    for part in parts:
        encoded = part if isinstance(part, bytes) else str(part).encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)


def _tree_checksum(root: Path) -> str:
    digest = hashlib.sha256()
    if not root.exists():
        return f"sha256:{digest.hexdigest()}"
    root_fd = os.open(root, _DIRECTORY_FLAGS)
    try:
        def walk(directory_fd: int, prefix: str) -> None:
            with os.scandir(directory_fd) as iterator:
                entries = sorted(iterator, key=lambda entry: entry.name)
            for entry in entries:
                relative = f"{prefix}/{entry.name}" if prefix else entry.name
                metadata = entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(metadata.st_mode):
                    _digest_frame(
                        digest,
                        "symlink",
                        relative,
                        os.readlink(entry.name, dir_fd=directory_fd),
                    )
                elif stat.S_ISDIR(metadata.st_mode):
                    _digest_frame(digest, "directory", relative)
                    child_fd = os.open(
                        entry.name,
                        _DIRECTORY_FLAGS,
                        dir_fd=directory_fd,
                    )
                    try:
                        opened = os.fstat(child_fd)
                        if (opened.st_dev, opened.st_ino) != (
                            metadata.st_dev,
                            metadata.st_ino,
                        ):
                            raise RuntimeError(
                                "legacy corpus changed while opening directory"
                            )
                        walk(child_fd, relative)
                    finally:
                        os.close(child_fd)
                elif stat.S_ISREG(metadata.st_mode):
                    file_fd = os.open(entry.name, _FILE_FLAGS, dir_fd=directory_fd)
                    try:
                        opened = os.fstat(file_fd)
                        if (opened.st_dev, opened.st_ino) != (
                            metadata.st_dev,
                            metadata.st_ino,
                        ):
                            raise RuntimeError(
                                "legacy corpus changed while opening file"
                            )
                        content_digest = hashlib.sha256()
                        size = 0
                        while chunk := os.read(file_fd, 1024 * 1024):
                            size += len(chunk)
                            content_digest.update(chunk)
                    finally:
                        os.close(file_fd)
                    _digest_frame(
                        digest,
                        "file",
                        relative,
                        size,
                        content_digest.digest(),
                    )
                else:
                    _digest_frame(
                        digest,
                        "special",
                        relative,
                        stat.S_IFMT(metadata.st_mode),
                        metadata.st_rdev,
                        metadata.st_size,
                    )

        walk(root_fd, "")
    finally:
        os.close(root_fd)
    return f"sha256:{digest.hexdigest()}"


@contextmanager
def _open_regular_under(root: Path, relative: str) -> Iterator[int]:
    candidate = PurePosixPath(relative)
    if (
        candidate.is_absolute()
        or not candidate.parts
        or any(part in ("", ".", "..") for part in candidate.parts)
    ):
        raise ValueError(f"unsafe relative path: {relative}")
    descriptors: list[int] = []
    try:
        active_fd = os.open(root, _DIRECTORY_FLAGS)
        descriptors.append(active_fd)
        for component in candidate.parts[:-1]:
            active_fd = os.open(component, _DIRECTORY_FLAGS, dir_fd=active_fd)
            descriptors.append(active_fd)
        file_fd = os.open(candidate.parts[-1], _FILE_FLAGS, dir_fd=active_fd)
        descriptors.append(file_fd)
        metadata = os.fstat(file_fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"unsafe or missing file: {relative}")
        yield file_fd
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def _read_regular_under(root: Path, relative: str) -> bytes:
    with _open_regular_under(root, relative) as descriptor:
        return io.FileIO(descriptor, "rb", closefd=False).readall()


def _read_json(session_dir: Path, relative: str) -> Any:
    return json.loads(_read_regular_under(session_dir, relative))


def _scan_directory_under(root: Path, relative: str) -> tuple[tuple[str, int], ...]:
    candidate = PurePosixPath(relative)
    if (
        candidate.is_absolute()
        or not candidate.parts
        or any(part in ("", ".", "..") for part in candidate.parts)
    ):
        raise ValueError(f"unsafe relative path: {relative}")
    descriptors: list[int] = []
    try:
        active_fd = os.open(root, _DIRECTORY_FLAGS)
        descriptors.append(active_fd)
        for component in candidate.parts:
            active_fd = os.open(component, _DIRECTORY_FLAGS, dir_fd=active_fd)
            descriptors.append(active_fd)
        with os.scandir(active_fd) as iterator:
            return tuple(
                sorted(
                    (
                        (entry.name, entry.stat(follow_symlinks=False).st_mode)
                        for entry in iterator
                    ),
                    key=lambda item: item[0],
                )
            )
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def _artifact(
    session_dir: Path,
    relative: str,
    issues: set[LegacyIssueCode],
    *,
    return_content: bool = False,
) -> tuple[LegacyArtifact | None, bytes | None]:
    try:
        with _open_regular_under(session_dir, relative) as descriptor:
            digest = hashlib.sha256()
            size = 0
            content_buffer = bytearray() if return_content else None
            while chunk := os.read(descriptor, 1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                if content_buffer is not None:
                    content_buffer.extend(chunk)
    except FileNotFoundError:
        issues.add("missing_artifact")
        return None, None
    except (OSError, ValueError):
        issues.add("unsafe_artifact")
        return None, None
    content = bytes(content_buffer) if content_buffer is not None else None
    return (
        LegacyArtifact(relative, f"sha256:{digest.hexdigest()}", size),
        content,
    )


def _box_center(
    content: bytes | None,
    issues: set[LegacyIssueCode],
) -> tuple[float, float] | None:
    try:
        value = json.loads(content) if content is not None else None
        box = value.get("box") if isinstance(value, dict) else None
        if not isinstance(box, list) or len(box) != 4:
            raise ValueError
        numbers = tuple(float(item) for item in box)
        if any(not math.isfinite(item) for item in numbers):
            raise ValueError
    except (ValueError, TypeError, json.JSONDecodeError):
        issues.add("invalid_variant_box")
        return None
    return ((numbers[0] + numbers[2]) / 2, (numbers[1] + numbers[3]) / 2)


def _nearest_bindings(
    centers: list[tuple[int, tuple[float, float]]],
    hitboxes: list[dict[str, Any]],
    *,
    max_bind_distance: float,
    issues: set[LegacyIssueCode],
) -> tuple[tuple[int, int], ...]:
    if not centers or not hitboxes:
        if centers or hitboxes:
            issues.add("incomplete_binding")
        return ()
    try:
        hitbox_centers = [
            (float(hitbox["x"]), float(hitbox["y"])) for hitbox in hitboxes
        ]
        if any(
            not math.isfinite(value)
            for hitbox_center in hitbox_centers
            for value in hitbox_center
        ):
            raise ValueError("hitbox coordinates must be finite")
        costs = [
            [
                math.hypot(
                    center[0] - hitbox_center[0],
                    center[1] - hitbox_center[1],
                )
                for hitbox_center in hitbox_centers
            ]
            for _, center in centers
        ]
        assignments = _minimum_cost_assignment(costs)
    except (KeyError, TypeError, ValueError):
        issues.add("unsupported_hitbox")
        return ()

    bindings: list[tuple[int, int]] = []
    for center_index, hitbox_index in assignments:
        dog_index, _ = centers[center_index]
        nearest_distances = heapq.nsmallest(2, costs[center_index])
        distance = costs[center_index][hitbox_index]
        if distance > max_bind_distance:
            issues.add("unbound_dog")
            continue
        if len(nearest_distances) > 1 and math.isclose(
            nearest_distances[0], nearest_distances[1], abs_tol=1e-6
        ):
            issues.add("ambiguous_distance")
        bindings.append((dog_index, hitbox_index))
    if len(bindings) != len(centers) or len(bindings) != len(hitboxes):
        issues.add("incomplete_binding")
    return tuple(sorted(bindings))


def _minimum_cost_assignment(costs: list[list[float]]) -> tuple[tuple[int, int], ...]:
    """Return deterministic global minimum-cost row/column pairs."""

    row_count = len(costs)
    column_count = len(costs[0])
    if any(len(row) != column_count for row in costs):
        raise ValueError("assignment cost matrix must be rectangular")
    if row_count > column_count:
        transposed = [
            [costs[row][column] for row in range(row_count)]
            for column in range(column_count)
        ]
        return tuple(
            sorted((column, row) for row, column in _minimum_cost_assignment(transposed))
        )

    potentials_by_row = [0.0] * (row_count + 1)
    potentials_by_column = [0.0] * (column_count + 1)
    matched_row = [0] * (column_count + 1)
    previous_column = [0] * (column_count + 1)
    for row in range(1, row_count + 1):
        matched_row[0] = row
        column = 0
        minimum = [math.inf] * (column_count + 1)
        used = [False] * (column_count + 1)
        while True:
            used[column] = True
            active_row = matched_row[column]
            delta = math.inf
            next_column = 0
            for candidate in range(1, column_count + 1):
                if used[candidate]:
                    continue
                reduced = (
                    costs[active_row - 1][candidate - 1]
                    - potentials_by_row[active_row]
                    - potentials_by_column[candidate]
                )
                if reduced < minimum[candidate]:
                    minimum[candidate] = reduced
                    previous_column[candidate] = column
                if minimum[candidate] < delta:
                    delta = minimum[candidate]
                    next_column = candidate
            for candidate in range(column_count + 1):
                if used[candidate]:
                    potentials_by_row[matched_row[candidate]] += delta
                    potentials_by_column[candidate] -= delta
                else:
                    minimum[candidate] -= delta
            column = next_column
            if matched_row[column] == 0:
                break
        while column:
            prior = previous_column[column]
            matched_row[column] = matched_row[prior]
            column = prior
    return tuple(
        sorted(
            (row - 1, column - 1)
            for column, row in enumerate(matched_row[1:], start=1)
            if row
        )
    )


def _unsupported_session(
    session_dir: Path,
    raw_bytes: bytes,
    *,
    issue_codes: tuple[LegacyIssueCode, ...] = ("unsupported_shape",),
    live_dog_folders: tuple[str, ...] = (),
    tombstone_dog_folders: tuple[str, ...] = (),
) -> LegacySessionCensus:
    return LegacySessionCensus(
        session_id=session_dir.name,
        classification="unsupported",
        issue_codes=issue_codes,
        bindings=(),
        binding_provenance=(),
        live_dog_folders=live_dog_folders,
        tombstone_dog_folders=tombstone_dog_folders,
        artifacts=(),
        session_checksum=_digest_bytes(raw_bytes),
    )


def _dog_folder_inventory(
    session_dir: Path,
    issues: set[LegacyIssueCode],
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    try:
        entries = _scan_directory_under(session_dir, "dogs")
    except FileNotFoundError:
        return (), ()
    except (OSError, ValueError):
        issues.add("unsafe_dog_folder")
        return (), ()
    live: list[str] = []
    tombstones: list[str] = []
    for name, mode in entries:
        if stat.S_ISLNK(mode):
            issues.add("unsafe_dog_folder")
        elif stat.S_ISDIR(mode) and _DOG_FOLDER_RE.fullmatch(name):
            live.append(name)
        elif stat.S_ISDIR(mode) and _DOG_TOMBSTONE_RE.fullmatch(name):
            tombstones.append(name)
        elif stat.S_ISDIR(mode):
            issues.add("unexpected_dog_folder")
        else:
            issues.add("dangling_dog_entry")
    return tuple(live), tuple(tombstones)


def _folder_center(
    session_dir: Path,
    folder_name: str,
    dog: dict[str, Any] | None,
    issues: set[LegacyIssueCode],
    artifacts: list[LegacyArtifact],
) -> tuple[tuple[float, float] | None, int, LegacyBoxSource]:
    available: list[int] = []
    try:
        entries = _scan_directory_under(session_dir, f"dogs/{folder_name}")
    except (OSError, ValueError):
        issues.add("unsafe_dog_folder")
        return None, -1, "unavailable"
    for name, mode in entries:
        match = _VARIANT_RE.fullmatch(name)
        if match and stat.S_ISLNK(mode):
            issues.add("unsafe_artifact")
        elif match and stat.S_ISREG(mode):
            available.append(int(match.group(1)))
    active = dog.get("activeVariant") if isinstance(dog, dict) else None
    available_set = set(available)
    candidates: list[tuple[int, LegacyBoxSource]] = []
    candidate_indices: set[int] = set()
    if isinstance(active, int) and not isinstance(active, bool) and active >= 0:
        candidates.append((active, "active"))
        candidate_indices.add(active)
    if 0 not in candidate_indices:
        candidates.append((0, "fallback_variant_000"))
        candidate_indices.add(0)
    for index in available:
        if index not in candidate_indices:
            candidates.append((index, "fallback_first_available"))
            candidate_indices.add(index)
    for variant_index, source in candidates:
        if variant_index not in available_set:
            continue
        image_relative = f"dogs/{folder_name}/variant_{variant_index:03d}.png"
        image, _ = _artifact(session_dir, image_relative, issues)
        box_relative = f"dogs/{folder_name}/variant_{variant_index:03d}.box.json"
        box_artifact, box_content = _artifact(
            session_dir,
            box_relative,
            issues,
            return_content=True,
        )
        center = _box_center(box_content, issues)
        if image is None or box_artifact is None or center is None:
            continue
        artifacts.extend((image, box_artifact))
        if source != "active":
            issues.add("fallback_variant_box")
        return center, variant_index, source
    issues.add("missing_artifact")
    return None, -1, "unavailable"


def _classify(session_dir: Path, *, max_bind_distance: float) -> LegacySessionCensus:
    issues: set[LegacyIssueCode] = set()
    artifacts: list[LegacyArtifact] = []
    raw_bytes = b""
    if session_dir.is_symlink():
        return _unsupported_session(
            session_dir,
            raw_bytes,
            issue_codes=("unsafe_session_entry",),
        )
    live_dog_folders, tombstone_dog_folders = _dog_folder_inventory(
        session_dir, issues
    )

    def unsupported() -> LegacySessionCensus:
        return _unsupported_session(
            session_dir,
            raw_bytes,
            issue_codes=tuple(sorted(issues | {"unsupported_shape"})),
            live_dog_folders=live_dog_folders,
            tombstone_dog_folders=tombstone_dog_folders,
        )

    try:
        raw_bytes = _read_regular_under(session_dir, "session.json")
        raw = json.loads(raw_bytes)
        hitboxes = _read_json(session_dir, "hitboxes.json")
    except (OSError, ValueError, json.JSONDecodeError):
        return unsupported()
    if (
        not isinstance(raw, dict)
        or not isinstance(raw.get("dogs", []), list)
        or not isinstance(hitboxes, list)
    ):
        return unsupported()
    dogs = raw.get("dogs", [])
    if raw.get("id") != session_dir.name:
        issues.add("session_id_mismatch")
    if any(not isinstance(dog, dict) for dog in dogs) or any(
        not isinstance(hitbox, dict) for hitbox in hitboxes
    ):
        issues.add("unsupported_shape")

    backgrounds = raw.get("backgrounds")
    if backgrounds is not None and not isinstance(backgrounds, list):
        issues.add("unsupported_shape")
    elif isinstance(backgrounds, list):
        for background in backgrounds:
            if not isinstance(background, dict):
                issues.add("unsupported_shape")
                continue
            referenced_file = background.get("file")
            if referenced_file is None:
                continue
            if not isinstance(referenced_file, str) or not referenced_file:
                issues.add("unsupported_shape")
                continue
            artifact, _ = _artifact(session_dir, referenced_file, issues)
            if artifact is not None:
                artifacts.append(artifact)

    dog_by_index: dict[int, dict[str, Any]] = {}
    for dog in dogs:
        if not isinstance(dog, dict):
            continue
        index = dog.get("index")
        active = dog.get("activeVariant")
        if not isinstance(index, int) or isinstance(index, bool):
            issues.add("unsupported_dog_index")
            continue
        if index in dog_by_index:
            issues.add("ambiguous_identity")
        dog_by_index[index] = dog
        if active is None:
            continue
        if not isinstance(active, int) or isinstance(active, bool) or active < 0:
            issues.add("unsupported_active_variant")
        expected_folder = f"dog_{index:02d}"
        if active is not None and expected_folder not in live_dog_folders:
            issues.add("dangling_dog_entry")
            issues.add("missing_artifact")

    centers: list[tuple[int, tuple[float, float]]] = []
    folder_sources: list[tuple[int, str, int, LegacyBoxSource]] = []
    seen_folder_indices: set[int] = set()
    for folder_name in live_dog_folders:
        match = _DOG_FOLDER_RE.fullmatch(folder_name)
        assert match is not None
        dog_index = int(match.group(1))
        duplicate_folder_index = dog_index in seen_folder_indices
        if duplicate_folder_index:
            issues.add("ambiguous_identity")
        seen_folder_indices.add(dog_index)
        if dog_index not in dog_by_index:
            issues.add("dangling_dog_entry")
        center, variant_index, box_source = _folder_center(
            session_dir,
            folder_name,
            dog_by_index.get(dog_index),
            issues,
            artifacts,
        )
        folder_sources.append((dog_index, folder_name, variant_index, box_source))
        if center is not None and not duplicate_folder_index:
            centers.append((dog_index, center))

    dog_ids = [dog.get("id") for dog in dogs if isinstance(dog, dict)]
    hitbox_ids = [hitbox.get("id") for hitbox in hitboxes if isinstance(hitbox, dict)]
    has_all_ids = len(dog_ids) == len(dogs) and all(
        isinstance(value, str) and value for value in dog_ids
    )
    hitboxes_have_all_ids = len(hitbox_ids) == len(hitboxes) and all(
        isinstance(value, str) and value for value in hitbox_ids
    )
    bindings: tuple[tuple[int, int], ...] = ()
    if has_all_ids and hitboxes_have_all_ids:
        duplicate_ids = len(set(dog_ids)) != len(dog_ids) or len(
            set(hitbox_ids)
        ) != len(hitbox_ids)
        if duplicate_ids:
            issues.add("duplicate_stable_ids")
        elif set(dog_ids) != set(hitbox_ids):
            issues.add("stable_id_mismatch")
        elif "unsupported_dog_index" not in issues:
            index_by_id = {value: index for index, value in enumerate(hitbox_ids)}
            bindings = tuple(
                sorted(
                    (int(dog["index"]), index_by_id[str(dog["id"])])
                    for dog in dogs
                    if isinstance(dog, dict)
                )
            )
    elif has_all_ids != hitboxes_have_all_ids or any(
        value is not None for value in (*dog_ids, *hitbox_ids)
    ):
        issues.add("partial_stable_identity")
    else:
        bindings = _nearest_bindings(
            centers,
            hitboxes,
            max_bind_distance=max_bind_distance,
            issues=issues,
        )
        if any(dog_index != hitbox_index for dog_index, hitbox_index in bindings):
            issues.add("positional_permutation")

    hitbox_by_dog = dict(bindings)
    binding_provenance = tuple(
        LegacyBindingProvenance(
            dog_index=dog_index,
            hitbox_index=hitbox_by_dog.get(dog_index),
            folder_name=folder_name,
            variant_index=variant_index,
            box_source=box_source,
        )
        for dog_index, folder_name, variant_index, box_source in sorted(folder_sources)
    )

    if issues & _UNSUPPORTED_CODES:
        classification: IdentityClassification = "unsupported"
    elif issues & _AMBIGUOUS_CODES:
        classification = "ambiguous"
    elif has_all_ids and hitboxes_have_all_ids:
        classification = "stable"
    else:
        classification = "rebindable"
    return LegacySessionCensus(
        session_id=session_dir.name,
        classification=classification,
        issue_codes=tuple(sorted(issues)),
        bindings=bindings,
        binding_provenance=binding_provenance,
        live_dog_folders=live_dog_folders,
        tombstone_dog_folders=tombstone_dog_folders,
        artifacts=tuple(sorted(artifacts, key=lambda artifact: artifact.relative_path)),
        session_checksum=_digest_bytes(raw_bytes),
    )


def census_legacy_sessions(
    levels_root: Path,
    *,
    max_bind_distance: float = 20,
) -> LegacyCensusReport:
    """Inspect an explicit corpus path without creating, repairing, or importing anything."""

    before = _tree_checksum(levels_root)
    sessions = tuple(
        _classify(path, max_bind_distance=max_bind_distance)
        for path in sorted(levels_root.iterdir() if levels_root.exists() else ())
        if path.is_symlink() or path.is_dir()
    )
    unexplained_count = sum(
        len(set(session.issue_codes) - _KNOWN_CODES) for session in sessions
    )
    payload = {
        "sourceTreeChecksum": before,
        "sessions": [asdict(session) for session in sessions],
        "unexplainedCount": unexplained_count,
    }
    report_checksum = _digest_bytes(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    )
    after = _tree_checksum(levels_root)
    if after != before:
        raise RuntimeError("legacy census modified its source corpus")
    return LegacyCensusReport(
        source_tree_checksum=before,
        report_checksum=report_checksum,
        sessions=sessions,
        unexplained_count=unexplained_count,
    )
