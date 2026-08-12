"""Public level export indexes and bundled manifest helpers."""

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def levels_index_path(public_levels_dir: Path) -> Path:
    return public_levels_dir / "levels-index.json"


def bundled_manifest_path(public_levels_dir: Path) -> Path:
    return public_levels_dir / "bundled-manifest.json"


def catalog_manifest_path(public_levels_dir: Path) -> Path:
    return public_levels_dir / "catalog-manifest.json"


def catalog_snapshot_dir(public_levels_dir: Path) -> Path:
    return public_levels_dir / "catalog-snapshots"


def catalog_snapshot_path(public_levels_dir: Path, catalog_revision: str) -> Path:
    return catalog_snapshot_dir(public_levels_dir) / f"{catalog_revision}.json"


class FormatError(ValueError):
    """A retained on-disk format is present but unreadable/invalid.

    FF-5: missing is a legitimate state (None/empty); present-but-invalid must
    surface loudly instead of collapsing to a default that hides corruption."""


def _load_strict_json(path: Path, label: str):
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError as error:
        raise FormatError(f"{label} is present but not valid JSON: {path} ({error})") from error
    except OSError as error:
        raise FormatError(f"{label} is present but unreadable: {path} ({error})") from error


def load_bundled_manifest(public_levels_dir: Path) -> dict | None:
    """Return the current bundled-manifest.json; None only when the file is absent."""
    manifest_path = bundled_manifest_path(public_levels_dir)
    if not manifest_path.exists():
        return None
    data = _load_strict_json(manifest_path, "bundled-manifest")
    if not isinstance(data, dict):
        raise FormatError(f"bundled-manifest must be an object, got {type(data).__name__}: {manifest_path}")
    if data.get("version") != 1:
        raise FormatError(f"bundled-manifest has unsupported version {data.get('version')!r}: {manifest_path}")
    return data


