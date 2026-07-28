"""Offline helpers for the canonical level migration.

The migration has two hard constraints: it must not call providers, and it
must never infer dog identity from folder order. This module contains the
pure, testable parts of that work: census classification, tombstone-safe dog
folder enumeration, active-variant box loading, and deterministic geometric
re-binding through global minimum-cost matching.
"""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
import uuid
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
from typing import Any, Literal, Sequence

from PIL import Image, ImageChops, ImageStat
from pydantic import ValidationError
from scipy.optimize import linear_sum_assignment

from .level_schema import LevelFileV1
from .level_store import DogInput, GenerationInput, LevelInput, LevelStore

_DOG_FOLDER_RE = re.compile(r"^dog_(\d+)$")
_VARIANT_RE = re.compile(r"^variant_(\d{3})\.png$")
_BG_RE = re.compile(r"^bg_(\d{2})\.png$")
_CANONICAL_NAMESPACE = uuid.UUID("f5d4d7b8-1cc1-4c78-8c2c-8b14d2c6e8bb")
CANONICAL_MIGRATION_TIMESTAMP = "2026-06-04T00:00:00+00:00"
DEFAULT_PARITY_MAX_CHANGED_FRACTION = 0.0005
DEFAULT_PARITY_MAX_MEAN_DELTA = 0.1
DEFAULT_PARITY_MAX_STRONG_CHANGED_PIXELS = 12
COMPOSITE_DIFF_THRESHOLD = 30

SessionCensusClass = Literal[
    "clean",
    "deletion_corrupted",
    "under_count",
    "not_started",
    "missing_hitboxes",
]


@dataclass(frozen=True)
class HitboxTarget:
    index: int
    x: float
    y: float
    r: float


@dataclass(frozen=True)
class DogFolderVariant:
    dog_index: int
    folder_name: str
    variant_index: int
    variant_path: str
    box: tuple[int, int, int, int]
    center: tuple[float, float]
    low_confidence: bool = False
    provenance: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DogBinding:
    hitbox_index: int
    dog_index: int
    folder_name: str
    variant_index: int
    variant_path: str
    box: tuple[int, int, int, int]
    distance: float
    low_confidence: bool
    provenance: dict[str, Any]


@dataclass(frozen=True)
class RebindResult:
    bindings: list[DogBinding]
    unpainted_hitbox_indices: list[int]
    orphan_folder_names: list[str]
    over_threshold_folder_names: list[str]
    tied_folder_names: list[str]


@dataclass(frozen=True)
class SessionCensus:
    session_id: str
    classification: SessionCensusClass
    hitbox_count: int
    dog_folder_count: int
    session_dog_count: int
    tombstone_folder_count: int


@dataclass(frozen=True)
class VerificationIssue:
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CompositeParity:
    compared: bool
    passed: bool
    expected_path: str | None
    actual_source: str | None
    changed_pixels: int = 0
    strong_changed_pixels: int = 0
    total_pixels: int = 0
    changed_fraction: float = 0.0
    mean_delta: float = 0.0
    max_delta: int = 0
    reason: str | None = None


@dataclass(frozen=True)
class CanonicalProjection:
    level: LevelInput
    dogs: list[DogInput]
    generations: list[GenerationInput]


@dataclass(frozen=True)
class PreparedMigrationSession:
    session_id: str
    census: SessionCensus
    hitboxes: list[HitboxTarget]
    folders: list[DogFolderVariant]
    rebind: RebindResult
    projection: CanonicalProjection | None
    parity: CompositeParity | None
    issues: list[VerificationIssue]


@dataclass(frozen=True)
class PreparedPublicLevel:
    level_id: str
    projection: CanonicalProjection | None
    issues: list[VerificationIssue]


@dataclass(frozen=True)
class StoreReplacement:
    store_path: Path
    backup_path: Path | None


@dataclass(frozen=True)
class MigrationRunResult:
    levels_root: str
    store_path: str
    quarantine_root: str
    archive_root: str | None
    committed: bool
    migrated_session_ids: list[str]
    quarantined_session_ids: list[str]
    migrated_public_level_ids: list[str]
    quarantined_public_level_ids: list[str]
    sessions: list[PreparedMigrationSession]
    public_levels: list[PreparedPublicLevel]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def dog_folder_index(path: Path) -> int | None:
    if not path.is_dir():
        return None
    if path.name.startswith(".") or path.name.startswith(".killed_"):
        return None
    match = _DOG_FOLDER_RE.match(path.name)
    return int(match.group(1)) if match else None


def live_dog_folders(session_dir: Path) -> list[Path]:
    dogs_dir = session_dir / "dogs"
    if not dogs_dir.exists():
        return []
    return sorted(
        (path for path in dogs_dir.iterdir() if dog_folder_index(path) is not None),
        key=lambda path: dog_folder_index(path) or -1,
    )


def tombstone_dog_folders(session_dir: Path) -> list[Path]:
    dogs_dir = session_dir / "dogs"
    if not dogs_dir.exists():
        return []
    return sorted(
        path
        for path in dogs_dir.iterdir()
        if path.is_dir() and (path.name.startswith(".") or path.name.startswith(".killed_"))
    )


def hitbox_targets(hitboxes: Sequence[dict[str, Any]]) -> list[HitboxTarget]:
    targets: list[HitboxTarget] = []
    for index, hitbox in enumerate(hitboxes):
        targets.append(
            HitboxTarget(
                index=index,
                x=float(hitbox["x"]),
                y=float(hitbox["y"]),
                r=float(hitbox.get("r", hitbox.get("radius", 30))),
            )
        )
    return targets


def read_hitboxes(session_dir: Path) -> list[dict[str, Any]]:
    path = session_dir / "hitboxes.json"
    if not path.exists():
        return []
    parsed = load_json(path)
    return parsed if isinstance(parsed, list) else []


def read_session_json(session_dir: Path) -> dict[str, Any]:
    path = session_dir / "session.json"
    if not path.exists():
        return {}
    parsed = load_json(path)
    return parsed if isinstance(parsed, dict) else {}


def active_variant_index(raw_session: dict[str, Any], dog_index: int) -> int | None:
    dogs = raw_session.get("dogs")
    if not isinstance(dogs, list):
        return None
    for dog in dogs:
        if not isinstance(dog, dict):
            continue
        try:
            if int(dog.get("index")) != dog_index:
                continue
            active_variant = dog.get("activeVariant")
            if active_variant is None:
                return None
            return int(active_variant)
        except (TypeError, ValueError):
            continue
    return None


