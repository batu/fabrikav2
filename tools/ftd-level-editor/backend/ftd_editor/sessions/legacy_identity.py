"""Deterministic read-only identity and artifact census for FTD cutover."""

from __future__ import annotations

import hashlib
import heapq
import json
import math
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal


IdentityClassification = Literal["stable", "rebindable", "ambiguous", "unsupported"]
LegacyIssueCode = Literal[
    "ambiguous_distance",
    "ambiguous_identity",
    "duplicate_stable_ids",
    "incomplete_binding",
    "invalid_variant_box",
    "missing_artifact",
    "partial_stable_identity",
    "stable_id_mismatch",
    "unbound_dog",
    "unsafe_artifact",
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
    }
)
_KNOWN_CODES = _UNSUPPORTED_CODES | _AMBIGUOUS_CODES


@dataclass(frozen=True, slots=True)
class LegacyArtifact:
    relative_path: str
    checksum: str
    size: int


@dataclass(frozen=True, slots=True)
class LegacySessionCensus:
    session_id: str
    classification: IdentityClassification
    issue_codes: tuple[LegacyIssueCode, ...]
    bindings: tuple[tuple[int, int], ...]
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


def _update_digest_from_file(digest: Any, path: Path) -> int:
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size


def _tree_checksum(root: Path) -> str:
    digest = hashlib.sha256()
    if not root.exists():
        return f"sha256:{digest.hexdigest()}"
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            digest.update(
                b"symlink\0"
                + relative.encode()
                + b"\0"
                + os.readlink(path).encode()
            )
        elif path.is_file():
            digest.update(relative.encode())
            _update_digest_from_file(digest, path)
    return f"sha256:{digest.hexdigest()}"


def _read_json(path: Path) -> Any:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"unsafe or missing JSON file: {path.name}")
    return json.loads(path.read_bytes())


def _artifact(
    session_dir: Path,
    relative: str,
    issues: set[LegacyIssueCode],
    *,
    return_content: bool = False,
) -> tuple[LegacyArtifact | None, bytes | None]:
    candidate = session_dir / relative
    if candidate.is_symlink() or not candidate.is_file():
        issues.add("unsafe_artifact" if candidate.is_symlink() else "missing_artifact")
        return None, None
    resolved = candidate.resolve()
    root = session_dir.resolve()
    if not resolved.is_relative_to(root):
        issues.add("unsafe_artifact")
        return None, None
    digest = hashlib.sha256()
    content = candidate.read_bytes() if return_content else None
    if content is None:
        size = _update_digest_from_file(digest, candidate)
    else:
        size = len(content)
        digest.update(content)
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
) -> LegacySessionCensus:
    return LegacySessionCensus(
        session_id=session_dir.name,
        classification="unsupported",
        issue_codes=("unsupported_shape",),
        bindings=(),
        artifacts=(),
        session_checksum=_digest_bytes(raw_bytes),
    )


def _classify(session_dir: Path, *, max_bind_distance: float) -> LegacySessionCensus:
    issues: set[LegacyIssueCode] = set()
    artifacts: list[LegacyArtifact] = []
    session_path = session_dir / "session.json"
    raw_bytes = b""
    try:
        if session_dir.is_symlink():
            raise ValueError("unsafe session directory")
        if session_path.is_symlink() or not session_path.is_file():
            raise ValueError("unsafe or missing session JSON")
        raw_bytes = session_path.read_bytes()
        raw = json.loads(raw_bytes)
        hitboxes = _read_json(session_dir / "hitboxes.json")
    except (OSError, ValueError, json.JSONDecodeError):
        return _unsupported_session(session_dir, raw_bytes)
    if (
        not isinstance(raw, dict)
        or not isinstance(raw.get("dogs", []), list)
        or not isinstance(hitboxes, list)
    ):
        return _unsupported_session(session_dir, raw_bytes)
    dogs = raw.get("dogs", [])
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

    centers: list[tuple[int, tuple[float, float]]] = []
    for dog in dogs:
        if not isinstance(dog, dict):
            continue
        index = dog.get("index")
        active = dog.get("activeVariant")
        if not isinstance(index, int) or isinstance(index, bool):
            issues.add("unsupported_dog_index")
            continue
        if active is None:
            continue
        if not isinstance(active, int) or isinstance(active, bool) or active < 0:
            issues.add("unsupported_active_variant")
            continue
        image_relative = f"dogs/dog_{index:02d}/variant_{active:03d}.png"
        artifact, _ = _artifact(session_dir, image_relative, issues)
        if artifact is not None:
            artifacts.append(artifact)
        box_relative = f"dogs/dog_{index:02d}/variant_{active:03d}.box.json"
        box_artifact, box_content = _artifact(
            session_dir,
            box_relative,
            issues,
            return_content=True,
        )
        if box_artifact is not None:
            artifacts.append(box_artifact)
        center = _box_center(box_content, issues)
        if center is not None:
            centers.append((index, center))

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
        if path.is_dir()
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