def save_bundled_manifest(public_levels_dir: Path, manifest: dict) -> None:
    """Atomic write of bundled-manifest.json."""
    manifest_path = bundled_manifest_path(public_levels_dir)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = manifest_path.with_suffix(".json.tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(manifest, f, indent=2)
        os.replace(tmp, manifest_path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def load_catalog_manifest(public_levels_dir: Path) -> dict | None:
    """Return the current production catalog manifest; None only when absent."""
    manifest_path = catalog_manifest_path(public_levels_dir)
    if not manifest_path.exists():
        return None
    data = _load_strict_json(manifest_path, "catalog-manifest")
    if not isinstance(data, dict):
        raise FormatError(f"catalog-manifest must be an object, got {type(data).__name__}: {manifest_path}")
    if data.get("version") != 1:
        raise FormatError(f"catalog-manifest has unsupported version {data.get('version')!r}: {manifest_path}")
    return data


def save_catalog_manifest(public_levels_dir: Path, manifest: dict) -> None:
    """Atomic write of catalog-manifest.json."""
    manifest_path = catalog_manifest_path(public_levels_dir)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = manifest_path.with_suffix(".json.tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(manifest, f, indent=2)
        os.replace(tmp, manifest_path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def load_catalog_snapshot(public_levels_dir: Path, catalog_revision: str) -> dict | None:
    """Return an immutable catalog snapshot by revision; None only when absent."""
    snapshot_path = catalog_snapshot_path(public_levels_dir, catalog_revision)
    if not snapshot_path.exists():
        return None
    data = _load_strict_json(snapshot_path, "catalog-snapshot")
    if not isinstance(data, dict):
        raise FormatError(f"catalog-snapshot must be an object, got {type(data).__name__}: {snapshot_path}")
    return data


def save_catalog_snapshot(public_levels_dir: Path, manifest: dict) -> None:
    """Persist a catalog-manifest-shaped immutable snapshot by catalogRevision."""
    catalog_revision = manifest.get("catalogRevision")
    if not isinstance(catalog_revision, str) or not catalog_revision.strip():
        raise ValueError("Catalog snapshot requires a non-empty catalogRevision")
    snapshot_path = catalog_snapshot_path(public_levels_dir, catalog_revision)
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = snapshot_path.with_suffix(".json.tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(manifest, f, indent=2)
        os.replace(tmp, snapshot_path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def load_levels_index(public_levels_dir: Path) -> list[dict]:
    """Return the current levels-index.json contents; empty only when absent."""
    index_path = levels_index_path(public_levels_dir)
    if not index_path.exists():
        return []
    data = _load_strict_json(index_path, "levels-index")
    if not isinstance(data, list):
        raise FormatError(f"levels-index must be a list, got {type(data).__name__}: {index_path}")
    return data


def save_levels_index(public_levels_dir: Path, entries: list[dict]) -> None:
    """Overwrite levels-index.json atomically with the given ordered entries."""
    index_path = levels_index_path(public_levels_dir)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = index_path.with_suffix(".json.tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(entries, f, indent=2)
        os.replace(tmp, index_path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def asset_descriptor(path: Path, public_path: str) -> dict:
    data = path.read_bytes()
    return {
        "hash": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "path": public_path,
    }


def _sprite_cleanup_bounds(sprite: Any) -> tuple[int, int, int, int] | None:
    if not isinstance(sprite, dict):
        return None
    cleanup = sprite.get("cleanup")
    if not isinstance(cleanup, dict):
        return None
    try:
        left = int(cleanup.get("x"))
        top = int(cleanup.get("y"))
        width = int(cleanup.get("width"))
        height = int(cleanup.get("height"))
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return left, top, left + width, top + height


def dog_sprite_public_paths(
    public_dir: Path,
    session_id: str,
    level_data: dict[str, Any],
) -> list[tuple[str, Path]]:
    """Return one valid sprite path per dog, or raise on any broken dog."""
    sprite_paths: list[tuple[str, Path]] = []
    seen_sprite_paths: set[str] = set()
    prefix = f"levels/{session_id}/"
    missing: list[str] = []
    invalid: list[str] = []
    try:
        level_width = int(level_data.get("width"))
        level_height = int(level_data.get("height"))
    except (TypeError, ValueError):
        raise ValueError(f"{session_id} level.json width/height must be integers")
    dogs = level_data.get("dogs", [])
    if not isinstance(dogs, list):
        raise ValueError(f"{session_id} level.json dogs must be a list")

    for index, dog in enumerate(dogs):
        dog_label = f"dogs[{index}]"
        if isinstance(dog, dict) and isinstance(dog.get("id"), str):
            dog_label = dog["id"]
        sprite = dog.get("sprite") if isinstance(dog, dict) else None
        image = sprite.get("image") if isinstance(sprite, dict) else None
        if not isinstance(image, str):
            missing.append(dog_label)
            continue
        cleanup_bounds = _sprite_cleanup_bounds(sprite)
        if cleanup_bounds is None:
            invalid.append(f"{dog_label}: missing sprite cleanup metadata")
            continue
        if not (
            0 <= cleanup_bounds[0] < cleanup_bounds[2] <= level_width
            and 0 <= cleanup_bounds[1] < cleanup_bounds[3] <= level_height
        ):
            invalid.append(f"{dog_label}: sprite cleanup bounds outside level")
            continue
        dog_x = dog.get("x") if isinstance(dog, dict) else None
        dog_y = dog.get("y") if isinstance(dog, dict) else None
        try:
            target_x = int(dog_x)
            target_y = int(dog_y)
        except (TypeError, ValueError):
            invalid.append(f"{dog_label}: invalid dog hitbox center")
            continue
        if not (
            cleanup_bounds[0] <= target_x <= cleanup_bounds[2]
            and cleanup_bounds[1] <= target_y <= cleanup_bounds[3]
        ):
            invalid.append(f"{dog_label}: dog hitbox center outside sprite cleanup bounds")
            continue
        if not image.startswith(prefix):
            invalid.append(f"{dog_label}: sprite path must start with {prefix!r}")
            continue
        if image in seen_sprite_paths:
            invalid.append(f"{dog_label}: duplicate sprite path {image}")
            continue
        path = public_dir / image[len(prefix):]
        if not path.exists():
            invalid.append(f"{dog_label}: missing sprite file {image}")
            continue
        sprite_paths.append((image, path))
        seen_sprite_paths.add(image)

    if missing or invalid:
        parts: list[str] = []
        if missing:
            parts.append("missing sprite metadata for " + ", ".join(missing[:12]))
        if len(missing) > 12:
            parts.append(f"+{len(missing) - 12} more missing")
        if invalid:
            parts.append("invalid sprite metadata: " + "; ".join(invalid[:6]))
        if len(invalid) > 6:
            parts.append(f"+{len(invalid) - 6} more invalid")
        raise ValueError(f"{session_id} cannot publish without one valid pickup sprite per dog: {'; '.join(parts)}")

    return sprite_paths


def public_level_manifest_entry(public_levels_dir: Path, session_id: str) -> dict:
    public_dir = public_levels_dir / session_id
    level_json_path = public_dir / "level.json"
    color_webp_path = public_dir / "color.webp"
    color_png_path = public_dir / "color.png"
    color_path = color_webp_path if color_webp_path.exists() else color_png_path
    if not level_json_path.exists() or not color_path.exists():
        raise FileNotFoundError("missing exported level.json or color image")

    with open(level_json_path) as f:
        level_data = json.load(f)

    entry = {
        "id": session_id,
        "name": level_data.get("name", session_id),
        "width": level_data.get("width"),
        "height": level_data.get("height"),
        "cohort_buckets": ["all"],
        "bundled": True,
        "assets": {
            "levelJson": asset_descriptor(level_json_path, f"levels/{session_id}/level.json"),
            "colorImage": asset_descriptor(color_path, f"levels/{session_id}/{color_path.name}"),
        },
    }

    bg_by_index: dict[str, Path] = {}
    for path in sorted(public_dir.glob("bg_*.*")):
        if path.suffix not in {".png", ".webp"}:
            continue
        index = path.stem.removeprefix("bg_")
        existing = bg_by_index.get(index)
        if existing is None or path.suffix == ".webp":
            bg_by_index[index] = path
    bg_paths = [bg_by_index[index] for index in sorted(bg_by_index)]
    if bg_paths:
        entry["assets"]["bgImages"] = [
            asset_descriptor(path, f"levels/{session_id}/{path.name}")
            for path in bg_paths
        ]

    dog_sprite_assets = [
        asset_descriptor(path, image)
        for image, path in dog_sprite_public_paths(public_dir, session_id, level_data)
    ]
    entry["assets"]["dogSprites"] = dog_sprite_assets

    return entry


def _required_asset(role: str, descriptor: dict[str, Any]) -> dict[str, Any]:
    return {"role": role, **descriptor}


def _asset_digest_parts(assets: list[dict[str, Any]]) -> bytes:
    parts = [
        f"{asset.get('role')}:{asset.get('hash')}:{asset.get('size')}:{asset.get('path')}"
        for asset in assets
    ]
    return "\n".join(sorted(parts)).encode("utf-8")


def is_all_cohort_available(cohort_buckets: list[Any]) -> bool:
    return len(cohort_buckets) == 1 and cohort_buckets[0] == "all"


def public_level_catalog_entry(
    public_levels_dir: Path,
    session_id: str,
    *,
    catalog_revision: str,
    bundled_in_app: bool = False,
    cohort_buckets: list[Any] | None = None,
    listable: bool = True,
) -> dict[str, Any]:
    """Build a production-catalog entry for one copied public level package."""
    manifest_entry = public_level_manifest_entry(public_levels_dir, session_id)
    public_dir = public_levels_dir / session_id
    assets = manifest_entry["assets"]
    required_assets = [
        _required_asset("levelJson", assets["levelJson"]),
        _required_asset("colorImage", assets["colorImage"]),
    ]

    bw_path = public_dir / "bw.png"
    if bw_path.exists():
        required_assets.append(_required_asset("bwImage", asset_descriptor(bw_path, f"levels/{session_id}/bw.png")))

    for index, descriptor in enumerate(assets.get("bgImages") or []):
        required_assets.append(_required_asset(f"bgImage:{index}", descriptor))
    for index, descriptor in enumerate(assets.get("dogSprites") or []):
        required_assets.append(_required_asset(f"dogSprite:{index}", descriptor))

    optional_assets: list[dict[str, Any]] = []
    thumbnail = assets.get("thumbnailImage")
    if isinstance(thumbnail, dict):
        optional_assets.append(_required_asset("thumbnailImage", thumbnail))
    style_variants = assets.get("styleVariants")
    if isinstance(style_variants, dict):
        for slug, descriptor in sorted(style_variants.items()):
            if isinstance(descriptor, dict):
                optional_assets.append(_required_asset(f"styleVariant:{slug}", descriptor))

    required_bytes = sum(asset["size"] for asset in required_assets)
    package_digest = hashlib.sha256(_asset_digest_parts(required_assets)).hexdigest()[:16]
    normalized_cohorts = cohort_buckets if cohort_buckets is not None else ["all"]
    globally_available = is_all_cohort_available(normalized_cohorts)
    complete = required_bytes > 0 and len(required_assets) >= 2

    return {
        "id": session_id,
        "name": manifest_entry.get("name", session_id),
        "width": manifest_entry.get("width"),
        "height": manifest_entry.get("height"),
        "packageId": f"{session_id}:{package_digest}",
        "catalogRevision": catalog_revision,
        "listable": bool(listable and globally_available and complete),
        "bundledInApp": bool(bundled_in_app),
        "cohortBuckets": normalized_cohorts,
        "allCohortAvailable": globally_available,
        "tombstonedAt": None,
        "retention": {
            "activeSequenceVersions": [],
            "rollbackEligibleSequenceVersions": [],
        },
        "package": {
            "complete": complete,
            "requiredBytes": required_bytes,
            "requiredAssets": required_assets,
            "optionalAssets": optional_assets,
        },
        "uploadedAt": utc_now_iso(),
    }


def catalog_entry_has_retention(entry: dict[str, Any]) -> bool:
    retention = entry.get("retention") if isinstance(entry, dict) else None
    if not isinstance(retention, dict):
        return False
    active = retention.get("activeSequenceVersions") or []
    rollback = retention.get("rollbackEligibleSequenceVersions") or []
    return len(active) > 0 or len(rollback) > 0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