def variant_indices(dog_dir: Path) -> list[int]:
    indices: list[int] = []
    for child in (dog_dir.iterdir() if dog_dir.exists() else []):
        match = _VARIANT_RE.match(child.name)
        if child.is_file() and match:
            indices.append(int(match.group(1)))
    return sorted(indices)


def read_variant_box(variant_path: Path) -> tuple[int, int, int, int] | None:
    sidecar = variant_path.with_suffix(".box.json")
    if not sidecar.exists():
        return None
    try:
        parsed = load_json(sidecar)
        box = parsed.get("box") if isinstance(parsed, dict) else None
        if isinstance(box, list) and len(box) == 4:
            return tuple(int(value) for value in box)
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None
    return None


def _box_center(box: tuple[int, int, int, int]) -> tuple[float, float]:
    return ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)


def load_dog_folder_variant(session_dir: Path, raw_session: dict[str, Any], dog_dir: Path) -> DogFolderVariant | None:
    dog_index = dog_folder_index(dog_dir)
    if dog_index is None:
        return None

    active_variant = active_variant_index(raw_session, dog_index)
    available = variant_indices(dog_dir)
    if not available:
        return None

    provenance: dict[str, Any] = {"dogIndex": dog_index}
    low_confidence = False
    candidates: list[tuple[int, str]] = []
    if active_variant is not None:
        candidates.append((active_variant, "active"))
    if 0 not in [index for index, _reason in candidates]:
        candidates.append((0, "fallback_variant_000"))
    for variant_index in available:
        if variant_index not in [index for index, _reason in candidates]:
            candidates.append((variant_index, "fallback_first_available"))

    for variant_index, reason in candidates:
        variant_path = dog_dir / f"variant_{variant_index:03d}.png"
        if not variant_path.exists():
            continue
        box = read_variant_box(variant_path)
        if box is None:
            continue
        if reason != "active":
            low_confidence = True
        provenance.update({
            "boxSource": reason,
            "activeVariant": active_variant,
            "variantIndex": variant_index,
        })
        return DogFolderVariant(
            dog_index=dog_index,
            folder_name=dog_dir.name,
            variant_index=variant_index,
            variant_path=str(variant_path.relative_to(session_dir)),
            box=box,
            center=_box_center(box),
            low_confidence=low_confidence,
            provenance=provenance,
        )
    return None


def load_dog_folder_variants(session_dir: Path) -> list[DogFolderVariant]:
    raw_session = read_session_json(session_dir)
    variants = [
        variant
        for dog_dir in live_dog_folders(session_dir)
        if (variant := load_dog_folder_variant(session_dir, raw_session, dog_dir)) is not None
    ]
    return sorted(variants, key=lambda variant: variant.dog_index)


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def folder_has_tied_nearest_hitboxes(
    folder: DogFolderVariant,
    hitboxes: Sequence[HitboxTarget],
    *,
    epsilon: float = 1e-6,
) -> bool:
    if len(hitboxes) < 2:
        return False
    distances = sorted(
        distance(folder.center, (hitbox.x, hitbox.y))
        for hitbox in hitboxes
    )
    return abs(distances[0] - distances[1]) <= epsilon


def rebind_dog_folders(
    *,
    hitboxes: Sequence[HitboxTarget],
    folders: Sequence[DogFolderVariant],
    max_bind_distance: float,
) -> RebindResult:
    if not hitboxes:
        return RebindResult(
            bindings=[],
            unpainted_hitbox_indices=[],
            orphan_folder_names=[folder.folder_name for folder in folders],
            over_threshold_folder_names=[],
            tied_folder_names=[],
        )
    if not folders:
        return RebindResult(
            bindings=[],
            unpainted_hitbox_indices=[hitbox.index for hitbox in hitboxes],
            orphan_folder_names=[],
            over_threshold_folder_names=[],
            tied_folder_names=[],
        )

    costs = [
        [distance(folder.center, (hitbox.x, hitbox.y)) for hitbox in hitboxes]
        for folder in folders
    ]
    row_indices, column_indices = linear_sum_assignment(costs)
    assigned_folders: set[int] = set()
    assigned_hitboxes: set[int] = set()
    bindings: list[DogBinding] = []
    over_threshold: list[str] = []
    tied = [
        folder.folder_name
        for folder in folders
        if folder_has_tied_nearest_hitboxes(folder, hitboxes)
    ]

    for row, column in zip(row_indices, column_indices):
        folder = folders[int(row)]
        hitbox = hitboxes[int(column)]
        bind_distance = costs[int(row)][int(column)]
        assigned_folders.add(int(row))
        if bind_distance > max_bind_distance:
            over_threshold.append(folder.folder_name)
            continue
        assigned_hitboxes.add(int(column))
        provenance = {
            **folder.provenance,
            "algorithm": "hungarian_min_cost",
            "matchedHitboxIndex": hitbox.index,
            "matchedCenter": [hitbox.x, hitbox.y],
            "folderCenter": [folder.center[0], folder.center[1]],
            "distance": bind_distance,
            "lowConfidence": folder.low_confidence or folder.folder_name in tied,
        }
        bindings.append(
            DogBinding(
                hitbox_index=hitbox.index,
                dog_index=folder.dog_index,
                folder_name=folder.folder_name,
                variant_index=folder.variant_index,
                variant_path=folder.variant_path,
                box=folder.box,
                distance=bind_distance,
                low_confidence=folder.low_confidence or folder.folder_name in tied,
                provenance=provenance,
            )
        )

    unpainted = [
        hitbox.index
        for index, hitbox in enumerate(hitboxes)
        if index not in assigned_hitboxes
    ]
    orphan = [
        folder.folder_name
        for index, folder in enumerate(folders)
        if index not in assigned_folders
    ]
    orphan.extend(over_threshold)
    return RebindResult(
        bindings=sorted(bindings, key=lambda binding: binding.hitbox_index),
        unpainted_hitbox_indices=sorted(unpainted),
        orphan_folder_names=sorted(set(orphan)),
        over_threshold_folder_names=sorted(over_threshold),
        tied_folder_names=sorted(tied),
    )


def classify_live_session(session_dir: Path) -> SessionCensus:
    hitboxes = read_hitboxes(session_dir)
    raw = read_session_json(session_dir)
    folders = live_dog_folders(session_dir)
    tombstones = tombstone_dog_folders(session_dir)
    dogs = raw.get("dogs")
    session_dog_count = len(dogs) if isinstance(dogs, list) else 0
    hitbox_count = len(hitboxes)
    folder_count = len(folders)
    if hitbox_count == 0:
        classification: SessionCensusClass = "missing_hitboxes"
    elif folder_count == 0:
        classification = "not_started"
    elif folder_count == hitbox_count:
        classification = "clean"
    elif folder_count > hitbox_count:
        classification = "deletion_corrupted"
    else:
        classification = "under_count"
    return SessionCensus(
        session_id=session_dir.name,
        classification=classification,
        hitbox_count=hitbox_count,
        dog_folder_count=folder_count,
        session_dog_count=session_dog_count,
        tombstone_folder_count=len(tombstones),
    )


def census_live_sessions(levels_root: Path) -> list[SessionCensus]:
    if not levels_root.exists():
        return []
    sessions = [
        classify_live_session(path)
        for path in sorted(levels_root.iterdir())
        if path.is_dir() and (path / "session.json").exists()
    ]
    return sessions


def _issue(code: str, message: str, **details: Any) -> VerificationIssue:
    return VerificationIssue(code=code, message=message, details=details)


def _stable_uuid(*parts: object) -> str:
    return str(uuid.uuid5(_CANONICAL_NAMESPACE, ":".join(str(part) for part in parts)))


def _file_hash(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _image_size(path: Path) -> tuple[int, int] | None:
    try:
        with Image.open(path) as image:
            return image.size
    except OSError:
        return None


def _background_index(path: Path) -> int | None:
    match = _BG_RE.match(path.name)
    return int(match.group(1)) if match else None


def selected_background_path(session_dir: Path, raw_session: dict[str, Any]) -> Path | None:
    selected = raw_session.get("selected_bg")
    candidates: list[Path] = []
    if isinstance(selected, int):
        candidates.append(session_dir / f"bg_{selected:02d}.png")
    candidates.append(session_dir / "bg_00.png")
    candidates.extend(
        sorted(
            (path for path in session_dir.glob("bg_[0-9][0-9].png")),
            key=lambda path: _background_index(path) or -1,
        )
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def read_level_json(session_dir: Path) -> dict[str, Any]:
    path = session_dir / "level.json"
    if not path.exists():
        return {}
    parsed = load_json(path)
    return parsed if isinstance(parsed, dict) else {}


def level_dimensions(session_dir: Path, raw_session: dict[str, Any]) -> tuple[int, int] | None:
    level = read_level_json(session_dir)
    width = level.get("width")
    height = level.get("height")
    if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
        return width, height

    background_path = selected_background_path(session_dir, raw_session)
    if background_path is not None:
        size = _image_size(background_path)
        if size is not None:
            return size

    color_path = session_dir / "color.png"
    if color_path.exists():
        return _image_size(color_path)
    return None


def read_sprite_metadata(session_dir: Path, binding: DogBinding) -> tuple[str, dict[str, Any]] | None:
    sprite_json = (
        session_dir
        / "dogs"
        / binding.folder_name
        / f"sprite_{binding.variant_index:03d}.json"
    )
    if not sprite_json.exists():
        return None
    try:
        parsed = load_json(sprite_json)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None

    quality = parsed.get("quality")
    if isinstance(quality, dict) and quality.get("pickupUsable") is False:
        return None

    image = parsed.get("image")
    sprite_box = parsed.get("spriteBox")
    cleanup_box = parsed.get("cleanupBox")
    if not isinstance(image, str):
        return None
    if not (isinstance(sprite_box, list) and len(sprite_box) == 4):
        return None
    if not (isinstance(cleanup_box, list) and len(cleanup_box) == 4):
        return None

    image_path = session_dir / image
    if not image_path.exists():
        return None

    try:
        left, top, right, bottom = [int(value) for value in sprite_box]
        cleanup_left, cleanup_top, cleanup_right, cleanup_bottom = [
            int(value) for value in cleanup_box
        ]
        width = int(parsed.get("width", right - left))
        height = int(parsed.get("height", bottom - top))
    except (TypeError, ValueError):
        return None

    if width <= 0 or height <= 0:
        return None
    if cleanup_right <= cleanup_left or cleanup_bottom <= cleanup_top:
        return None
    return image, parsed


def _level_recipe(raw_session: dict[str, Any]) -> dict[str, Any]:
    excluded = {"dogs"}
    return {
        key: value
        for key, value in raw_session.items()
        if key not in excluded
    }


def _public_dog_id(hitbox_index: int) -> str:
    return f"dog_{hitbox_index:02d}"


def build_canonical_projection(
    *,
    session_dir: Path,
    hitboxes: Sequence[HitboxTarget],
    rebind: RebindResult,
    timestamp: str = CANONICAL_MIGRATION_TIMESTAMP,
) -> CanonicalProjection | None:
    raw_session = read_session_json(session_dir)
    dimensions = level_dimensions(session_dir, raw_session)
    if dimensions is None:
        return None
    width, height = dimensions
    level_json = read_level_json(session_dir)
    binding_by_hitbox = {binding.hitbox_index: binding for binding in rebind.bindings}
    dog_inputs: list[DogInput] = []
    generation_inputs: list[GenerationInput] = []

    for hitbox in hitboxes:
        public_id = _public_dog_id(hitbox.index)
        stable_id = _stable_uuid(session_dir.name, public_id)
        binding = binding_by_hitbox.get(hitbox.index)
        generation_id: str | None = None
        provenance: dict[str, Any] = {"unpainted": True}
        if binding is not None:
            generation_id = _stable_uuid(
                session_dir.name,
                public_id,
                binding.folder_name,
                binding.variant_index,
            )
            provenance = binding.provenance
            variant_path = session_dir / binding.variant_path
            sprite = read_sprite_metadata(session_dir, binding)
            generation_inputs.append(
                GenerationInput(
                    id=generation_id,
                    dog_stable_id=stable_id,
                    variant_index=binding.variant_index,
                    variant_path=binding.variant_path,
                    box=list(binding.box),
                    sprite_path=sprite[0] if sprite is not None else None,
                    sprite_meta=sprite[1] if sprite is not None else {},
                    source_content_hash=_file_hash(variant_path) if variant_path.exists() else None,
                    created_at=timestamp,
                )
            )

        dog_inputs.append(
            DogInput(
                stable_id=stable_id,
                public_id=public_id,
                x=int(round(hitbox.x)),
                y=int(round(hitbox.y)),
                r=max(1, int(round(hitbox.r))),
                breed=None,
                chosen_generation_id=generation_id,
                bind_provenance=provenance,
                created_at=timestamp,
            )
        )

    if not hitboxes:
        stage = "bg_only"
    elif len(rebind.bindings) == len(hitboxes):
        stage = "complete"
    elif rebind.bindings:
        stage = "painted"
    else:
        stage = "placed"

    level = LevelInput(
        id=session_dir.name,
        name=str(level_json.get("name") or session_dir.name),
        width=width,
        height=height,
        stage=stage,
        source_kind="live_session",
        recipe=_level_recipe(raw_session),
        tags=["canonical-migration"],
        draft_revision=str(raw_session.get("draftRevision")) if raw_session.get("draftRevision") is not None else None,
        created_at=timestamp,
        updated_at=timestamp,
    )
    return CanonicalProjection(level=level, dogs=dog_inputs, generations=generation_inputs)


def _box_in_bounds(box: tuple[int, int, int, int], width: int, height: int) -> bool:
    left, top, right, bottom = box
    return 0 <= left < right <= width and 0 <= top < bottom <= height


def _duplicate_values(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def _max_channel_delta(diff: Image.Image) -> Image.Image:
    """Reduce an RGB difference image to its per-pixel maximum across channels.

    PIL's ``convert("L")`` weights channels by luminance (blue contributes only
    0.114), so a large single-channel discrepancy collapses far below its true
    magnitude — a full 255 blue-only delta maps to grey 29. The parity gate
    exists to catch wrong/misbound dog variants, and a wrong-hue binding can
    differ almost entirely in one channel, so a strong delta in ANY channel must
    count as strong. Reduce by channel maximum instead of luminance.
    """
    bands = diff.split()
    reduced = bands[0]
    for band in bands[1:]:
        reduced = ImageChops.lighter(reduced, band)
    return reduced


def _diff_mask(clean_crop: Image.Image, painted_crop: Image.Image) -> Image.Image:
    diff = ImageChops.difference(clean_crop.convert("RGB"), painted_crop.convert("RGB"))
    channel_max = _max_channel_delta(diff)
    mask = channel_max.point(lambda value: 255 if value > COMPOSITE_DIFF_THRESHOLD else 0)
    channel_max.close()
    diff.close()
    return mask


def compose_bound_generations(session_dir: Path, rebind: RebindResult) -> Image.Image | None:
    raw_session = read_session_json(session_dir)
    background_path = selected_background_path(session_dir, raw_session)
    if background_path is None:
        return None

    try:
        with Image.open(background_path) as background:
            background.load()
            result = background.convert("RGB").copy()
    except OSError:
        return None

    clean_background = result.copy()
    for binding in rebind.bindings:
        variant_path = session_dir / binding.variant_path
        if not variant_path.exists():
            continue
        try:
            with Image.open(variant_path) as variant_source:
                variant_source.load()
                variant = variant_source.convert("RGB").copy()
        except OSError:
            continue

        box = binding.box
        expected_size = (box[2] - box[0], box[3] - box[1])
        if variant.size != expected_size:
            resized = variant.resize(expected_size, Image.LANCZOS)
            variant.close()
            variant = resized

        clean_crop = clean_background.crop(box)
        mask = _diff_mask(clean_crop, variant)
        result.paste(variant, (box[0], box[1]), mask=mask)
        clean_crop.close()
        mask.close()
        variant.close()

    clean_background.close()
    return result


def compare_composite_to_color(
    *,
    session_dir: Path,
    rebind: RebindResult,
    max_changed_fraction: float = DEFAULT_PARITY_MAX_CHANGED_FRACTION,
    max_mean_delta: float = DEFAULT_PARITY_MAX_MEAN_DELTA,
    max_strong_changed_pixels: int = DEFAULT_PARITY_MAX_STRONG_CHANGED_PIXELS,
) -> CompositeParity:
    color_path = session_dir / "color.png"
    if not color_path.exists():
        return CompositeParity(
            compared=False,
            passed=False,
            expected_path=None,
            actual_source="compose_bound_generations",
            reason="missing_color_png",
        )

    actual = compose_bound_generations(session_dir, rebind)
    if actual is None:
        return CompositeParity(
            compared=False,
            passed=False,
            expected_path=str(color_path),
            actual_source=None,
            reason="missing_composite_source",
        )

    try:
        with Image.open(color_path) as expected_source:
            expected_source.load()
            expected = expected_source.convert("RGB").copy()
    except OSError:
        actual.close()
        return CompositeParity(
            compared=False,
            passed=False,
            expected_path=str(color_path),
            actual_source="compose_bound_generations",
            reason="unreadable_color_png",
        )

    if expected.size != actual.size:
        total = max(1, expected.size[0] * expected.size[1])
        expected.close()
        actual.close()
        return CompositeParity(
            compared=True,
            passed=False,
            expected_path=str(color_path),
            actual_source="compose_bound_generations",
            total_pixels=total,
            changed_fraction=1.0,
            reason="size_mismatch",
        )

    diff = ImageChops.difference(expected, actual)
    channel_max = _max_channel_delta(diff)
    histogram = channel_max.histogram()
    changed_pixels = sum(histogram[1:])
    strong_changed_pixels = sum(histogram[45:])
    total_pixels = max(1, expected.size[0] * expected.size[1])
    stat = ImageStat.Stat(diff)
    mean_delta = float(sum(stat.mean) / len(stat.mean)) if stat.mean else 0.0
    max_delta = max((channel[1] for channel in diff.getextrema()), default=0)
    changed_fraction = changed_pixels / total_pixels
    passed = (
        changed_fraction <= max_changed_fraction
        and mean_delta <= max_mean_delta
        and strong_changed_pixels <= max_strong_changed_pixels
    )

    expected.close()
    actual.close()
    diff.close()
    channel_max.close()
    return CompositeParity(
        compared=True,
        passed=passed,
        expected_path=str(color_path),
        actual_source="compose_bound_generations",
        changed_pixels=changed_pixels,
        strong_changed_pixels=strong_changed_pixels,
        total_pixels=total_pixels,
        changed_fraction=changed_fraction,
        mean_delta=mean_delta,
        max_delta=max_delta,
    )


def verify_migration_session(
    *,
    session_dir: Path,
    hitboxes: Sequence[HitboxTarget],
    folders: Sequence[DogFolderVariant],
    rebind: RebindResult,
    projection: CanonicalProjection | None,
    parity: CompositeParity | None,
) -> list[VerificationIssue]:
    issues: list[VerificationIssue] = []
    if not hitboxes:
        issues.append(_issue("missing_hitboxes", "session has no hitboxes"))

    if projection is None:
        issues.append(_issue("missing_dimensions", "could not determine level width/height"))
    else:
        duplicate_stable = _duplicate_values([dog.stable_id for dog in projection.dogs])
        duplicate_public = _duplicate_values([dog.public_id for dog in projection.dogs])
        if duplicate_stable:
            issues.append(_issue("duplicate_stable_ids", "stable dog IDs are not unique", ids=duplicate_stable))
        if duplicate_public:
            issues.append(_issue("duplicate_public_ids", "public dog IDs are not unique", ids=duplicate_public))

    binding_folder_names = [binding.folder_name for binding in rebind.bindings]
    binding_hitbox_indices = [binding.hitbox_index for binding in rebind.bindings]
    duplicate_binding_folders = _duplicate_values(binding_folder_names)
    duplicate_binding_hitboxes = _duplicate_values([str(index) for index in binding_hitbox_indices])
    if duplicate_binding_folders:
        issues.append(_issue("duplicate_bound_folders", "painted folders were bound more than once", folders=duplicate_binding_folders))
    if duplicate_binding_hitboxes:
        issues.append(_issue("duplicate_bound_hitboxes", "hitboxes were bound more than once", hitboxes=duplicate_binding_hitboxes))

    if rebind.orphan_folder_names:
        issues.append(_issue("orphan_folders", "painted folders were not bound", folders=rebind.orphan_folder_names))
    if rebind.over_threshold_folder_names:
        issues.append(_issue("over_threshold", "painted folders exceeded the bind distance threshold", folders=rebind.over_threshold_folder_names))
    if rebind.tied_folder_names:
        issues.append(_issue("tied_nearest_hitboxes", "painted folders have tied nearest hitboxes", folders=rebind.tied_folder_names))

    low_confidence = [binding.folder_name for binding in rebind.bindings if binding.low_confidence]
    if low_confidence:
        issues.append(_issue("low_confidence_bindings", "bindings require manual review", folders=low_confidence))

    loaded_folder_names = {folder.folder_name for folder in folders}
    live_folder_names = {path.name for path in live_dog_folders(session_dir)}
    unloadable_folder_names = sorted(live_folder_names - loaded_folder_names)
    if unloadable_folder_names:
        issues.append(
            _issue(
                "unloadable_painted_folders",
                "live dog folders could not be loaded for geometric binding",
                folders=unloadable_folder_names,
            )
        )

    bound_folder_names = set(binding_folder_names)
    missing_bound_folders = sorted(loaded_folder_names - bound_folder_names)
    if missing_bound_folders:
        issues.append(_issue("unbound_loaded_folders", "loaded painted folders are absent from bindings", folders=missing_bound_folders))

    if projection is not None:
        width = projection.level.width
        height = projection.level.height
        for binding in rebind.bindings:
            if not _box_in_bounds(binding.box, width, height):
                issues.append(
                    _issue(
                        "box_out_of_bounds",
                        "painted variant box is outside the level bounds",
                        folder=binding.folder_name,
                        box=list(binding.box),
                        width=width,
                        height=height,
                    )
                )
            if read_sprite_metadata(session_dir, binding) is None:
                issues.append(
                    _issue(
                        "missing_sprite_metadata",
                        "bound generation lacks complete pickup sprite metadata",
                        folder=binding.folder_name,
                        variantIndex=binding.variant_index,
                    )
                )

    if rebind.bindings:
        if parity is None or not parity.compared:
            issues.append(
                _issue(
                    "missing_composite_parity",
                    "could not compare recomposed output to color.png",
                    reason=parity.reason if parity is not None else None,
                )
            )
        elif not parity.passed:
            issues.append(
                _issue(
                    "composite_parity_mismatch",
                    "recomposed bindings do not match color.png",
                    changedPixels=parity.changed_pixels,
                    strongChangedPixels=parity.strong_changed_pixels,
                    changedFraction=parity.changed_fraction,
                    meanDelta=parity.mean_delta,
                    maxDelta=parity.max_delta,
                )
            )

    return issues


def prepare_migration_session(
    *,
    session_dir: Path,
    max_bind_distance: float,
    max_parity_changed_fraction: float = DEFAULT_PARITY_MAX_CHANGED_FRACTION,
    max_parity_mean_delta: float = DEFAULT_PARITY_MAX_MEAN_DELTA,
    max_parity_strong_changed_pixels: int = DEFAULT_PARITY_MAX_STRONG_CHANGED_PIXELS,
) -> PreparedMigrationSession:
    census = classify_live_session(session_dir)
    hitboxes = hitbox_targets(read_hitboxes(session_dir))
    folders = load_dog_folder_variants(session_dir)
    rebind = rebind_dog_folders(
        hitboxes=hitboxes,
        folders=folders,
        max_bind_distance=max_bind_distance,
    )
    projection = build_canonical_projection(
        session_dir=session_dir,
        hitboxes=hitboxes,
        rebind=rebind,
    )
    parity = (
        compare_composite_to_color(
            session_dir=session_dir,
            rebind=rebind,
            max_changed_fraction=max_parity_changed_fraction,
            max_mean_delta=max_parity_mean_delta,
            max_strong_changed_pixels=max_parity_strong_changed_pixels,
        )
        if rebind.bindings
        else None
    )
    issues = verify_migration_session(
        session_dir=session_dir,
        hitboxes=hitboxes,
        folders=folders,
        rebind=rebind,
        projection=projection,
        parity=parity,
    )
    return PreparedMigrationSession(
        session_id=session_dir.name,
        census=census,
        hitboxes=list(hitboxes),
        folders=list(folders),
        rebind=rebind,
        projection=projection,
        parity=parity,
        issues=issues,
    )


def public_level_dirs(public_levels_root: Path) -> list[Path]:
    if not public_levels_root.exists():
        return []
    return sorted(
        path
        for path in public_levels_root.iterdir()
        if path.is_dir() and (path / "level.json").exists()
    )


def _public_asset_path(public_dir: Path, level_id: str, public_path: str) -> Path | None:
    prefix = f"levels/{level_id}/"
    if not public_path.startswith(prefix):
        return None
    return public_dir / public_path[len(prefix):]


def _public_sprite_box(sprite: dict[str, Any]) -> list[int] | None:
    try:
        left = int(sprite["x"])
        top = int(sprite["y"])
        width = int(sprite["width"])
        height = int(sprite["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return [left, top, left + width, top + height]


def _public_sprite_cleanup_box(sprite: dict[str, Any]) -> list[int] | None:
    cleanup = sprite.get("cleanup")
    if not isinstance(cleanup, dict):
        return None
    try:
        left = int(cleanup["x"])
        top = int(cleanup["y"])
        width = int(cleanup["width"])
        height = int(cleanup["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return [left, top, left + width, top + height]


def build_public_level_projection(
    *,
    public_dir: Path,
    timestamp: str = CANONICAL_MIGRATION_TIMESTAMP,
) -> tuple[CanonicalProjection | None, list[VerificationIssue]]:
    level_data = read_level_json(public_dir)
    issues: list[VerificationIssue] = []
    level_id = str(level_data.get("id") or public_dir.name)
    if level_id != public_dir.name:
        issues.append(
            _issue(
                "public_level_id_mismatch",
                "public level id does not match package directory",
                levelId=level_id,
                directory=public_dir.name,
            )
        )

    try:
        LevelFileV1.model_validate(level_data)
    except ValidationError as exc:
        issues.append(
            _issue(
                "public_schema_invalid",
                "public level.json failed LevelFileV1 validation",
                errorCount=exc.error_count(),
            )
        )

    try:
        width = int(level_data["width"])
        height = int(level_data["height"])
    except (KeyError, TypeError, ValueError):
        return None, issues + [_issue("missing_dimensions", "public level has no valid width/height")]

    raw_dogs = level_data.get("dogs")
    if not isinstance(raw_dogs, list) or not raw_dogs:
        return None, issues + [_issue("missing_public_dogs", "public level has no dogs")]

    level_tags = [
        str(tag)
        for tag in level_data.get("tags", [])
        if isinstance(tag, str)
    ]
    level = LevelInput(
        id=public_dir.name,
        name=str(level_data.get("name") or public_dir.name),
        width=width,
        height=height,
        stage="complete",
        source_kind="public_package",
        recipe={
            "colorImage": level_data.get("colorImage"),
            "bwImage": level_data.get("bwImage"),
            "sections": level_data.get("sections", []),
        },
        tags=sorted(set([*level_tags, "canonical-migration", "public-package"])),
        created_at=timestamp,
        updated_at=timestamp,
    )
    dogs: list[DogInput] = []
    generations: list[GenerationInput] = []

    for index, dog_data in enumerate(raw_dogs):
        if not isinstance(dog_data, dict):
            issues.append(_issue("invalid_public_dog", "public dog entry is not an object", index=index))
            continue
        public_id = dog_data.get("id")
        if not isinstance(public_id, str):
            public_id = _public_dog_id(index)
            issues.append(_issue("missing_public_dog_id", "public dog is missing an id", index=index))
        stable_id = _stable_uuid(public_dir.name, public_id)

        try:
            x = int(dog_data["x"])
            y = int(dog_data["y"])
            radius = int(dog_data["r"])
        except (KeyError, TypeError, ValueError):
            issues.append(_issue("invalid_public_dog_geometry", "public dog has invalid hitbox geometry", publicId=public_id))
            continue
        if not (0 <= x <= width and 0 <= y <= height and radius >= 1):
            issues.append(
                _issue(
                    "public_dog_out_of_bounds",
                    "public dog hitbox is outside level bounds",
                    publicId=public_id,
                    x=x,
                    y=y,
                    r=radius,
                )
            )

        generation_id: str | None = None
        sprite_meta: dict[str, Any] = {}
        sprite_path = ""
        box = [max(0, x - radius), max(0, y - radius), min(width, x + radius), min(height, y + radius)]
        sprite = dog_data.get("sprite")
        if isinstance(sprite, dict):
            sprite_image = sprite.get("image")
            if isinstance(sprite_image, str):
                sprite_file = _public_asset_path(public_dir, public_dir.name, sprite_image)
                if sprite_file is None:
                    issues.append(_issue("invalid_public_sprite_path", "public sprite path has the wrong prefix", publicId=public_id, image=sprite_image))
                elif not sprite_file.exists():
                    issues.append(_issue("missing_public_sprite_file", "public sprite image is missing", publicId=public_id, image=sprite_image))
                else:
                    sprite_path = str(sprite_file.relative_to(public_dir))
                    generation_id = _stable_uuid(public_dir.name, public_id, "public-package", sprite_path)
                    sprite_meta = sprite
                    source_hash = _file_hash(sprite_file)
                    sprite_box = _public_sprite_box(sprite)
                    if sprite_box is not None:
                        box = sprite_box
                    cleanup_box = _public_sprite_cleanup_box(sprite)
                    if cleanup_box is not None and not _box_in_bounds(tuple(cleanup_box), width, height):
                        issues.append(_issue("public_sprite_cleanup_out_of_bounds", "public sprite cleanup is outside level bounds", publicId=public_id))
                    if not _box_in_bounds(tuple(box), width, height):
                        issues.append(_issue("public_sprite_box_out_of_bounds", "public sprite box is outside level bounds", publicId=public_id))
                    generations.append(
                        GenerationInput(
                            id=generation_id,
                            dog_stable_id=stable_id,
                            variant_index=0,
                            variant_path=sprite_path,
                            box=box,
                            sprite_path=sprite_path,
                            sprite_meta=sprite_meta,
                            source_content_hash=source_hash,
                            created_at=timestamp,
                        )
                    )
            else:
                issues.append(_issue("missing_public_sprite_image", "public dog sprite is missing its image path", publicId=public_id))
        else:
            issues.append(_issue("missing_public_sprite", "public dog has no sprite metadata", publicId=public_id))

        dogs.append(
            DogInput(
                stable_id=stable_id,
                public_id=public_id,
                x=x,
                y=y,
                r=radius,
                chosen_generation_id=generation_id,
                bind_provenance={"source": "public_package", "publicId": public_id},
                created_at=timestamp,
            )
        )

    duplicate_public = _duplicate_values([dog.public_id for dog in dogs])
    duplicate_stable = _duplicate_values([dog.stable_id for dog in dogs])
    if duplicate_public:
        issues.append(_issue("duplicate_public_ids", "public dog IDs are not unique", ids=duplicate_public))
    if duplicate_stable:
        issues.append(_issue("duplicate_stable_ids", "stable dog IDs are not unique", ids=duplicate_stable))

    if not dogs:
        return None, issues + [_issue("missing_public_dogs", "public level has no valid dogs")]
    return CanonicalProjection(level=level, dogs=dogs, generations=generations), issues


def prepare_public_level(public_dir: Path) -> PreparedPublicLevel:
    projection, issues = build_public_level_projection(public_dir=public_dir)
    return PreparedPublicLevel(level_id=public_dir.name, projection=projection, issues=issues)


def checksum_tree(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}
    checksums: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            checksums[str(path.relative_to(root))] = _file_hash(path)
    return checksums


def checksum_roots(roots: Sequence[Path]) -> dict[str, dict[str, str]]:
    return {str(root.resolve()): checksum_tree(root) for root in roots}


def assert_checksum_manifest_unchanged(
    before: dict[str, dict[str, str]],
    after: dict[str, dict[str, str]],
) -> None:
    if before == after:
        return
    changed_roots = sorted(set(before) | set(after))
    changed = [
        root
        for root in changed_roots
        if before.get(root, {}) != after.get(root, {})
    ]
    raise RuntimeError(f"canonical migration mutated read-only roots: {', '.join(changed)}")


def write_pre_migration_archive_snapshot(
    levels_root: Path,
    archive_root: Path,
    source_roots: Sequence[Path] = (),
) -> Path:
    archive_root.mkdir(parents=True, exist_ok=True)
    manifest_path = archive_root / "metadata-checksums.json"
    roots = list(source_roots) if source_roots else [levels_root]
    payload = {
        "createdAt": CANONICAL_MIGRATION_TIMESTAMP,
        "levelsRoot": str(levels_root.resolve()),
        "files": checksum_tree(levels_root),
        "roots": checksum_roots(roots),
    }
    manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return manifest_path


def _write_composite_diff(session_dir: Path, rebind: RebindResult, target_path: Path) -> None:
    color_path = session_dir / "color.png"
    actual = compose_bound_generations(session_dir, rebind)
    if actual is None or not color_path.exists():
        if actual is not None:
            actual.close()
        return
    try:
        with Image.open(color_path) as expected_source:
            expected_source.load()
            expected = expected_source.convert("RGB").copy()
    except OSError:
        actual.close()
        return
    if expected.size != actual.size:
        resized = actual.resize(expected.size, Image.LANCZOS)
        actual.close()
        actual = resized
    diff = ImageChops.difference(expected, actual)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    diff.save(target_path)
    expected.close()
    actual.close()
    diff.close()


def write_quarantine_artifact(
    *,
    quarantine_root: Path,
    session_dir: Path,
    prepared: PreparedMigrationSession,
) -> Path:
    quarantine_root.mkdir(parents=True, exist_ok=True)
    artifact_path = quarantine_root / f"{prepared.session_id}.json"
    diff_path = quarantine_root / f"{prepared.session_id}.composite-diff.png"
    if any(issue.code == "composite_parity_mismatch" for issue in prepared.issues):
        _write_composite_diff(session_dir, prepared.rebind, diff_path)
    payload = {
        "sessionId": prepared.session_id,
        "classification": prepared.census.classification,
        "issues": [
            {
                "code": issue.code,
                "message": issue.message,
                "details": issue.details,
            }
            for issue in prepared.issues
        ],
        "bindings": [
            {
                "hitboxIndex": binding.hitbox_index,
                "folderName": binding.folder_name,
                "dogIndex": binding.dog_index,
                "variantIndex": binding.variant_index,
                "variantPath": binding.variant_path,
                "box": list(binding.box),
                "distance": binding.distance,
                "lowConfidence": binding.low_confidence,
                "provenance": binding.provenance,
            }
            for binding in prepared.rebind.bindings
        ],
        "unpaintedHitboxIndices": prepared.rebind.unpainted_hitbox_indices,
        "orphanFolderNames": prepared.rebind.orphan_folder_names,
        "overThresholdFolderNames": prepared.rebind.over_threshold_folder_names,
        "tiedFolderNames": prepared.rebind.tied_folder_names,
        "parity": None if prepared.parity is None else {
            "compared": prepared.parity.compared,
            "passed": prepared.parity.passed,
            "changedPixels": prepared.parity.changed_pixels,
            "strongChangedPixels": prepared.parity.strong_changed_pixels,
            "totalPixels": prepared.parity.total_pixels,
            "changedFraction": prepared.parity.changed_fraction,
            "meanDelta": prepared.parity.mean_delta,
            "maxDelta": prepared.parity.max_delta,
            "reason": prepared.parity.reason,
            "diffPath": str(diff_path) if diff_path.exists() else None,
        },
    }
    artifact_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return artifact_path


def write_quarantine_manifest(
    *,
    quarantine_root: Path,
    sessions: Sequence[PreparedMigrationSession],
) -> Path:
    quarantine_root.mkdir(parents=True, exist_ok=True)
    manifest_path = quarantine_root / "manifest.json"
    payload = {
        "createdAt": CANONICAL_MIGRATION_TIMESTAMP,
        "quarantinedSessionIds": [session.session_id for session in sessions if session.issues],
        "migratedSessionIds": [session.session_id for session in sessions if not session.issues],
    }
    manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return manifest_path


def write_public_quarantine_artifact(
    *,
    quarantine_root: Path,
    public_dir: Path,
    prepared: PreparedPublicLevel,
) -> Path:
    quarantine_root.mkdir(parents=True, exist_ok=True)
    artifact_path = quarantine_root / f"{prepared.level_id}.public.json"
    payload = {
        "levelId": prepared.level_id,
        "source": "public_package",
        "publicDir": str(public_dir),
        "issues": [
            {
                "code": issue.code,
                "message": issue.message,
                "details": issue.details,
            }
            for issue in prepared.issues
        ],
        "dogCount": 0 if prepared.projection is None else len(prepared.projection.dogs),
        "generationCount": 0 if prepared.projection is None else len(prepared.projection.generations),
    }
    artifact_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return artifact_path


def write_public_quarantine_manifest(
    *,
    quarantine_root: Path,
    public_levels: Sequence[PreparedPublicLevel],
) -> Path:
    quarantine_root.mkdir(parents=True, exist_ok=True)
    manifest_path = quarantine_root / "public-manifest.json"
    payload = {
        "createdAt": CANONICAL_MIGRATION_TIMESTAMP,
        "quarantinedPublicLevelIds": [
            public_level.level_id
            for public_level in public_levels
            if public_level.issues
        ],
        "migratedPublicLevelIds": [
            public_level.level_id
            for public_level in public_levels
            if not public_level.issues
        ],
    }
    manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return manifest_path


def _checkpoint_store(store: LevelStore) -> None:
    with store.connect() as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def _unlink_if_exists(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def _store_sidecar_paths(path: Path) -> list[Path]:
    return [path.parent / f"{path.name}{suffix}" for suffix in ("-wal", "-shm")]


def _fsync_dir(directory: Path) -> None:
    """Make the directory's rename metadata durable.

    ``os.replace`` is atomic within a running kernel but the new directory entry
    is not crash-durable until the containing directory inode is fsynced. The
    migration deletes the backup immediately after replacement, so without this
    a power loss in the writeback window can leave the store absent even though
    the migration reported success — with no backup left to recover from.
    """
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _replace_store_file(temp_store_path: Path, store_path: Path) -> StoreReplacement:
    store_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path = store_path.with_name(f".{store_path.name}.canonical-migration-backup")
    _unlink_if_exists(backup_path)
    for sidecar in _store_sidecar_paths(backup_path):
        _unlink_if_exists(sidecar)

    existing_backup: Path | None = None
    if store_path.exists():
        os.replace(store_path, backup_path)
        existing_backup = backup_path

    for sidecar in _store_sidecar_paths(store_path):
        _unlink_if_exists(sidecar)
    try:
        os.replace(temp_store_path, store_path)
    except Exception:
        if existing_backup is not None and existing_backup.exists():
            os.replace(existing_backup, store_path)
        raise
    for sidecar in _store_sidecar_paths(temp_store_path):
        _unlink_if_exists(sidecar)
    _fsync_dir(store_path.parent)
    return StoreReplacement(store_path=store_path, backup_path=existing_backup)


def _restore_store_file(replacement: StoreReplacement) -> None:
    _unlink_if_exists(replacement.store_path)
    for sidecar in _store_sidecar_paths(replacement.store_path):
        _unlink_if_exists(sidecar)
    if replacement.backup_path is not None and replacement.backup_path.exists():
        os.replace(replacement.backup_path, replacement.store_path)


def _cleanup_store_replacement(replacement: StoreReplacement) -> None:
    if replacement.backup_path is not None:
        _unlink_if_exists(replacement.backup_path)
        for sidecar in _store_sidecar_paths(replacement.backup_path):
            _unlink_if_exists(sidecar)


def rebuild_level_store(
    *,
    store_path: Path,
    sessions: Sequence[PreparedMigrationSession],
    public_levels: Sequence[PreparedPublicLevel] = (),
    readonly_roots: Sequence[Path] = (),
    source_manifest_before: dict[str, dict[str, str]] | None = None,
) -> None:
    store_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=store_path.parent, prefix=".canonical-levels-") as temp_dir:
        temp_store_path = Path(temp_dir) / "levels.sqlite"
        store = LevelStore(temp_store_path)
        for session in sessions:
            if session.issues or session.projection is None:
                continue
            store.replace_level(
                level=session.projection.level,
                dogs=session.projection.dogs,
                generations=session.projection.generations,
            )
        for public_level in public_levels:
            if public_level.issues or public_level.projection is None:
                continue
            store.replace_level(
                level=public_level.projection.level,
                dogs=public_level.projection.dogs,
                generations=public_level.projection.generations,
            )
        _checkpoint_store(store)
        if source_manifest_before is not None:
            assert_checksum_manifest_unchanged(source_manifest_before, checksum_roots(readonly_roots))
        replacement = _replace_store_file(temp_store_path, store_path)
        try:
            if source_manifest_before is not None:
                assert_checksum_manifest_unchanged(source_manifest_before, checksum_roots(readonly_roots))
        except Exception:
            _restore_store_file(replacement)
            raise
        else:
            _cleanup_store_replacement(replacement)


def run_canonical_migration(
    *,
    levels_root: Path,
    store_path: Path,
    quarantine_root: Path,
    archive_root: Path | None = None,
    public_levels_root: Path | None = None,
    session_ids: set[str] | None = None,
    commit: bool,
    max_bind_distance: float,
    readonly_roots: Sequence[Path] = (),
    max_parity_changed_fraction: float = DEFAULT_PARITY_MAX_CHANGED_FRACTION,
    max_parity_mean_delta: float = DEFAULT_PARITY_MAX_MEAN_DELTA,
    max_parity_strong_changed_pixels: int = DEFAULT_PARITY_MAX_STRONG_CHANGED_PIXELS,
) -> MigrationRunResult:
    selected_ids = session_ids or set()
    census = census_live_sessions(levels_root)
    session_dirs = [
        levels_root / item.session_id
        for item in census
        if not selected_ids or item.session_id in selected_ids
    ]
    read_only = list(readonly_roots) if readonly_roots else [levels_root]
    before_manifest = checksum_roots(read_only) if commit else {}
    prepared = [
        prepare_migration_session(
            session_dir=session_dir,
            max_bind_distance=max_bind_distance,
            max_parity_changed_fraction=max_parity_changed_fraction,
            max_parity_mean_delta=max_parity_mean_delta,
            max_parity_strong_changed_pixels=max_parity_strong_changed_pixels,
        )
        for session_dir in session_dirs
    ]
    # Only a session that actually migrates cleanly preempts its public
    # namesake. A quarantined session is not written to the store, so excluding
    # the public package on its behalf would drop the level entirely — no store
    # record and no quarantine artifact on either path. Fall back to the public
    # package instead.
    migrated_session_ids = {session.session_id for session in prepared if not session.issues}
    public_dirs = (
        [
            public_dir
            for public_dir in public_level_dirs(public_levels_root)
            if public_dir.name not in migrated_session_ids
            and (not selected_ids or public_dir.name in selected_ids)
        ]
        if public_levels_root is not None
        else []
    )
    prepared_public = [prepare_public_level(public_dir) for public_dir in public_dirs]

    if commit:
        if archive_root is not None:
            write_pre_migration_archive_snapshot(levels_root, archive_root, read_only)
        for session in prepared:
            if session.issues:
                write_quarantine_artifact(
                    quarantine_root=quarantine_root,
                    session_dir=levels_root / session.session_id,
                    prepared=session,
                )
        for public_level in prepared_public:
            if public_level.issues:
                write_public_quarantine_artifact(
                    quarantine_root=quarantine_root,
                    public_dir=(public_levels_root or levels_root) / public_level.level_id,
                    prepared=public_level,
                )
        write_quarantine_manifest(quarantine_root=quarantine_root, sessions=prepared)
        write_public_quarantine_manifest(quarantine_root=quarantine_root, public_levels=prepared_public)
        rebuild_level_store(
            store_path=store_path,
            sessions=prepared,
            public_levels=prepared_public,
            readonly_roots=read_only,
            source_manifest_before=before_manifest,
        )

    return MigrationRunResult(
        levels_root=str(levels_root.resolve()),
        store_path=str(store_path.resolve()),
        quarantine_root=str(quarantine_root.resolve()),
        archive_root=str(archive_root.resolve()) if archive_root is not None else None,
        committed=commit,
        migrated_session_ids=[session.session_id for session in prepared if not session.issues],
        quarantined_session_ids=[session.session_id for session in prepared if session.issues],
        migrated_public_level_ids=[public_level.level_id for public_level in prepared_public if not public_level.issues],
        quarantined_public_level_ids=[public_level.level_id for public_level in prepared_public if public_level.issues],
        sessions=prepared,
        public_levels=prepared_public,
    )
