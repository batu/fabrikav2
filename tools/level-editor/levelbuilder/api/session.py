"""Disk-backed session management for the level editor.

Sessions are stored as folders under levelbuilder/levels/{session_id}/.
Each folder contains session.json (provenance) and generated assets.

Field authority split:
- `mode` (portrait | landscape) is authoritative for builder UI and level export.
  Stored on disk as `mode`; exposed on the wire as `orientation` so the name
  doesn't collide with future UI flow-state concepts that may also want `mode`.
- `aspect_ratio` / `image_size` remain persisted because `inpaint.py` reads them
  directly when calling `generate_image()`. For landscape, `create_session` forces
  them to "16:9" / "4K" by default, or "16:9" / "2K" when the modular upscale
  stage is enabled; for portrait, client values win.
- `sections[]` is populated once background dimensions are known (on select-bg) and
  mirrored into level.json on landscape export. Portrait exports remove any stale
  `sections` key.
"""

import json
import hashlib
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageDraw
from pydantic import ValidationError

from levelbuilder.sections import (
    BANNER_FRACTION as _SECTIONS_BANNER_FRACTION,
    HUD_FRACTION as _SECTIONS_HUD_FRACTION,
    N_SECTIONS,
    VIEWPORT_SAFE_FRACTION as _SECTIONS_VIEWPORT_SAFE_FRACTION,
    section_ranges,
)
from levelbuilder.prompts import SETTINGS
from . import public_levels as PublicLevels
from .level_schema import LevelFileV1

DEFAULT_FLATKEY_GRID = 2

# Legacy Japanese-Village session ids that predate the readable-id scheme
# (2026-04-13 shipped set). Mapped to setting='japan' for grouping.
_LEGACY_JAPAN_IDS = {
    "097f6cf2", "3f5d60a9", "849e2cfc", "b913ca42", "f150adc0",
    "tokyo_urban_bustle", "japanese_riverside_dusk",
}


def _detect_setting(session_id: str, raw: dict | None = None) -> str:
    """Infer which SETTINGS bucket a session belongs to.

    Prefers the stored `setting` field on session.json when present (sessions
    created via the readable-id scheme). Falls back to id-prefix match
    (longest-prefix wins so `nordic_cold` beats `nordic`), then to the
    hardcoded legacy list. Everything else → 'other'.
    """
    if raw is not None:
        stored = raw.get("setting")
        if isinstance(stored, str) and stored in SETTINGS:
            return stored
    if session_id in _LEGACY_JAPAN_IDS:
        return "japan"
    for key in sorted(SETTINGS.keys(), key=len, reverse=True):
        if session_id.startswith(f"{key}_"):
            return key
    return "other"

# Per-game workspace override: LEVELBUILDER_WORKSPACE points at a directory
# that owns levels/, state/, and prompts_library.json for one game. Unset, the
# builder keeps its historical FTD layout next to this module.
WORKSPACE_ROOT = Path(
    os.environ.get("LEVELBUILDER_WORKSPACE")
    or Path(__file__).resolve().parent.parent
)
LEVELS_DIR = WORKSPACE_ROOT / "levels"
LEVELS_DIR.mkdir(parents=True, exist_ok=True)

# Game paths for export. LEVELBUILDER_GAME_ROOT points at the consuming game
# folder (its public/levels receives exports); default is games/find_the_dog.
GAME_ROOT = Path(
    os.environ.get("LEVELBUILDER_GAME_ROOT")
    or Path(__file__).resolve().parents[3]
)
GAME_PUBLIC_LEVELS = GAME_ROOT / "public" / "levels"
# Compatibility aliases for older tests/callers. Runtime helpers derive paths
# from GAME_PUBLIC_LEVELS so monkeypatching the public root stays authoritative.
GAME_LEVELS_INDEX = PublicLevels.levels_index_path(GAME_PUBLIC_LEVELS)
GAME_BUNDLED_MANIFEST = PublicLevels.bundled_manifest_path(GAME_PUBLIC_LEVELS)
ARCHIVE_LEDGER_PATH = WORKSPACE_ROOT / "state" / "archive-ledger.json"

# Module-level lock for all read-modify-write operations on session.json.
# NOTE (review P1 #5): this is OVERLOADED — it guards both per-session files
# (session.json/hitboxes.json/color.png) AND the GLOBAL bundled manifest + levels
# index (reorder_bundled_manifest / reorder_levels_index have no session_id and
# rely on this lock to serialize against per-session manifest upserts). A correct
# per-session split therefore needs TWO locks (a per-session lock + a manifest
# lock, with ops touching both — export_to_game — acquiring both in a fixed order)
# and is deferred (low value now that the heavy recompose compose runs off-lock;
# see todos/053).
_session_lock = threading.Lock()
# Separate manifest lock so catalog mutations can serialize without nesting the
# session lock held by package generation and preview-manifest updates.
_catalog_lock = threading.RLock()
_archive_ledger_lock = threading.Lock()


def _load_archive_ledger() -> dict[str, dict[str, Any]]:
    try:
        payload = json.loads(ARCHIVE_LEDGER_PATH.read_text())
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    sessions = payload.get("sessions") if isinstance(payload, dict) else None
    return sessions if isinstance(sessions, dict) else {}


def archived_session_ids() -> set[str]:
    """Return persisted archived session ids without hydrating any session."""
    return {
        session_id
        for session_id, state in _load_archive_ledger().items()
        if isinstance(state, dict) and state.get("archived") is True
    }


def _save_archive_ledger(sessions: dict[str, dict[str, Any]]) -> None:
    ARCHIVE_LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ARCHIVE_LEDGER_PATH.with_suffix(f".json.tmp-{os.getpid()}-{threading.get_ident()}")
    try:
        tmp.write_text(json.dumps({"version": 1, "sessions": sessions}, indent=2, sort_keys=True))
        os.replace(tmp, ARCHIVE_LEDGER_PATH)
    finally:
        tmp.unlink(missing_ok=True)


def _record_archive_state(session_id: str, *, archived: bool, variants: list[str]) -> None:
    """Persist archive intent outside disposable authoring directories."""
    with _archive_ledger_lock:
        sessions = _load_archive_ledger()
        clean_variants = sorted({variant for variant in variants if isinstance(variant, str) and variant})
        if archived or clean_variants:
            desired = {"archived": bool(archived), "archivedVariants": clean_variants}
            if sessions.get(session_id) == desired:
                return
            sessions[session_id] = desired
        else:
            if sessions.pop(session_id, None) is None:
                return
        _save_archive_ledger(sessions)
_CATALOG_APPROVAL_REQUEST_LIMIT = 200
_CATALOG_APPROVAL_REQUESTS: dict[str, dict[str, Any]] = {}
_BG_FILE_RE = re.compile(r"^bg_(\d{2})\.png$")
_GALLERY_THUMB_MAX_LONG_EDGE = 480
_GALLERY_PREVIEW_MAX_LONG_EDGE = 1600
_GALLERY_THUMB_VARIANTS = {
    "gemini",
    "openai",
    "openai_v2",
    "gemini_bg_only",
    "openai_bg_only",
    "openai_v2_bg_only",
}


def is_painted_dog_meta(dog_meta: dict | None) -> bool:
    """Return whether per-dog metadata points to a selected variant.

    `activeVariant=None` is the explicit "No variant" sentinel. Integer 0 is
    the first real variant and must be treated as painted.
    """
    return isinstance(dog_meta, dict) and dog_meta.get("activeVariant") is not None


def gallery_thumb_variants() -> set[str]:
    return set(_GALLERY_THUMB_VARIANTS)


def _gallery_thumb_source_candidates(session_id: str, variant: str) -> list[Path]:
    sdir = session_dir(session_id)
    raw = load_session_raw(session_id) or {}
    selected_bg = raw.get("selected_bg")
    if not isinstance(selected_bg, int):
        selected_bg = 0
    selected_bg_path = sdir / f"bg_{selected_bg:02d}.png"

    match variant:
        case "gemini":
            return [sdir / "color.png", sdir / "bg_00.png"]
        case "openai":
            return [sdir / "openai_color.png", sdir / "openai_bg.png"]
        case "openai_v2":
            return [sdir / "openai_color_v2.png", sdir / "openai_bg_v2.png"]
        case "gemini_bg_only":
            return [selected_bg_path, sdir / "bg_00.png"]
        case "openai_bg_only":
            return [sdir / "openai_bg.png"]
        case "openai_v2_bg_only":
            return [sdir / "openai_bg_v2.png"]
        case _:
            return []


def ensure_gallery_thumbnail(session_id: str, variant: str) -> Path | None:
    """Return a cached small WebP thumbnail for a gallery card variant."""
    return _ensure_gallery_webp_derivative(
        session_id=session_id,
        variant=variant,
        cache_dir_name=".gallery_thumbs",
        max_long_edge=_GALLERY_THUMB_MAX_LONG_EDGE,
        quality=74,
    )


def ensure_gallery_preview(session_id: str, variant: str) -> Path | None:
    """Return a cached medium WebP preview for the gallery review modal."""
    return _ensure_gallery_webp_derivative(
        session_id=session_id,
        variant=variant,
        cache_dir_name=".gallery_previews",
        max_long_edge=_GALLERY_PREVIEW_MAX_LONG_EDGE,
        quality=82,
    )


def prewarm_gallery_derivatives(*, include_public: bool = False) -> dict[str, int]:
    """Create missing/stale gallery thumbnail and preview WebPs.

    This is intentionally sequential. The source images are large, so parallel
    Pillow conversions can make the editor feel worse by competing for disk and
    memory during startup.
    """
    result = {
        "sessions": 0,
        "variants": 0,
        "thumbnails": 0,
        "previews": 0,
        "missing": 0,
        "errors": 0,
    }

    for session in list_sessions(include_public=include_public):
        session_id = session.get("id")
        variants = session.get("variants") or []
        if not isinstance(session_id, str):
            continue
        result["sessions"] += 1

        for variant in variants:
            if not isinstance(variant, str):
                continue
            result["variants"] += 1
            try:
                thumb_path = ensure_gallery_thumbnail(session_id, variant)
                preview_path = ensure_gallery_preview(session_id, variant)
            except Exception:
                result["errors"] += 1
                continue
            if thumb_path is None and preview_path is None:
                result["missing"] += 1
                continue
            if thumb_path is not None:
                result["thumbnails"] += 1
            if preview_path is not None:
                result["previews"] += 1

    return result


def _ensure_gallery_webp_derivative(
    *,
    session_id: str,
    variant: str,
    cache_dir_name: str,
    max_long_edge: int,
    quality: int,
) -> Path | None:
    if variant not in _GALLERY_THUMB_VARIANTS:
        return None
    sdir = session_dir(session_id)
    if not sdir.exists():
        return None

    source = next((path for path in _gallery_thumb_source_candidates(session_id, variant) if path.exists()), None)
    if source is None:
        return None

    derivative_dir = sdir / cache_dir_name
    derivative_dir.mkdir(exist_ok=True)
    derivative_path = derivative_dir / f"{variant}-{source.stem}.webp"
    try:
        if derivative_path.exists() and derivative_path.stat().st_mtime_ns >= source.stat().st_mtime_ns:
            return derivative_path
    except OSError:
        pass

    tmp_path = derivative_path.with_name(f"{derivative_path.name}.tmp-{uuid.uuid4().hex}")
    try:
        with Image.open(source) as img:
            derivative = img.convert("RGB")
            derivative.thumbnail(
                (max_long_edge, max_long_edge),
                Image.Resampling.LANCZOS,
            )
            derivative.save(tmp_path, format="WEBP", quality=quality, method=4)
        os.replace(tmp_path, derivative_path)
        return derivative_path
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _sprite_metadata_path(session_id: str, dog_index: int, variant_index: int) -> Path:
    return dogs_dir(session_id) / f"dog_{dog_index:02d}" / f"sprite_{variant_index:03d}.json"


def _variant_box_path(session_id: str, dog_index: int, variant_index: int) -> Path:
    return dogs_dir(session_id) / f"dog_{dog_index:02d}" / f"variant_{variant_index:03d}.box.json"


def _read_box(path: Path) -> list[int] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    box = data.get("box") if path.name.endswith(".box.json") else data.get("sourceBox")
    if not (isinstance(box, list) and len(box) == 4):
        return None
    try:
        left, top, right, bottom = [int(v) for v in box]
    except (TypeError, ValueError):
        return None
    if right <= left or bottom <= top:
        return None
    return [left, top, right, bottom]


def _hitbox_contains_box_center(hb: dict, box: list[int], *, margin: int = 4) -> bool:
    try:
        x = float(hb["x"])
        y = float(hb["y"])
    except (KeyError, TypeError, ValueError):
        return False
    return (
        box[0] - margin <= x <= box[2] + margin
        and box[1] - margin <= y <= box[3] + margin
    )


def _nearest_hitbox_in_box(box: list[int], hitboxes: list[dict]) -> int | None:
    cx = (box[0] + box[2]) / 2.0
    cy = (box[1] + box[3]) / 2.0
    best: tuple[float, int] | None = None
    for i, hb in enumerate(hitboxes):
        if not _hitbox_contains_box_center(hb, box):
            continue
        try:
            dx = float(hb["x"]) - cx
            dy = float(hb["y"]) - cy
        except (KeyError, TypeError, ValueError):
            continue
        distance = (dx * dx + dy * dy) ** 0.5
        if best is None or distance < best[0]:
            best = (distance, i)
    return best[1] if best is not None else None


def _variant_target_index(
    session_id: str,
    dog_index: int,
    variant_index: int,
    hitboxes: list[dict] | None,
    dog_id: str | None = None,
) -> int | None:
    if hitboxes is None:
        return dog_index
    if dog_index < 0:
        return None

    # Stable-id join first (same precedent as compose_with_mask, review P1 #2):
    # a dog whose id matches a hitbox binds to it regardless of geometry —
    # without this, a dog whose hitbox moved away from the painted crop was
    # dropped here and export shipped fewer birds than the author painted.
    if dog_id:
        for i, hb in enumerate(hitboxes):
            if isinstance(hb, dict) and hb.get("id") == dog_id:
                return i

    box = _read_box(_variant_box_path(session_id, dog_index, variant_index))
    if box is None:
        return dog_index if dog_index < len(hitboxes) else None

    nearest = _nearest_hitbox_in_box(box, hitboxes)
    if nearest is not None:
        return nearest

    if dog_index < len(hitboxes) and _hitbox_contains_box_center(hitboxes[dog_index], box):
        return dog_index
    return None


def active_dog_variant_targets(
    session_id: str,
    dogs_meta: list[dict],
    hitboxes: list[dict] | None = None,
) -> dict[int, tuple[int, int]]:
    """Map exported hitbox index to selected dog-dir/variant pair.

    A few older landscape sessions have final color images and hitboxes that
    are correct, but per-dog variant directories shifted after one dog was
    marked as "No variant". The variant sidecar box is authoritative for where
    the painted crop actually lands, so use it to remap stale dog-dir indices
    back to the hitbox they cover.
    """
    targets: dict[int, tuple[int, int]] = {}
    for dog_meta in dogs_meta:
        if not isinstance(dog_meta, dict) or not is_painted_dog_meta(dog_meta):
            continue
        try:
            dog_index = int(dog_meta["index"])
            variant_index = int(dog_meta["activeVariant"])
        except (KeyError, TypeError, ValueError):
            continue
        target_index = _variant_target_index(
            session_id, dog_index, variant_index, hitboxes,
            dog_id=dog_meta.get("id") if isinstance(dog_meta.get("id"), str) else None,
        )
        if target_index is None:
            continue
        targets[target_index] = (dog_index, variant_index)
    return targets


def _level_sprite_metadata(session_id: str, dog_index: int, variant_index: int) -> dict | None:
    """Return level.json-ready sprite metadata for one active dog variant."""
    path = _sprite_metadata_path(session_id, dog_index, variant_index)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None

    image = data.get("image")
    sprite_box = data.get("spriteBox")
    cleanup_box = data.get("cleanupBox")
    quality = data.get("quality")
    if isinstance(quality, dict) and quality.get("pickupUsable") is False:
        return None
    if not isinstance(image, str):
        return None
    if not (isinstance(sprite_box, list) and len(sprite_box) == 4):
        return None
    if not (isinstance(cleanup_box, list) and len(cleanup_box) == 4):
        return None

    image_path = session_dir(session_id) / image
    if not image_path.exists():
        return None

    try:
        left, top, right, bottom = [int(v) for v in sprite_box]
        cleanup_left, cleanup_top, cleanup_right, cleanup_bottom = [
            int(v) for v in cleanup_box
        ]
        width = int(data.get("width", right - left))
        height = int(data.get("height", bottom - top))
        anchor_x = float(data.get("anchorX", 0.5))
        anchor_y = float(data.get("anchorY", 0.5))
    except (TypeError, ValueError):
        return None

    if width <= 0 or height <= 0:
        return None
    cleanup_width = cleanup_right - cleanup_left
    cleanup_height = cleanup_bottom - cleanup_top
    if cleanup_width <= 0 or cleanup_height <= 0:
        return None

    return {
        "image": f"levels/{session_id}/{image}",
        "x": left,
        "y": top,
        "width": width,
        "height": height,
        "cleanup": {
            "x": cleanup_left,
            "y": cleanup_top,
            "width": cleanup_width,
            "height": cleanup_height,
        },
        "anchorX": round(min(1.0, max(0.0, anchor_x)), 4),
        "anchorY": round(min(1.0, max(0.0, anchor_y)), 4),
    }


def active_sprite_metadata_map(
    session_id: str,
    dogs_meta: list[dict],
    hitboxes: list[dict] | None = None,
) -> dict[int, dict]:
    """Map dog index to level.json sprite metadata for selected variants."""
    sprites: dict[int, dict] = {}
    for target_index, (dog_index, variant_index) in active_dog_variant_targets(
        session_id,
        dogs_meta,
        hitboxes,
    ).items():
        sprite = _level_sprite_metadata(session_id, dog_index, variant_index)
        if sprite is not None:
            sprites[target_index] = sprite
    return sprites


def require_all_painted_dogs_mapped(
    session_id: str,
    dogs_meta: list[dict],
    target_map: dict[int, tuple[int, int]],
) -> None:
    """Fail export when a painted dog maps to no hitbox instead of vanishing.

    `active_dog_variant_targets` drops a dog whose variant box no longer sits
    near any hitbox (e.g. the hitbox was moved far away after painting). That
    drop was SILENT: the level simply shipped with fewer birds than the author
    painted, and the HUD counted the smaller number. Verified live 2026-07-29 —
    one displaced hitbox produced a 19-bird package from a 20-bird session with
    no error anywhere. Fail visibly instead; the fix is to move the hitbox back
    (or `fix-hitboxes`) and re-export.
    """
    mapped_dog_indices = {dog_index for dog_index, _ in target_map.values()}
    orphaned = [
        int(dog["index"])
        for dog in dogs_meta
        if isinstance(dog, dict)
        and is_painted_dog_meta(dog)
        and isinstance(dog.get("index"), int)
        and int(dog["index"]) not in mapped_dog_indices
    ]
    if orphaned and not target_map:
        raise LevelNotReadyError(
            f"{len(orphaned)} painted dog(s) in {session_id} map to no hitbox because the "
            "session has no usable hitboxes — place hitboxes before exporting."
        )
    if orphaned:
        labels = ", ".join(f"dog_{i:02d}" for i in sorted(orphaned)[:12])
        suffix = "" if len(orphaned) <= 12 else f", +{len(orphaned) - 12} more"
        raise LevelNotReadyError(
            f"{len(orphaned)} painted dog(s) in {session_id} no longer map to any hitbox: "
            f"{labels}{suffix}. Their hitboxes moved away from the painted art — "
            "re-run fix-hitboxes or restore the placements before exporting."
        )


def require_sprite_metadata_for_indices(
    *,
    session_id: str,
    sprite_metadata_by_index: dict[int, dict],
    painted_indices: list[int],
) -> None:
    """Fail export when any dog that would ship lacks a pickup sprite.

    Restoration mode depends on `dog.sprite` for the fly-to-counter affordance
    and `dog.sprite.cleanup` for the removal footprint. A dog without complete
    sprite cleanup metadata would force a second runtime cleanup path, which is
    exactly the bad public state this gate prevents.
    """
    missing = [i for i in painted_indices if i not in sprite_metadata_by_index]
    if missing:
        missing_labels = ", ".join(f"dog_{i:02d}" for i in missing[:12])
        suffix = "" if len(missing) <= 12 else f", +{len(missing) - 12} more"
        raise LevelNotReadyError(
            f"missing pickup sprite cleanup metadata for {len(missing)} dog(s) in {session_id}: "
            f"{missing_labels}{suffix}. Run pickup sprite repair before export."
        )


_DOG_FOLDER_RE = re.compile(r"^dog_(\d+)$")
_SPRITE_META_RE = re.compile(r"^sprite_(\d{3})\.json$")
_SPRITE_IMAGE_RE = re.compile(r"^sprite_(\d{3})\.png$")


def _sprite_candidate_status(
    *,
    data: Any,
    image_path_valid: bool,
    image_exists: bool,
    image_readable: bool,
) -> tuple[str, str | None]:
    if not isinstance(data, dict):
        return "invalid_metadata", "metadata is missing or unreadable"
    quality = data.get("quality")
    if isinstance(quality, dict) and quality.get("pickupUsable") is False:
        return "not_pickup_usable", "sprite metadata marks this pickup as unusable"
    image = data.get("image")
    if not isinstance(image, str) or not image:
        return "invalid_metadata", "metadata does not include an image path"
    if not image_path_valid:
        return "invalid_metadata", "metadata image path must stay inside the session"
    if not image_exists:
        return "missing_image", "sprite image file is missing"
    if not image_readable:
        return "invalid_image", "sprite image file could not be read"
    return "ready", None


def _session_relative_asset_path(session_id: str, value: str) -> tuple[str, Path] | None:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        return None
    normalized = path.as_posix()
    try:
        resolved = (session_dir(session_id) / normalized).resolve()
        resolved.relative_to(session_dir(session_id).resolve())
    except ValueError:
        return None
    return normalized, resolved


def sprite_animation_candidates(session_id: str) -> list[dict[str, Any]]:
    """Return browser-oriented sprite candidates for a session.

    Unlike export helpers, this reports invalid/missing candidates with reasons
    so the editor can explain why animation cannot start for a sprite.
    """
    base = dogs_dir(session_id)
    if not base.exists():
        return []

    canonical = read_canonical_session(session_id)
    canonical_slots = {
        bird["compatibilitySlot"]: bird["birdId"]
        for bird in (canonical.snapshot or {}).get("birds", [])
        if isinstance(bird, dict)
    }

    scene_width: int | None = None
    scene_height: int | None = None
    scene_path = session_dir(session_id) / "color.png"
    if scene_path.is_file():
        try:
            with Image.open(scene_path) as scene:
                scene_width, scene_height = scene.size
        except OSError:
            pass

    candidates: list[dict[str, Any]] = []
    for dog_folder in sorted(base.iterdir()):
        if not dog_folder.is_dir():
            continue
        dog_match = _DOG_FOLDER_RE.match(dog_folder.name)
        if dog_match is None:
            continue
        dog_index = int(dog_match.group(1))
        bird_id = canonical_slots.get(dog_folder.name)
        sprite_indices: set[int] = set()
        for child in dog_folder.iterdir():
            if meta_match := _SPRITE_META_RE.match(child.name):
                sprite_indices.add(int(meta_match.group(1)))
            elif image_match := _SPRITE_IMAGE_RE.match(child.name):
                sprite_indices.add(int(image_match.group(1)))

        for sprite_index in sorted(sprite_indices):
            stem = f"sprite_{sprite_index:03d}"
            meta_path = dog_folder / f"{stem}.json"
            default_image = f"dogs/{dog_folder.name}/{stem}.png"
            data: Any = None
            if meta_path.exists():
                try:
                    data = json.loads(meta_path.read_text())
                except (OSError, json.JSONDecodeError):
                    data = None

            image = data.get("image") if isinstance(data, dict) else default_image
            if not isinstance(image, str) or not image:
                image = default_image
            resolved_image = _session_relative_asset_path(session_id, image)
            image_path_valid = resolved_image is not None
            normalized_image = resolved_image[0] if resolved_image is not None else image
            image_path = resolved_image[1] if resolved_image is not None else session_dir(session_id) / default_image
            image_exists = image_path_valid and image_path.exists()
            image_readable = False
            actual_width: int | None = None
            actual_height: int | None = None
            if image_exists:
                try:
                    with Image.open(image_path) as img:
                        actual_width, actual_height = img.size
                        image_readable = actual_width > 0 and actual_height > 0
                except Exception:  # noqa: BLE001
                    image_readable = False

            status, reason = _sprite_candidate_status(
                data=data,
                image_path_valid=image_path_valid,
                image_exists=image_exists,
                image_readable=image_readable,
            )
            candidate: dict[str, Any] = {
                "id": f"{bird_id or f'dog_{dog_index:02d}'}:{stem}",
                "birdId": bird_id,
                "dogIndex": dog_index,
                "spriteIndex": sprite_index,
                "status": status,
                "reason": reason,
                "image": normalized_image if image_exists else None,
                "metadataPath": f"dogs/{dog_folder.name}/{stem}.json" if meta_path.exists() else None,
                "width": actual_width,
                "height": actual_height,
                "sceneWidth": scene_width,
                "sceneHeight": scene_height,
            }
            if isinstance(data, dict):
                candidate.update({
                    "mask": data.get("mask") if isinstance(data.get("mask"), str) else None,
                    "sourceVariant": data.get("sourceVariant") if isinstance(data.get("sourceVariant"), str) else None,
                    "anchorX": data.get("anchorX") if isinstance(data.get("anchorX"), (int, float)) else None,
                    "anchorY": data.get("anchorY") if isinstance(data.get("anchorY"), (int, float)) else None,
                    "flipX": data.get("flipX") is True,
                    "flipY": data.get("flipY") is True,
                    "spriteBox": data.get("spriteBox") if isinstance(data.get("spriteBox"), list) and len(data.get("spriteBox")) == 4 else None,
                    "cleanupBox": data.get("cleanupBox") if isinstance(data.get("cleanupBox"), list) and len(data.get("cleanupBox")) == 4 else None,
                    "technique": data.get("technique") if isinstance(data.get("technique"), str) else None,
                    "quality": data.get("quality") if isinstance(data.get("quality"), dict) else None,
                    "humanConfirmed": bool((data.get("humanReview") or {}).get("confirmed")) if isinstance(data.get("humanReview"), dict) else False,
                    "regenerationCandidate": bool((data.get("regenerationReview") or {}).get("candidate")) if isinstance(data.get("regenerationReview"), dict) else False,
                    "regenerationProbability": (data.get("regenerationReview") or {}).get("probability") if isinstance(data.get("regenerationReview"), dict) else None,
                })
                if candidate["width"] is None and isinstance(data.get("width"), int):
                    candidate["width"] = data["width"]
                if candidate["height"] is None and isinstance(data.get("height"), int):
                    candidate["height"] = data["height"]
            candidates.append(candidate)
    return candidates


def _box_target(data: dict[str, Any]) -> tuple[float, float] | None:
    box = data.get("spriteBox")
    if not (isinstance(box, list) and len(box) == 4):
        return None
    try:
        anchor_x = float(data.get("anchorX", 0.5))
        anchor_y = float(data.get("anchorY", 0.5))
        return (
            float(box[0]) + anchor_x * (float(box[2]) - float(box[0])),
            float(box[1]) + anchor_y * (float(box[3]) - float(box[1])),
        )
    except (TypeError, ValueError):
        return None


def _translated_box_around_target(
    box: list[Any], target: tuple[float, float], scene_size: tuple[int, int],
) -> list[int]:
    left, top, right, bottom = [int(round(float(value))) for value in box]
    width = max(1, right - left)
    height = max(1, bottom - top)
    scene_width, scene_height = scene_size
    left = max(0, min(scene_width - width, int(round(target[0] - width / 2))))
    top = max(0, min(scene_height - height, int(round(target[1] - height / 2))))
    return [left, top, left + width, top + height]


def repair_cross_bird_padding(session_id: str, *, apply: bool = False) -> dict[str, Any]:
    """Find padding boxes that cannot contain their own placed sprite target.

    Padding may be asymmetric and independently sized, but it must contain the
    bird it will extract. Hitbox reordering once preserved dog-folder indices
    while cycling the hitbox array, leaving padding on neighboring birds. The
    placed sprite anchor is the current human-visible authority, so repair only
    translates the existing box; it never changes its tuned dimensions.
    """
    base = session_dir(session_id)
    scene_path = base / "color.png"
    if not scene_path.is_file():
        return {"sessionId": session_id, "issues": [], "repaired": 0}
    with Image.open(scene_path) as scene:
        scene_size = scene.size
    raw = load_session_raw(session_id) or {}
    active_variants = {
        int(dog["index"]): int(dog["activeVariant"])
        for dog in raw.get("dogs", [])
        if isinstance(dog, dict)
        and isinstance(dog.get("index"), int)
        and isinstance(dog.get("activeVariant"), int)
    }
    issues: list[dict[str, Any]] = []
    roots = tuple(dict.fromkeys((base, GAME_PUBLIC_LEVELS / session_id)))
    for candidate in sprite_animation_candidates(session_id):
        dog_index = int(candidate["dogIndex"])
        if active_variants and candidate["spriteIndex"] != active_variants.get(dog_index):
            continue
        cleanup = candidate.get("cleanupBox")
        target = _box_target(candidate)
        if not (isinstance(cleanup, list) and len(cleanup) == 4 and target):
            continue
        if cleanup[0] <= target[0] <= cleanup[2] and cleanup[1] <= target[1] <= cleanup[3]:
            continue
        repaired_box = _translated_box_around_target(cleanup, target, scene_size)
        issue = {
            "candidateId": candidate["id"],
            "dogIndex": dog_index,
            "before": cleanup,
            "after": repaired_box,
            "target": [round(target[0], 2), round(target[1], 2)],
        }
        issues.append(issue)
        if not apply:
            continue
        relative = Path(str(candidate["metadataPath"]))
        for root in roots:
            metadata_path = root / relative
            if not metadata_path.is_file():
                continue
            metadata = json.loads(metadata_path.read_text())
            root_target = _box_target(metadata)
            root_cleanup = metadata.get("cleanupBox")
            if not (root_target and isinstance(root_cleanup, list) and len(root_cleanup) == 4):
                continue
            metadata["cleanupBox"] = _translated_box_around_target(root_cleanup, root_target, scene_size)
            temporary = metadata_path.with_suffix(metadata_path.suffix + ".tmp")
            temporary.write_text(json.dumps(metadata, indent=2) + "\n")
            temporary.replace(metadata_path)
            level_path = root / "level.json"
            if level_path.is_file():
                level = json.loads(level_path.read_text())
                dogs = level.get("dogs", [])
                if dog_index < len(dogs) and isinstance(dogs[dog_index], dict):
                    sprite = dogs[dog_index].get("sprite")
                    if isinstance(sprite, dict):
                        x0, y0, x1, y1 = metadata["cleanupBox"]
                        sprite["cleanup"] = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
                        level_path.write_text(json.dumps(level, indent=2) + "\n")
    if apply and issues:
        _write_review_file(session_id, "golden-review.json", {
            "schemaVersion": 1,
            "reviewStage": "final-cutouts",
            "approved": False,
            "blessed": False,
            "reviewedAt": None,
            "source": "cross-bird-padding-repair",
        })
    return {"sessionId": session_id, "issues": issues, "repaired": len(issues) if apply else 0}


def animation_jobs_dir(session_id: str) -> Path:
    return session_dir(session_id) / "animations" / "jobs"


def _animation_job_path(session_id: str, job_id: str) -> Path:
    return animation_jobs_dir(session_id) / f"{job_id}.json"


def sprite_animation_candidate_by_id(session_id: str, candidate_id: str) -> dict[str, Any] | None:
    for candidate in sprite_animation_candidates(session_id):
        if candidate.get("id") == candidate_id:
            return candidate
    return None


def set_sprite_human_confirmation(session_id: str, candidate_id: str, confirmed: bool, *, source: str = "editor") -> dict[str, Any]:
    """Persist explicit human approval beside the active sprite in both stores."""
    candidate = sprite_animation_candidate_by_id(session_id, candidate_id)
    if candidate is None or not isinstance(candidate.get("metadataPath"), str):
        raise ValueError("sprite candidate metadata was not found")
    review = {
        "confirmed": confirmed,
        "confirmedAt": datetime.now(timezone.utc).isoformat() if confirmed else None,
        "source": source,
    }
    updated = 0
    relative = Path(candidate["metadataPath"])
    for base in (session_dir(session_id), GAME_PUBLIC_LEVELS / session_id):
        path = base / relative
        if not path.is_file():
            continue
        data = json.loads(path.read_text())
        data["humanReview"] = review
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(data, indent=2) + "\n")
        temporary.replace(path)
        updated += 1
    if updated == 0:
        raise ValueError("sprite candidate metadata was not found")
    return review


def _semantic_json_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _read_review_file(session_id: str, filename: str) -> dict[str, Any] | None:
    # Older reviews were written only to the exported public package. An
    # editable workspace can later shadow that package, so consult both stores
    # and let the snapshot checks below decide whether the review is current.
    for base in dict.fromkeys((session_dir(session_id), GAME_PUBLIC_LEVELS / session_id)):
        path = base / filename
        if not path.is_file():
            continue
        try:
            value = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            return value
    return None


def _write_review_file(session_id: str, filename: str, review: dict[str, Any]) -> None:
    base = session_dir(session_id)
    for target_base in {base, GAME_PUBLIC_LEVELS / session_id}:
        if not target_base.exists():
            continue
        path = target_base / filename
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(review, indent=2) + "\n")
        temporary.replace(path)


def _current_hitbox_snapshot(session_id: str) -> tuple[list[dict[str, Any]], str]:
    selected_dir = session_dir(session_id)
    hitboxes = _load_hitboxes_raw(selected_dir)
    if not hitboxes and selected_dir == GAME_PUBLIC_LEVELS / session_id:
        # Export packages encode runtime dog ids in level.json, while the
        # authoring hitboxes retain stable editor UUIDs. Reuse the reviewed
        # authoring snapshot when its geometry is identical; otherwise hashing
        # the runtime representation falsely marks an unchanged review stale.
        authoring_hitboxes = _load_hitboxes_raw(LEVELS_DIR / session_id)
        try:
            public_dogs = json.loads((selected_dir / "level.json").read_text()).get("dogs", [])
        except (OSError, json.JSONDecodeError):
            public_dogs = []
        geometry = lambda dogs: sorted(
            (dog.get("x"), dog.get("y"), dog.get("r", 30))
            for dog in dogs
            if isinstance(dog, dict)
        )
        if authoring_hitboxes and geometry(authoring_hitboxes) == geometry(public_dogs):
            hitboxes = authoring_hitboxes
    if not hitboxes:
        level_path = selected_dir / "level.json"
        try:
            level = json.loads(level_path.read_text())
        except (OSError, json.JSONDecodeError):
            level = {}
        hitboxes = [
            {"id": dog.get("id"), "x": dog["x"], "y": dog["y"], "r": dog.get("r", 30)}
            for dog in level.get("dogs", [])
            if isinstance(dog, dict) and "x" in dog and "y" in dog
        ]
    if not hitboxes:
        raise ValueError("hitboxes.json was not found or is empty")
    return hitboxes, _semantic_json_sha256(hitboxes)


def get_hitbox_review_status(session_id: str) -> dict[str, Any]:
    canonical = read_canonical_session(session_id)
    if canonical.state.value == "valid_current" and canonical.snapshot is not None:
        review = canonical.snapshot.get("reviews", {}).get("hitboxes")
        current = isinstance(review, dict)
        return {**(review or {}), "approved": current, "current": current, "stale": False}
    review = _read_review_file(session_id, "hitbox-review.json")
    legacy = False
    if review is None:
        golden = get_level_golden_review(session_id)
        if golden and (golden.get("approved") is True or golden.get("blessed") is True):
            # The old one-stage blessing explicitly asserted that hitboxes were
            # human reviewed. Preserve those approved levels until geometry is
            # next saved, when save_hitboxes writes an explicit revocation.
            review = {
                "approved": True,
                "reviewedAt": golden.get("reviewedAt"),
                "source": "legacy-golden-review",
                "levelSha256": golden.get("levelSha256"),
            }
            legacy = True
    try:
        hitboxes, current_sha = _current_hitbox_snapshot(session_id)
    except ValueError:
        hitboxes, current_sha = [], None
    approved = bool(review and review.get("approved") is True)
    stored_sha = review.get("hitboxesSha256") if review else None
    snapshot_current = stored_sha == current_sha
    if legacy:
        reviewed_level_sha = review.get("levelSha256")
        level_path = session_dir(session_id) / "level.json"
        snapshot_current = (
            reviewed_level_sha is None
            or (
                level_path.is_file()
                and hashlib.sha256(level_path.read_bytes()).hexdigest() == reviewed_level_sha
            )
        )
    current = approved and bool(hitboxes) and snapshot_current
    return {
        **(review or {}),
        "approved": current,
        "current": current,
        "stale": approved and not current,
        "legacyGoldenReview": legacy,
        "currentHitboxesSha256": current_sha,
    }


def require_hitboxes_blessed(session_id: str) -> dict[str, Any]:
    status = get_hitbox_review_status(session_id)
    if not status["current"]:
        raise ValueError("Bless the current hitboxes first; cutouts require human-reviewed hitboxes")
    return status


def set_hitbox_review(session_id: str, approved: bool, *, source: str = "editor") -> dict[str, Any]:
    hitboxes, digest = _current_hitbox_snapshot(session_id)
    review = {
        "schemaVersion": 1,
        "reviewStage": "hitboxes",
        "approved": approved,
        "blessed": approved,
        "blessingMeaning": "current hitbox geometry is human-reviewed",
        "reviewedAt": now_iso(),
        "source": source,
        "hitboxesSha256": digest,
        "hitboxCount": len(hitboxes),
    }
    _write_review_file(session_id, "hitbox-review.json", review)
    return get_hitbox_review_status(session_id)


def set_level_golden_review(session_id: str, approved: bool, *, source: str = "editor") -> dict[str, Any]:
    """Snapshot a human-reviewed level for later golden-dataset ingestion.

    This metadata is deliberately independent of catalog, Lineup, and runtime
    eligibility. Blessing also confirms every current sprite because the level
    assertion would otherwise contradict its per-bird review state.
    """
    base = session_dir(session_id)
    hitbox_review = require_hitboxes_blessed(session_id) if approved else None
    level_path = base / "level.json"
    if not level_path.is_file():
        raise ValueError("level.json was not found")
    now = datetime.now(timezone.utc).isoformat()
    review: dict[str, Any] = {
        "schemaVersion": 1,
        "reviewStage": "final-cutouts",
        "approved": approved,
        "blessed": approved,
        "blessingMeaning": "current cutouts and sprite placements are final and human-reviewed",
        "trainingEligible": approved,
        "affectsLineup": False,
        "reviewedAt": now,
        "source": source,
        "hitboxesSha256": hitbox_review.get("currentHitboxesSha256") if hitbox_review else None,
    }
    if approved:
        level = json.loads(level_path.read_text())
        birds = []
        sidecar_updates: list[tuple[Path, dict[str, Any]]] = []
        target_bases = tuple(dict.fromkeys((base, GAME_PUBLIC_LEVELS / session_id)))
        for dog in level.get("dogs", []):
            sprite = dog.get("sprite") if isinstance(dog, dict) else None
            image = sprite.get("image") if isinstance(sprite, dict) else None
            if not isinstance(image, str):
                raise ValueError(f"active sprite is incomplete: {dog.get('id')}")
            marker = f"levels/{session_id}/"
            relative = Path(image.split(marker, 1)[-1] if marker in image else image)
            sprite_path = base / relative
            sidecar_path = sprite_path.with_suffix(".json")
            if not sprite_path.is_file() or not sidecar_path.is_file():
                raise ValueError(f"active sprite is incomplete: {dog.get('id')}")
            try:
                sidecar = json.loads(sidecar_path.read_text())
            except (OSError, json.JSONDecodeError):
                current = False
                break
            target = _box_target(sidecar)
            cleanup = sidecar.get("cleanupBox") or sidecar.get("spriteBox")
            if not (
                target is not None
                and isinstance(cleanup, list)
                and len(cleanup) == 4
                and cleanup[0] <= target[0] <= cleanup[2]
                and cleanup[1] <= target[1] <= cleanup[3]
            ):
                raise ValueError(f"active sprite padding targets a different bird: {dog.get('id')}")
            human_review = {"confirmed": True, "confirmedAt": now, "source": "level-bless"}
            for target_base in target_bases:
                target_sprite = target_base / relative
                target_sidecar = target_sprite.with_suffix(".json")
                if not target_sprite.exists() and not target_sidecar.exists():
                    continue
                if not target_sprite.is_file() or not target_sidecar.is_file():
                    raise ValueError(f"active sprite is incomplete in {target_base}: {dog.get('id')}")
                target_data = json.loads(target_sidecar.read_text())
                target_data["humanReview"] = human_review
                sidecar_updates.append((target_sidecar, target_data))
            birds.append({
                "dogId": dog.get("id"),
                "sprite": relative.as_posix(),
                "spriteSha256": hashlib.sha256(sprite_path.read_bytes()).hexdigest(),
                "spriteSize": sprite_path.stat().st_size,
                "spriteMtimeNs": sprite_path.stat().st_mtime_ns,
                "spriteBox": sidecar.get("spriteBox"),
                "flipX": sidecar.get("flipX") is True,
                "flipY": sidecar.get("flipY") is True,
            })
        if not birds:
            raise ValueError("No active cutouts are available for final blessing")
        # Validate and prepare every active bird before mutating either store.
        # A missing later bird must not leave earlier sidecars half-confirmed.
        for sidecar_path, sidecar in sidecar_updates:
            temporary = sidecar_path.with_suffix(sidecar_path.suffix + ".tmp")
            temporary.write_text(json.dumps(sidecar, indent=2) + "\n")
            temporary.replace(sidecar_path)
        scene_path = base / "color.png"
        review.update({
            "levelSha256": hashlib.sha256(level_path.read_bytes()).hexdigest(),
            "scene": "color.png" if scene_path.is_file() else None,
            "sceneSha256": hashlib.sha256(scene_path.read_bytes()).hexdigest() if scene_path.is_file() else None,
            "birds": birds,
        })
    _write_review_file(session_id, "golden-review.json", review)
    return review


def get_level_golden_review(session_id: str) -> dict[str, Any] | None:
    return _read_review_file(session_id, "golden-review.json")


def get_final_cutout_review_status(
    session_id: str,
    *,
    hitbox_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    canonical = read_canonical_session(session_id)
    if canonical.state.value == "valid_current" and canonical.snapshot is not None:
        reviews = canonical.snapshot.get("reviews", {})
        hitbox_review = reviews.get("hitboxes")
        final_review = reviews.get("finalCutouts")
        current = isinstance(hitbox_review, dict) and isinstance(final_review, dict)
        return {**(final_review or {}), "approved": current, "current": current, "stale": False}
    review = get_level_golden_review(session_id)
    approved = bool(review and (review.get("approved") is True or review.get("blessed") is True))
    if not approved:
        return {**(review or {}), "approved": False, "current": False, "stale": False}
    hitbox_status = hitbox_status or get_hitbox_review_status(session_id)
    reviewed_hitbox_sha = review.get("hitboxesSha256") if review else None
    current = (
        approved
        and hitbox_status["current"]
        and (
            reviewed_hitbox_sha is None  # legacy one-stage approval
            or reviewed_hitbox_sha == hitbox_status.get("currentHitboxesSha256")
        )
    )
    level_path = session_dir(session_id) / "level.json"
    reviewed_level_sha = review.get("levelSha256") if review else None
    if current and reviewed_level_sha is not None:
        current = (
            level_path.is_file()
            and hashlib.sha256(level_path.read_bytes()).hexdigest() == reviewed_level_sha
        )
    if current and isinstance(review.get("birds"), list):
        require_per_sprite_confirmation = review.get("reviewStage") == "final-cutouts"
        for bird in review["birds"]:
            if not isinstance(bird, dict) or not isinstance(bird.get("sprite"), str):
                current = False
                break
            sprite_path = session_dir(session_id) / bird["sprite"]
            sidecar_path = sprite_path.with_suffix(".json")
            if not sprite_path.is_file() or not sidecar_path.is_file():
                current = False
                break
            sidecar = json.loads(sidecar_path.read_text())
            pixels_current = (
                hashlib.sha256(sprite_path.read_bytes()).hexdigest() == bird.get("spriteSha256")
            )
            current = (
                pixels_current
                and sidecar.get("spriteBox") == bird.get("spriteBox")
                and (sidecar.get("flipX") is True) == (bird.get("flipX") is True)
                and (sidecar.get("flipY") is True) == (bird.get("flipY") is True)
                and (
                    not require_per_sprite_confirmation
                    or bool((sidecar.get("humanReview") or {}).get("confirmed"))
                )
            )
            if not current:
                break
    return {
        **(review or {}),
        "approved": current,
        "current": current,
        "stale": approved and not current,
    }


def get_final_cutout_review_readiness(session_id: str) -> dict[str, Any]:
    level_path = session_dir(session_id) / "level.json"
    try:
        level = json.loads(level_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"ready": False, "activeBirds": 0, "missingCutouts": 0, "invalidPadding": 0}
    dogs = [dog for dog in level.get("dogs", []) if isinstance(dog, dict)]
    missing = 0
    invalid_padding = 0
    for dog in dogs:
        sprite = dog.get("sprite")
        image = sprite.get("image") if isinstance(sprite, dict) else None
        if not isinstance(image, str):
            missing += 1
            continue
        marker = f"levels/{session_id}/"
        relative = Path(image.split(marker, 1)[-1] if marker in image else image)
        sprite_path = session_dir(session_id) / relative
        sidecar_path = sprite_path.with_suffix(".json")
        if not sprite_path.is_file() or not sidecar_path.is_file():
            missing += 1
            continue
        try:
            sidecar = json.loads(sidecar_path.read_text())
        except (OSError, json.JSONDecodeError):
            missing += 1
            continue
        target = _box_target(sidecar)
        cleanup = sidecar.get("cleanupBox") or sidecar.get("spriteBox")
        padding_current = (
            target is not None
            and isinstance(cleanup, list)
            and len(cleanup) == 4
            and cleanup[0] <= target[0] <= cleanup[2]
            and cleanup[1] <= target[1] <= cleanup[3]
        )
        if not padding_current:
            invalid_padding += 1
    return {
        "ready": bool(dogs) and missing == 0 and invalid_padding == 0,
        "activeBirds": len(dogs),
        "missingCutouts": missing,
        "invalidPadding": invalid_padding,
    }


def require_ready_sprite_animation_candidate(session_id: str, candidate_id: str) -> dict[str, Any]:
    candidate = sprite_animation_candidate_by_id(session_id, candidate_id)
    if candidate is None:
        raise ValueError("sprite candidate not found")
    if candidate.get("status") != "ready":
        raise ValueError("sprite candidate is not ready for animation")
    image = candidate.get("image")
    if not isinstance(image, str) or not image:
        raise ValueError("sprite candidate is missing an image path")
    image_path = _session_relative_asset_path(session_id, image)
    if image_path is None or not image_path[1].exists():
        raise ValueError("sprite candidate image is missing")
    return candidate


def create_sprite_animation_job(
    session_id: str,
    *,
    source_candidate: dict[str, Any],
    prompt: str,
    motion_preset: str | None,
    custom_prompt: str | None,
    duration_seconds: float,
    fps: int,
) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "status": "running",
        "sourceCandidateId": source_candidate["id"],
        "sourceImage": source_candidate["image"],
        "prompt": prompt,
        "motionPreset": motion_preset,
        "customPrompt": custom_prompt,
        "durationSeconds": duration_seconds,
        "fps": fps,
        "provider": "layer",
        "model": "layer/sprite-animation",
        "providerJobId": None,
        "contentType": None,
        "previewPath": None,
        "createdAt": now_iso(),
        "completedAt": None,
        "error": None,
        "metadata": {},
    }
    save_sprite_animation_job(session_id, job)
    return job


def save_sprite_animation_job(session_id: str, job: dict[str, Any]) -> None:
    animation_jobs_dir(session_id).mkdir(parents=True, exist_ok=True)
    path = _animation_job_path(session_id, str(job["id"]))
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(job, indent=2, sort_keys=True))
    os.replace(tmp, path)


def _preview_file_exists(session_id: str, preview_path: Any) -> bool:
    if not isinstance(preview_path, str) or not preview_path:
        return False
    root = session_dir(session_id).resolve()
    candidate = root / preview_path
    try:
        candidate.resolve().relative_to(root)
    except (OSError, RuntimeError, ValueError):
        return False
    return candidate.is_file()


def _with_animation_review_fields(session_id: str, job: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(job)
    status = str(enriched.get("status", ""))
    preview_exists = _preview_file_exists(session_id, enriched.get("previewPath"))
    if status == "failed":
        review_status = "failed"
    elif status == "running":
        review_status = "running"
    elif status == "completed" and preview_exists:
        review_status = "generated"
    elif status == "completed":
        review_status = "missing_file"
    else:
        review_status = "missing_file"
    enriched["previewExists"] = preview_exists
    enriched["reviewStatus"] = review_status
    return enriched


def list_sprite_animation_jobs(session_id: str) -> list[dict[str, Any]]:
    base = animation_jobs_dir(session_id)
    if not base.exists():
        return []
    jobs = []
    for path in sorted(base.glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict):
            jobs.append(_with_animation_review_fields(session_id, data))
    return jobs


def get_sprite_animation_job(session_id: str, job_id: str) -> dict[str, Any] | None:
    path = _animation_job_path(session_id, job_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return _with_animation_review_fields(session_id, data) if isinstance(data, dict) else None


def complete_sprite_animation_job(
    session_id: str,
    job: dict[str, Any],
    *,
    content: bytes,
    extension: str,
    content_type: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    job_dir = animation_jobs_dir(session_id) / str(job["id"])
    job_dir.mkdir(parents=True, exist_ok=True)
    preview_name = f"preview{extension}"
    preview_path = job_dir / preview_name
    tmp = preview_path.with_suffix(f"{extension}.tmp")
    tmp.write_bytes(content)
    os.replace(tmp, preview_path)
    relative_preview = preview_path.relative_to(session_dir(session_id)).as_posix()
    job.update({
        "status": "completed",
        "providerJobId": metadata.get("providerJobId"),
        "contentType": content_type,
        "previewPath": relative_preview,
        "completedAt": now_iso(),
        "error": None,
        "metadata": metadata,
    })
    save_sprite_animation_job(session_id, job)
    return job


def fail_sprite_animation_job(session_id: str, job: dict[str, Any], error: str) -> dict[str, Any]:
    job.update({
        "status": "failed",
        "completedAt": now_iso(),
        "error": error,
    })
    save_sprite_animation_job(session_id, job)
    return job


def _defaults_for_mode(mode: Literal["portrait", "landscape"]) -> tuple[str, str]:
    """Map orientation mode → (aspect_ratio, image_size). Canonical in one place.

    Landscape: 16:9 + 4K (background detail is the zoom bottleneck).
    Portrait: 9:16 + 1K (historical default).

    Raises on unknown values rather than silently defaulting — defends against
    hand-edited session.json with corrupted `mode` (e.g. typo, trailing whitespace,
    or pre-feature `"workspace"` value) shipping the wrong aspect/size pair.
    """
    if mode == "landscape":
        return "16:9", "4K"
    if mode == "portrait":
        return "9:16", "1K"
    raise ValueError(f"unknown mode: {mode!r}")


class SectionsInvariantError(Exception):
    """Raised when a sections[] array fails contiguity/coverage invariants
    that the game runtime (SectionController) depends on.

    Subclasses Exception (not ValueError) so a stray `except ValueError`
    elsewhere in the stack can't silently swallow it.
    """


class CatalogApprovalConflict(Exception):
    """Raised when a catalog approval request id is reused for different work."""


class LevelNotReadyError(Exception):
    """Raised when export would publish an incomplete level.

    The builder may have hitboxes and a stale level.json even when one or more
    paid inpaint calls failed. Export must be gated on current dog status so the
    shipped game never contains tappable targets for entities that were not
    painted into color.png.
    """


class VisibilityBlockedError(Exception):
    """Raised when a publish would ship a level with a dog behind the HUD/ad
    band (or section safe-margins) — a `blocked_area` visibility issue.

    The gate that prevents this used to live ONLY in the React client
    (StepExport.ensureNoVisibilityBlockers), so an agent or direct API caller
    could publish a blocked level. This error moves the gate into the server
    publish chokepoint (export_to_game) so the UI and any agent hit the same
    fail-closed rule. Carries the offending `blocked_area` issues for the 422
    body.
    """

    def __init__(self, issues: list[dict]):
        self.issues = issues
        areas = sorted({str(issue.get("area")) for issue in issues if issue.get("area")})
        super().__init__(
            f"{len(issues)} dog(s) fall in a blocked area ({', '.join(areas) or 'HUD/AD'}) "
            f"on at least one device viewport"
        )


MOBILE_VISIBILITY_VIEWPORTS = [
    {"name": "iPhone SE", "width": 375, "height": 667},
    {"name": "iPhone 15", "width": 393, "height": 852},
    {"name": "Pixel 8", "width": 412, "height": 915},
    {"name": "Tall Android", "width": 360, "height": 800},
    # Narrowest supported aspect (0.449): crops the most horizontally under
    # cover-scaling, so it is the level-edge worst case.
    {"name": "Pixel 8 Pro", "width": 448, "height": 998},
]


def _validate_sections(sections: list[dict], level_width: int) -> None:
    """Assert invariants that SectionController relies on, raising on violation.

    - level_width must be positive (a 0-width level can pass every other check
      with all-zero sections — that's the corruption class this guard exists
      to prevent).
    - Exactly N_SECTIONS sections (3 — see dog_pipeline.sections.N_SECTIONS).
    - sections[0].xStart == 0 and sections[-1].xEnd == level_width (full coverage).
    - Contiguous: sections[i].xEnd == sections[i+1].xStart for every adjacent pair.
    - Each section has required keys (xStart, xEnd) AND positive width
      (xEnd > xStart).
    """
    if level_width <= 0:
        raise SectionsInvariantError(
            f"level_width must be positive, got {level_width}"
        )
    if len(sections) != N_SECTIONS:
        raise SectionsInvariantError(
            f"expected {N_SECTIONS} sections, got {len(sections)}"
        )
    for i, s in enumerate(sections):
        if "xStart" not in s or "xEnd" not in s:
            raise SectionsInvariantError(f"section {i} missing xStart/xEnd: {s}")
        if s["xEnd"] <= s["xStart"]:
            raise SectionsInvariantError(
                f"section {i} has non-positive width: "
                f"xStart={s['xStart']}, xEnd={s['xEnd']}"
            )
    if sections[0]["xStart"] != 0:
        raise SectionsInvariantError(
            f"sections[0].xStart must be 0, got {sections[0]['xStart']}"
        )
    if sections[-1]["xEnd"] != level_width:
        raise SectionsInvariantError(
            f"sections[-1].xEnd must equal level_width ({level_width}), "
            f"got {sections[-1]['xEnd']}"
        )
    for i in range(len(sections) - 1):
        if sections[i]["xEnd"] != sections[i + 1]["xStart"]:
            raise SectionsInvariantError(
                f"sections[{i}].xEnd ({sections[i]['xEnd']}) != "
                f"sections[{i + 1}].xStart ({sections[i + 1]['xStart']}) — not contiguous"
            )


def _camera_sections(sections: list[dict]) -> list[dict]:
    """Return only the camera-slide section geometry.

    Older sessions may still carry authoring metadata like labels or ambient
    presets. The runtime only needs geometry, and exported level.json should not
    contain text metadata that could appear during play.
    """
    return [
        {"xStart": int(s["xStart"]), "xEnd": int(s["xEnd"])}
        for s in sections
    ]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def session_dir(session_id: str) -> Path:
    active_dir = LEVELS_DIR / session_id
    public_dir = GAME_PUBLIC_LEVELS / session_id
    if active_dir.exists() and public_dir.exists():
        # Exported levels can coexist with an older authoring-session copy.
        # A final blessing records the authoritative level bytes; prefer the
        # duplicate that still matches that reviewed snapshot. Otherwise the
        # editor can silently display stale sprites despite showing a blessed
        # public package for the same id.
        reviewed_hashes: set[str] = set()
        for base in (active_dir, public_dir):
            review_path = base / "golden-review.json"
            try:
                review = json.loads(review_path.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            if review.get("approved") is True or review.get("blessed") is True:
                level_hash = review.get("levelSha256")
                if isinstance(level_hash, str) and level_hash:
                    reviewed_hashes.add(level_hash)
        if reviewed_hashes:
            def hitbox_geometry(base: Path) -> list[tuple[Any, Any, Any]]:
                path = base / "hitboxes.json"
                try:
                    dogs = json.loads(path.read_text())
                except (OSError, json.JSONDecodeError):
                    try:
                        dogs = json.loads((base / "level.json").read_text()).get("dogs", [])
                    except (OSError, json.JSONDecodeError):
                        return []
                return sorted(
                    (dog.get("x"), dog.get("y"), dog.get("r", 30))
                    for dog in dogs
                    if isinstance(dog, dict)
                )

            if hitbox_geometry(active_dir) != hitbox_geometry(public_dir):
                # Geometry edits are human-owned and must surface as a stale
                # blessing. Sprite-only divergence is the stale-copy failure
                # that should yield to the final reviewed export.
                return active_dir
            for base in (active_dir, public_dir):
                level_path = base / "level.json"
                if level_path.is_file() and hashlib.sha256(level_path.read_bytes()).hexdigest() in reviewed_hashes:
                    return base
    if active_dir.exists():
        return active_dir
    if public_dir.exists():
        return public_dir
    return LEVELS_DIR / session_id


def canonical_session_store(session_id: str):
    """Return the canonical authoring store without consulting projections.

    This deliberately does not call :func:`session_dir`: that legacy resolver
    may select a public package. Canonical reads and writes are workspace-only.
    """
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore

    return CanonicalRevisionStore(LEVELS_DIR / session_id)


def read_canonical_session(session_id: str):
    """Read the explicit canonical pointer state for an authoring session."""
    return canonical_session_store(session_id).read()


def commit_canonical_session(
    session_id: str,
    snapshot: dict[str, Any],
    *,
    expected_content_revision: str | None,
):
    """CAS-install one immutable authoring revision under the session flock."""
    if snapshot.get("sessionId") != session_id:
        raise ValueError("canonical snapshot sessionId does not match route session")
    return canonical_session_store(session_id).commit(
        snapshot,
        expected_content_revision=expected_content_revision,
    )


def save_canonical_hitboxes_if_present(
    session_id: str,
    hitboxes: list[dict[str, Any]],
    *,
    expected_content_revision: str | None,
):
    """CAS-save canonical hitboxes, or return ``None`` for a legacy session."""
    from levelbuilder.api.canonical_bird_contract import (
        CanonicalReadState,
        ContractValidationError,
        RevisionConflictError,
        invalidate_reviews,
    )

    store = canonical_session_store(session_id)
    current = store.read()
    if current.state is CanonicalReadState.MIGRATION_REQUIRED:
        return None
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None:
        raise ContractValidationError(
            f"canonical session is not writable: {current.state.value}: {current.detail or ''}".rstrip()
        )
    if expected_content_revision is None:
        from levelbuilder.api.canonical_bird_contract import RevisionConflictError

        raise RevisionConflictError(None, current.pointer.content_revision if current.pointer else None)

    incoming: dict[str, dict[str, Any]] = {}
    for hitbox in hitboxes:
        bird_id = hitbox.get("id") if isinstance(hitbox, dict) else None
        if not isinstance(bird_id, str) or bird_id in incoming:
            raise ContractValidationError("canonical hitboxes require unique birdId values")
        incoming[bird_id] = hitbox
    canonical_ids = {bird["birdId"] for bird in current.snapshot["birds"]}
    if set(incoming) != canonical_ids:
        raise ContractValidationError("canonical hitbox identity set does not match the current revision")

    updated = invalidate_reviews(current.snapshot, changed_artifacts={"hitboxes"})
    for bird in updated["birds"]:
        hitbox = incoming[bird["birdId"]]
        bird["hitbox"] = {key: hitbox[key] for key in ("x", "y", "r")}
    return store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision if current.pointer else None,
    )


def set_canonical_hitbox_review_if_present(
    session_id: str,
    approved: bool,
    *,
    expected_content_revision: str | None,
    reviewer: str = "human:editor",
):
    """CAS-bind a human hitbox assertion, or return ``None`` for legacy."""
    from levelbuilder.api.canonical_bird_contract import (
        CanonicalReadState,
        bless_snapshot,
        ContractValidationError,
        invalidate_reviews,
        RevisionConflictError,
    )

    store = canonical_session_store(session_id)
    current = store.read()
    if current.state is CanonicalReadState.MIGRATION_REQUIRED:
        return None
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None:
        raise ContractValidationError(
            f"canonical session is not writable: {current.state.value}: {current.detail or ''}".rstrip()
        )
    actual = current.pointer.content_revision if current.pointer else None
    if expected_content_revision is None:
        raise RevisionConflictError(None, actual)
    if approved:
        updated = bless_snapshot(
            current.snapshot,
            review_kind="hitboxes",
            reviewer=reviewer,
            reviewed_at=now_iso(),
        )
    else:
        updated = invalidate_reviews(current.snapshot, changed_artifacts={"hitboxes"})
    return store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision if current.pointer else None,
    )


def save_canonical_sprite_geometry_if_present(
    session_id: str,
    bird_id: str,
    *,
    sprite_box: list[int] | tuple[int, int, int, int],
    cleanup_box: list[int] | tuple[int, int, int, int] | None,
    flip_x: bool | None,
    flip_y: bool | None,
    expected_content_revision: str | None,
):
    """CAS-save one canonical bird's sprite and cleanup geometry by birdId."""
    from levelbuilder.api.canonical_bird_contract import (
        CanonicalReadState,
        ContractValidationError,
        RevisionConflictError,
        invalidate_reviews,
    )

    store = canonical_session_store(session_id)
    current = store.read()
    if current.state is CanonicalReadState.MIGRATION_REQUIRED:
        return None
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None:
        raise ContractValidationError(f"canonical session is not writable: {current.state.value}")
    actual = current.pointer.content_revision if current.pointer else None
    if expected_content_revision is None:
        raise RevisionConflictError(None, actual)
    if (
        len(sprite_box) != 4
        or sprite_box[0] < 0
        or sprite_box[1] < 0
        or sprite_box[2] <= sprite_box[0]
        or sprite_box[3] <= sprite_box[1]
    ):
        raise ContractValidationError("spriteBox must have positive width and height")
    if cleanup_box is not None and (
        len(cleanup_box) != 4
        or cleanup_box[0] < 0
        or cleanup_box[1] < 0
        or cleanup_box[2] <= cleanup_box[0]
        or cleanup_box[3] <= cleanup_box[1]
    ):
        raise ContractValidationError("cleanupBox must have positive width and height")
    bird = next((item for item in current.snapshot["birds"] if item["birdId"] == bird_id), None)
    if bird is None:
        raise ContractValidationError(f"unknown birdId: {bird_id}")
    changed = {"spritePlacement"}
    if flip_x is not None or flip_y is not None:
        changed.add("spriteFlip")
    if cleanup_box is not None:
        changed.add("cleanup")
    updated = invalidate_reviews(current.snapshot, changed_artifacts=changed)
    target = next(item for item in updated["birds"] if item["birdId"] == bird_id)
    x0, y0, x1, y1 = map(int, sprite_box)
    target["sprite"]["placement"] = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
    if flip_x is not None:
        target["sprite"]["flipX"] = flip_x
    if flip_y is not None:
        target["sprite"]["flipY"] = flip_y
    if cleanup_box is not None:
        cx0, cy0, cx1, cy1 = map(int, cleanup_box)
        target["cleanup"].update({"x": cx0, "y": cy0, "width": cx1 - cx0, "height": cy1 - cy0})
    return store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision if current.pointer else None,
    )


def set_canonical_final_review_if_present(
    session_id: str,
    approved: bool,
    *,
    expected_content_revision: str | None,
    reviewer: str = "human:editor",
):
    """CAS-bind final review after the same revision's hitboxes are reviewed."""
    from levelbuilder.api.canonical_bird_contract import (
        CanonicalReadState,
        ContractValidationError,
        RevisionConflictError,
        bless_snapshot,
        invalidate_reviews,
    )

    store = canonical_session_store(session_id)
    current = store.read()
    if current.state is CanonicalReadState.MIGRATION_REQUIRED:
        return None
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None:
        raise ContractValidationError(f"canonical session is not writable: {current.state.value}")
    actual = current.pointer.content_revision if current.pointer else None
    if expected_content_revision is None:
        raise RevisionConflictError(None, actual)
    if approved:
        hitbox_review = current.snapshot.get("reviews", {}).get("hitboxes")
        if not isinstance(hitbox_review, dict) or hitbox_review.get("contentRevision") != actual:
            raise ContractValidationError("current hitbox review is required before final blessing")
        updated = bless_snapshot(
            current.snapshot,
            review_kind="finalCutouts",
            reviewer=reviewer,
            reviewed_at=now_iso(),
        )
    else:
        updated = invalidate_reviews(current.snapshot, changed_artifacts={"spritePlacement"})
    return store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision if current.pointer else None,
    )


def delete_canonical_bird_if_present(
    session_id: str,
    bird_id: str,
    *,
    expected_content_revision: str | None,
):
    """CAS-delete one canonical bird without reusing its identity or slot."""
    from levelbuilder.api.canonical_bird_contract import (
        CanonicalReadState,
        ContractValidationError,
        RevisionConflictError,
        invalidate_reviews,
    )

    store = canonical_session_store(session_id)
    current = store.read()
    if current.state is CanonicalReadState.MIGRATION_REQUIRED:
        return None
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None:
        raise ContractValidationError(f"canonical session is not writable: {current.state.value}")
    actual = current.pointer.content_revision if current.pointer else None
    if expected_content_revision is None:
        raise RevisionConflictError(None, actual)
    if not any(bird["birdId"] == bird_id for bird in current.snapshot["birds"]):
        raise ContractValidationError(f"unknown birdId: {bird_id}")
    updated = invalidate_reviews(current.snapshot, changed_artifacts={"birdSet"})
    updated["birds"] = [bird for bird in updated["birds"] if bird["birdId"] != bird_id]
    tombstones = updated.setdefault("operational", {}).setdefault("deletedBirdIds", [])
    if bird_id not in tombstones:
        tombstones.append(bird_id)
        tombstones.sort()
    return store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision if current.pointer else None,
    )


def set_canonical_candidate_confirmation_if_present(
    session_id: str,
    bird_id: str,
    confirmed: bool,
    *,
    expected_content_revision: str | None,
    reviewer: str = "human:editor",
):
    """Record candidate review as operational metadata without blessing content."""
    from levelbuilder.api.canonical_bird_contract import (
        CanonicalReadState,
        ContractValidationError,
        RevisionConflictError,
    )

    store = canonical_session_store(session_id)
    current = store.read()
    if current.state is CanonicalReadState.MIGRATION_REQUIRED:
        return None
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None:
        raise ContractValidationError(f"canonical session is not writable: {current.state.value}")
    actual = current.pointer.content_revision if current.pointer else None
    if expected_content_revision is None:
        raise RevisionConflictError(None, actual)
    bird = next((item for item in current.snapshot["birds"] if item["birdId"] == bird_id), None)
    if bird is None:
        raise ContractValidationError(f"unknown birdId: {bird_id}")
    updated = json.loads(json.dumps(current.snapshot))
    reviews = updated.setdefault("operational", {}).setdefault("candidateReviews", {})
    reviews[bird_id] = {
        "generationId": bird["activeGeneration"]["generationId"],
        "confirmed": confirmed,
        "reviewer": reviewer,
        "reviewedAt": now_iso(),
    }
    return store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision if current.pointer else None,
    )


def promote_canonical_sprite_artifact(
    session_id: str,
    *,
    captured_input: dict[str, Any],
    generation_id: str,
    sprite_path: Path,
    metadata: dict[str, Any],
    painted_path: Path | None = None,
):
    """Promote an unattached provider artifact iff its bird inputs remain current."""
    from levelbuilder.api.canonical_bird_contract import (
        CanonicalReadState,
        ContractValidationError,
        RevisionConflictError,
        invalidate_reviews,
    )
    from levelbuilder.api.canonical_job_provenance import (
        BirdJobInput,
        verify_bird_job_input,
    )

    captured = BirdJobInput.from_dict(captured_input)
    if captured.session_id != session_id:
        raise ContractValidationError("job artifact session mismatch")
    if not sprite_path.is_file():
        raise ContractValidationError("job sprite artifact is missing")
    if painted_path is not None and not painted_path.is_file():
        raise ContractValidationError("job painted artifact is missing")
    try:
        relative_sprite = sprite_path.resolve().relative_to((LEVELS_DIR / session_id).resolve())
    except ValueError as error:
        raise ContractValidationError("job sprite artifact is outside the authoring session") from error
    sprite_box = metadata.get("spriteBox")
    cleanup_box = metadata.get("cleanupBox")
    if not (
        isinstance(sprite_box, list)
        and len(sprite_box) == 4
        and isinstance(cleanup_box, list)
        and len(cleanup_box) == 4
    ):
        raise ContractValidationError("job sprite geometry is incomplete")

    store = canonical_session_store(session_id)
    for _attempt in range(3):
        current = store.read()
        if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None or current.pointer is None:
            raise ContractValidationError(f"canonical session is not promotable: {current.state.value}")
        verification = verify_bird_job_input(current.snapshot, captured)
        if not verification.current:
            return None, verification.code
        updated = invalidate_reviews(current.snapshot, changed_artifacts={"activeGeneration", "spritePixels", "spritePlacement", "cleanup"})
        bird = next(item for item in updated["birds"] if item["birdId"] == captured.bird_id)
        sprite_digest = hashlib.sha256(sprite_path.read_bytes()).hexdigest()
        x0, y0, x1, y1 = map(int, sprite_box)
        cx0, cy0, cx1, cy1 = map(int, cleanup_box)
        bird["activeGeneration"] = {
            "generationId": generation_id,
            "inputSceneSha256": captured.scene_sha256,
            "inputRevision": captured.bird_input_revision,
            **({
                "paintedAsset": {
                    "path": painted_path.resolve().relative_to((LEVELS_DIR / session_id).resolve()).as_posix(),
                    "sha256": hashlib.sha256(painted_path.read_bytes()).hexdigest(),
                    "bytes": painted_path.stat().st_size,
                },
            } if painted_path is not None else {}),
        }
        bird["sprite"] = {
            "asset": {
                "path": relative_sprite.as_posix(),
                "sha256": sprite_digest,
                "bytes": sprite_path.stat().st_size,
            },
            "placement": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
            "anchorX": float(metadata.get("anchorX", 0.5)),
            "anchorY": float(metadata.get("anchorY", 0.5)),
            "flipX": metadata.get("flipX") is True,
            "flipY": metadata.get("flipY") is True,
        }
        bird["cleanup"] = {
            "x": cx0,
            "y": cy0,
            "width": cx1 - cx0,
            "height": cy1 - cy0,
            "sourceSpriteSha256": sprite_digest,
        }
        try:
            pointer = store.commit(
                updated,
                expected_content_revision=current.pointer.content_revision,
                expected_operational_revision=current.pointer.operational_revision,
            )
            return pointer, "committed"
        except RevisionConflictError:
            continue
    return None, "revision_conflict"


def dogs_dir(session_id: str) -> Path:
    return session_dir(session_id) / "dogs"


def clone_session(src_id: str, new_id: str, *, reset_paint: bool = False) -> dict:
    """Clone a session under a new id, safe for variant/A-B lanes.

    Hand-copying session dirs repeatedly shipped stale state (2026-08-05):
    the level.json id (runtime guard rejects the level), the per-dog
    activeVariant flags (author's inpaint step silently no-ops), and stale
    dogs/ sprite metadata (export joins against the wrong birds). This verb
    owns all three.

    reset_paint=True returns the clone to the pre-paint state: color.png
    becomes the selected clean bg at level size, painted artifacts and
    dogs/ are dropped, dog paint state is cleared. Hitboxes are kept.
    """
    import shutil as _shutil

    src = session_dir(src_id)
    if not (src / "session.json").exists():
        raise LevelNotReadyError(f"session {src_id} not found")
    dst = LEVELS_DIR / new_id
    if dst.exists():
        raise LevelNotReadyError(f"session {new_id} already exists")
    ignore = [".gallery_previews", ".gallery_thumbs"]
    if reset_paint:
        ignore.append("dogs")
    _shutil.copytree(src, dst, ignore=_shutil.ignore_patterns(*ignore))

    def rewrite_asset_refs(value: Any) -> Any:
        if isinstance(value, str):
            return value.replace(f"levels/{src_id}/", f"levels/{new_id}/")
        if isinstance(value, list):
            return [rewrite_asset_refs(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite_asset_refs(item) for key, item in value.items()}
        return value

    with open(dst / "session.json") as f:
        sj = rewrite_asset_refs(json.load(f))
    for key in ("id", "sessionId", "session_id"):
        if key in sj:
            sj[key] = new_id
    if reset_paint:
        sj["dogs"] = []
        lj_path = dst / "level.json"
        level = json.loads(lj_path.read_text()) if lj_path.exists() else {}
        selected = sj.get("selected_bg") or 0
        bg_path = dst / f"bg_{int(selected):02d}.png"
        if bg_path.exists() and level.get("width"):
            with Image.open(bg_path) as _b:
                clean = _b.convert("RGB")
                if clean.size != (level["width"], level["height"]):
                    clean = clean.resize((level["width"], level["height"]), Image.LANCZOS)
                clean.save(dst / "color.png")
        for name in ("inpainted.png", "inpainted.gen.json", "bw.png", "eval.png"):
            (dst / name).unlink(missing_ok=True)
    with open(dst / "session.json", "w") as f:
        json.dump(sj, f, indent=1)
    lj_path = dst / "level.json"
    if lj_path.exists():
        level = rewrite_asset_refs(json.loads(lj_path.read_text()))
        level["id"] = new_id
        lj_path.write_text(json.dumps(level, indent=1))
    # A clone preserves reviewed hitbox geometry but is a new cutout trial.
    # Carrying the source's final blessing makes later mutations appear human
    # approved and lets comparison lanes contaminate golden-state reporting.
    (dst / "golden-review.json").unlink(missing_ok=True)
    return {"sessionId": new_id, "clonedFrom": src_id, "resetPaint": reset_paint}


def is_public_package_only(session_id: str) -> bool:
    return not (LEVELS_DIR / session_id).exists() and (GAME_PUBLIC_LEVELS / session_id).exists()


def save_session(session_id: str, data: dict) -> None:
    """Write session.json. Converts Path values to str for JSON."""
    path = session_dir(session_id) / "session.json"
    serializable = {k: (str(v) if isinstance(v, Path) else v) for k, v in data.items()}
    # Atomic write: tmp + os.replace. SIGKILL mid-write used to leave a
    # truncated JSON that failed to parse on next hydrate. _session_lock
    # is already held where this matters (save_session always runs under
    # the caller's with-block, see update_session_field / save_hitboxes).
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(serializable, f, indent=2)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def load_session_raw(session_id: str) -> dict | None:
    """Load raw session.json from disk. Returns None if not found."""
    path = session_dir(session_id) / "session.json"
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def _coerce_upscale_target_long_edge(value: Any) -> int:
    try:
        target = int(value)
    except (TypeError, ValueError):
        return 3840
    return min(7680, max(1024, target))


def upscale_target_long_edge(raw: dict[str, Any]) -> int:
    value = raw.get("upscale_target_long_edge")
    if value is None:
        return 3840
    try:
        target = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid upscale_target_long_edge: {value!r}") from exc
    if not 1024 <= target <= 7680:
        raise ValueError(f"upscale_target_long_edge out of range: {target}")
    return target


def _background_indexes(raw: dict, sdir: Path) -> set[int]:
    indexes: set[int] = set()

    for path in sdir.glob("bg_*.png"):
        match = _BG_FILE_RE.match(path.name)
        if match:
            indexes.add(int(match.group(1)))

    for bg in raw.get("backgrounds") or []:
        if isinstance(bg, dict):
            try:
                indexes.add(int(bg["index"]))
            except (KeyError, TypeError, ValueError):
                continue

    try:
        n_options = int(raw.get("n_options") or 0)
    except (TypeError, ValueError):
        n_options = 0
    if n_options > 0:
        indexes.update(range(n_options))

    return indexes


def _next_background_index(raw: dict, sdir: Path) -> int:
    indexes = _background_indexes(raw, sdir)
    return (max(indexes) + 1) if indexes else 0


def _selection_payload(raw: dict) -> dict[str, Any]:
    return {
        "selectedBgIndex": raw.get("selected_bg"),
        "bgWidth": int(raw.get("bg_width") or 0),
        "bgHeight": int(raw.get("bg_height") or 0),
        "sections": _camera_sections(raw.get("sections") or []),
    }


def _background_info(
    bg_index: int,
    generation_time: float,
    bg_width: int,
    bg_height: int,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    bg_info = {
        "index": bg_index,
        "file": f"bg_{bg_index:02d}.png",
        "generationTime": round(generation_time, 1),
        "width": bg_width,
        "height": bg_height,
    }
    if metadata:
        reserved = set(bg_info)
        collisions = reserved.intersection(metadata)
        if collisions:
            raise ValueError(f"background metadata cannot override reserved keys: {sorted(collisions)}")
        bg_info.update(metadata)
    return bg_info


def _backgrounds_by_index(raw: dict[str, Any]) -> dict[int, dict[str, Any]]:
    backgrounds: dict[int, dict[str, Any]] = {}
    for bg in raw.get("backgrounds", []):
        if not isinstance(bg, dict) or "index" not in bg:
            continue
        try:
            backgrounds[int(bg["index"])] = dict(bg)
        except (TypeError, ValueError):
            continue
    return backgrounds


def _record_background_locked(
    raw: dict,
    bg_info: dict[str, Any],
    *,
    select: bool,
    auto_select_if_empty: bool,
) -> None:
    by_index = _backgrounds_by_index(raw)
    by_index[int(bg_info["index"])] = bg_info
    raw["backgrounds"] = [by_index[i] for i in sorted(by_index)]

    should_select = select or (auto_select_if_empty and raw.get("selected_bg") is None)
    if should_select:
        raw["selected_bg"] = int(bg_info["index"])
        raw["bg_width"] = int(bg_info["width"])
        raw["bg_height"] = int(bg_info["height"])
        if raw.get("mode") == "landscape":
            raw["sections"] = section_ranges(int(bg_info["width"]))


def save_new_background_image(
    session_id: str,
    img: Image.Image,
    *,
    generation_time: float,
    bg_width: int,
    bg_height: int,
    metadata: dict[str, Any] | None = None,
    select: bool = False,
) -> dict[str, Any]:
    """Atomically save a new non-generation-slot background image.

    Background generation owns indexes 0..n_options-1. Extra candidates, such
    as upscaled backgrounds, are allocated after those reserved slots under the
    session lock so parallel upscales cannot pick the same bg_NN path.
    """
    if bg_width <= 0 or bg_height <= 0:
        raise ValueError(
            f"bg dimensions must be positive, got {bg_width}x{bg_height}"
        )

    sdir = session_dir(session_id)
    sdir.mkdir(parents=True, exist_ok=True)
    tmp = sdir / f".bg-upscale-{os.getpid()}-{uuid.uuid4().hex}.png.tmp"
    try:
        img.save(tmp, format="PNG")
        out_path: Path | None = None
        with _session_lock:
            raw = load_session_raw(session_id)
            if raw is None:
                raise FileNotFoundError(f"Session not found: {session_id}")
            bg_index = _next_background_index(raw, sdir)
            out_path = sdir / f"bg_{bg_index:02d}.png"
            os.replace(tmp, out_path)
            bg_info = _background_info(
                bg_index,
                generation_time,
                bg_width,
                bg_height,
                metadata,
            )
            _record_background_locked(
                raw,
                bg_info,
                select=select,
                auto_select_if_empty=False,
            )
            try:
                save_session(session_id, raw)
            except Exception:
                try:
                    out_path.unlink()
                except OSError:
                    pass
                raise
            return {**bg_info, **_selection_payload(raw)}
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def list_sessions(*, include_public: bool = False) -> list[dict]:
    """List all available sessions (levels with hitboxes, session.json, or public level packages)."""
    results = []
    seen_session_ids: set[str] = set()
    levels_index = load_levels_index()
    previewed_level_ids = {
        level.get("id")
        for level in levels_index
        if isinstance(level, dict) and isinstance(level.get("id"), str)
    }
    catalog_entries = _catalog_levels_by_id(load_catalog_manifest())
    archive_ledger = _load_archive_ledger()
    roots = [(LEVELS_DIR, "levels")]
    if include_public:
        roots.append((GAME_PUBLIC_LEVELS, "public-levels"))
    for root, asset_base in roots:
        if not root.exists():
            continue
        for d in sorted(root.iterdir()):
            if not d.is_dir() or d.name in seen_session_ids:
                continue
            catalog_entry = catalog_entries.get(d.name)
            # Tombstoning removes a catalog package from every authoring and
            # selection surface while retaining its content-addressed bytes for
            # historical catalog snapshots. A source session still wins above,
            # so an operator can inspect its explicit archived state until that
            # disposable source directory is cleaned up.
            if asset_base == "public-levels" and catalog_entry and catalog_entry.get("tombstonedAt") is not None:
                continue
            has_session = (d / "session.json").exists()
            has_hitboxes = (d / "hitboxes.json").exists()
            has_level = (d / "level.json").exists()
            has_image = (d / "inpainted.png").exists() or (d / "color.png").exists()
            if not (has_session or has_level or (has_hitboxes and has_image)):
                continue
            seen_session_ids.add(d.name)
            # Get name and dimensions from level.json (pipeline or public)
            name = d.name
            n_dogs = 0
            width = 0
            height = 0
            for lj_path in [d / "level.json", GAME_PUBLIC_LEVELS / d.name / "level.json"]:
                if lj_path.exists():
                    with open(lj_path) as f:
                        lj = json.load(f)
                    name = lj.get("name", d.name)
                    n_dogs = len(lj.get("dogs", []))
                    width = lj.get("width", 0)
                    height = lj.get("height", 0)
                    break
            if n_dogs == 0 and has_hitboxes:
                with open(d / "hitboxes.json") as f:
                    n_dogs = len(json.load(f))
            # Sessions without dogs / hitboxes / color are "background-only"
            # and still need to appear in the Gallery so the user can either
            # finish them in the Wizard or bulk-clear them via the timed-out
            # action. Previously we skipped them; keep them listed so the
            # Gallery can surface state and filter accordingly.
            # Read dimensions from image if not in level.json (used for orientation
            # display only — orientation filtering was removed when landscape became
            # a first-class authoring path in Slice A).
            if width == 0 or height == 0:
                bg_path = d / "bg_00.png"
                if bg_path.exists():
                    with Image.open(bg_path) as img:
                        width, height = img.size
            # Load session raw (if any) so _detect_setting prefers stored field.
            raw_for_setting = None
            if has_session:
                try:
                    with open(d / "session.json") as f:
                        raw_for_setting = json.load(f)
                except (OSError, json.JSONDecodeError):
                    raw_for_setting = None
            # `thumb_00.jpg` is a legacy artifact of the v1 SSE background flow;
            # the durable-job path never writes it, so CLI-authored levels
            # reported hasThumbnail=false and the Gallery refused to let a human
            # add them to the Lineup ("Missing preview thumbnail asset") even
            # though the thumbnail endpoint serves them fine. Report what the
            # gallery can actually render: any source `ensure_gallery_thumbnail`
            # accepts.
            has_thumb = (d / "thumb_00.jpg").exists() or any(
                (d / name).exists()
                for name in ("color.png", "bg_00.png", "openai_color.png", "openai_color_v2.png")
            )
            # Deprecated wire name: `exported` now mirrors local preview listing
            # rather than raw package-file presence. Catalog-uploaded-but-unlisted
            # assets can live under public/levels/ without being preview/live listed.
            exported = d.name in previewed_level_ids
            catalog_uploaded = catalog_entry is not None
            catalog_listable = bool(catalog_entry and catalog_entry.get("listable") is True)
            catalog_tombstoned = bool(catalog_entry and catalog_entry.get("tombstonedAt") is not None)
            bundled_in_app = bool(catalog_entry and catalog_entry.get("bundledInApp") is True)
            # Variants present on disk — drives the gallery's model filter
            # and per-card variant picker. "gemini" is the native pipeline bg +
            # color.png; the openai_* files are the Phase-A/B outputs from the
            # GPT Image 2 comparison run. A session can have several of these.
            variants: list[str] = []
            if has_image:
                variants.append("gemini")
            elif (d / "bg_00.png").exists():
                # Gemini bg generated but no composite yet — surface as a
                # background-only card so the user can see / resume / clear it.
                variants.append("gemini_bg_only")
            if (d / "openai_color.png").exists():
                variants.append("openai")
            elif (d / "openai_bg.png").exists():
                variants.append("openai_bg_only")
            if (d / "openai_color_v2.png").exists():
                variants.append("openai_v2")
            elif (d / "openai_bg_v2.png").exists():
                variants.append("openai_v2_bg_only")

            asset_version = 0
            versioned_assets = [
                "color.png",
                "openai_color.png",
                "openai_bg.png",
                "openai_color_v2.png",
                "openai_bg_v2.png",
            ]
            versioned_assets.extend(p.name for p in d.glob("bg_*.png"))
            for asset_name in versioned_assets:
                try:
                    asset_version = max(asset_version, (d / asset_name).stat().st_mtime_ns)
                except OSError:
                    pass

            # Model used for generation at session create time (best-effort —
            # falls back to empty string for legacy sessions). Distinct from
            # `variants`: model is the bg-gen model at creation; variants
            # enumerate which composites have been produced since.
            bg_model = (
                (raw_for_setting or {}).get("bg_model")
                or (raw_for_setting or {}).get("model", "")
            ) if raw_for_setting else ""
            inpaint_model = (
                (raw_for_setting or {}).get("inpaint_model")
                or (raw_for_setting or {}).get("model", "")
            ) if raw_for_setting else ""
            persisted_archive = archive_ledger.get(d.name)
            if not isinstance(persisted_archive, dict):
                persisted_archive = {}
            archived = bool(
                (raw_for_setting or {}).get("archived", False)
                or persisted_archive.get("archived", False)
            )
            archived_variants = sorted({
                *((raw_for_setting or {}).get("archived_variants") or []),
                *(persisted_archive.get("archivedVariants") or []),
            })
            scene = (raw_for_setting or {}).get("scene") if raw_for_setting else None
            entity = (raw_for_setting or {}).get("entity") if raw_for_setting else None
            exported_variant = (raw_for_setting or {}).get("exported_variant", "gemini") if raw_for_setting else "gemini"
            selected_bg = (raw_for_setting or {}).get("selected_bg") if raw_for_setting else None
            tags = list((raw_for_setting or {}).get("tags") or []) if raw_for_setting else []
            created_at = (raw_for_setting or {}).get("created_at") if raw_for_setting else None
            if not isinstance(created_at, str) or not created_at.strip():
                created_at = datetime.fromtimestamp(d.stat().st_mtime, timezone.utc).isoformat()
            orientation = (raw_for_setting or {}).get("mode") if raw_for_setting else None
            if orientation not in ("portrait", "landscape"):
                orientation = "landscape" if width > height else "portrait"

            canonical = read_canonical_session(d.name)
            hitbox_review = get_hitbox_review_status(d.name)
            final_cutout_review = get_final_cutout_review_status(
                d.name, hitbox_status=hitbox_review,
            )
            final_cutout_readiness = (
                get_final_cutout_review_readiness(d.name)
                if hitbox_review["current"]
                else {"ready": False, "activeBirds": n_dogs, "missingCutouts": n_dogs}
            )
            canonical_state = canonical.state.value

            review_sidecars = []
            for sidecar_path in d.glob("dogs/dog_*/sprite_*.json"):
                try:
                    review_sidecars.append(json.loads(sidecar_path.read_text()))
                except (OSError, json.JSONDecodeError):
                    continue
            human_confirmed_birds = sum(
                bool((item.get("humanReview") or {}).get("confirmed"))
                for item in review_sidecars
                if isinstance(item, dict)
            )
            regeneration_candidate_count = sum(
                bool((item.get("regenerationReview") or {}).get("candidate"))
                and not bool((item.get("humanReview") or {}).get("confirmed"))
                for item in review_sidecars
                if isinstance(item, dict)
            )

            results.append({
                "id": d.name,
                "name": name,
                "nDogs": n_dogs,
                "hasImage": has_image,
                "hasThumbnail": has_thumb,
                "setting": _detect_setting(d.name, raw_for_setting),
                "exported": exported,
                "catalogUploaded": catalog_uploaded,
                "catalogListable": catalog_listable,
                "catalogTombstoned": catalog_tombstoned,
                "bundledInApp": bundled_in_app,
                "model": bg_model,
                "bgModel": bg_model,
                "inpaintModel": inpaint_model,
                "variants": variants,
                "assetVersion": asset_version,
                "archived": archived,
                "archivedVariants": archived_variants,
                "scene": scene,
                "entity": entity,
                "exportedVariant": exported_variant,
                "selectedBgIndex": selected_bg,
                "tags": tags,
                "createdAt": created_at,
                "orientation": orientation,
                "canonicalState": canonical_state,
                "assetBase": asset_base,
                "humanConfirmedBirds": human_confirmed_birds,
                "reviewableBirds": len(review_sidecars),
                "regenerationCandidateCount": regeneration_candidate_count,
                "hitboxesBlessed": hitbox_review["current"],
                "hitboxesBlessingStale": hitbox_review["stale"],
                "hitboxesBlessedAt": hitbox_review.get("reviewedAt"),
                "cutoutsFinalBlessed": final_cutout_review["current"],
                "cutoutsFinalBlessingStale": final_cutout_review["stale"],
                "cutoutsFinalBlessedAt": final_cutout_review.get("reviewedAt"),
                "finalCutoutReviewReady": final_cutout_readiness["ready"],
                "missingFinalCutouts": final_cutout_readiness["missingCutouts"],
                "invalidFinalPadding": final_cutout_readiness.get("invalidPadding", 0),
                # Wire compatibility for older clients and golden-dataset tools.
                "goldenDatasetApproved": final_cutout_review["current"],
                "goldenDatasetReviewedAt": final_cutout_review.get("reviewedAt"),
            })
    return results


def ensure_session_json(session_id: str) -> dict | None:
    """Ensure session.json exists, creating one from disk artifacts if needed.

    For levels with no session.json, synthesizes one from hitboxes.json,
    bg_00.png dimensions, and level.json metadata.
    """
    sdir = session_dir(session_id)
    public_dir = GAME_PUBLIC_LEVELS / session_id
    # session_dir may deliberately select a reviewed public package over a
    # stale authoring duplicate. Treat the selected root as authoritative;
    # the mere existence of that duplicate must not change hydration.
    is_public_package = sdir == public_dir
    if not sdir.exists():
        if not (public_dir / "level.json").exists() or not (public_dir / "color.png").exists():
            return None
        sdir.mkdir(parents=True, exist_ok=True)

    raw = load_session_raw(session_id)
    if raw is not None:
        return raw

    if is_public_package:
        level_json_path = public_dir / "level.json"
        color_path = public_dir / "color.png"
        if not level_json_path.exists() or not color_path.exists():
            return None
        with open(level_json_path) as f:
            level_json = json.load(f)
        level_dogs = [
            dog for dog in level_json.get("dogs", [])
            if isinstance(dog, dict) and "x" in dog and "y" in dog
        ]
        hitboxes = [
            {"x": dog["x"], "y": dog["y"], "r": dog.get("r", dog.get("radius", 50)),
             **({"id": dog["id"]} if dog.get("id") else {})}
            for dog in level_dogs
        ]
        with Image.open(color_path) as img:
            bg_width, bg_height = img.size
        level_sections = level_json.get("sections") or []
        is_landscape = bool(level_sections) and bg_width > bg_height
        inferred_mode = "landscape" if is_landscape else "portrait"
        inferred_aspect, inferred_size = _defaults_for_mode(inferred_mode)
        from levelbuilder.prompts import ENTITIES as _ENTITIES
        from levelbuilder.prompts import STYLES as _STYLES
        from levelbuilder.prompts import get_entity_prompt as _get_entity_prompt

        entity = level_json.get("entity")
        if not isinstance(entity, str) or entity not in _ENTITIES:
            entity = next(
                (
                    candidate
                    for candidate in sorted(_ENTITIES, key=len, reverse=True)
                    if re.search(rf"_{re.escape(candidate)}_[^_]+$", session_id)
                ),
                "dog",
            )
        style = level_json.get("style")
        if not isinstance(style, str) or style not in _STYLES:
            name_match = re.search(r"\(([^()]+)\)\s*$", str(level_json.get("name") or ""))
            inferred_style = name_match.group(1) if name_match else None
            style = inferred_style if inferred_style in _STYLES else "old_pixel_art"
        return {
            "id": session_id,
            "style": style,
            "entity": entity,
            "dog_prompt": _get_entity_prompt(style, entity),
            "scene_prompt": level_json.get("name", session_id),
            "model": "google/gemini-3.1-flash-image-preview",
            "bg_model": "google/gemini-3.1-flash-image-preview",
            "inpaint_model": "google/gemini-3.1-flash-image-preview",
            "n_options": len(list(public_dir.glob("bg_*.png"))),
            "n_dogs": len(hitboxes),
            "mode": inferred_mode,
            "aspect_ratio": inferred_aspect,
            "image_size": inferred_size,
            "created_at": datetime.fromtimestamp(public_dir.stat().st_mtime, timezone.utc).isoformat(),
            "backgrounds": [
                {"index": i, "file": bg_path.name, "generationTime": 0}
                for i, bg_path in enumerate(sorted(public_dir.glob("bg_*.png")))
            ],
            "selected_bg": 0,
            "bg_width": bg_width,
            "bg_height": bg_height,
            "sections": level_sections if inferred_mode == "landscape" else [],
            "hitboxes": hitboxes,
            "dogs": [
                {
                    "index": i,
                    "id": dog.get("id"),
                    "status": "done",
                    "activeVariant": (
                        int(match.group(1))
                        if (match := re.search(
                            r"sprite_(\d+)\.png$",
                            str((dog.get("sprite") or {}).get("image") or ""),
                        ))
                        else None
                    ),
                    "promptOverride": None,
                }
                for i, dog in enumerate(level_dogs)
            ],
        }

    if not (sdir / "hitboxes.json").exists():
        public_level_json = public_dir / "level.json"
        public_color = public_dir / "color.png"
        if not public_level_json.exists() or not public_color.exists():
            return None
        if not (sdir / "level.json").exists():
            shutil.copy2(public_level_json, sdir / "level.json")
        if not (sdir / "color.png").exists():
            shutil.copy2(public_color, sdir / "color.png")
        for bg_path in sorted(public_dir.glob("bg_*.png")):
            target = sdir / bg_path.name
            if not target.exists():
                shutil.copy2(bg_path, target)
        with open(public_level_json) as f:
            public_level = json.load(f)
        hitboxes = [
            {"x": dog["x"], "y": dog["y"], "r": dog.get("r", dog.get("radius", 50))}
            for dog in public_level.get("dogs", [])
            if isinstance(dog, dict) and "x" in dog and "y" in dog
        ]
        with open(sdir / "hitboxes.json", "w") as f:
            json.dump(hitboxes, f, indent=2)

    # No session.json — synthesize from what's on disk
    hb_path = sdir / "hitboxes.json"
    bg_path = sdir / "bg_00.png"
    if not hb_path.exists() or not bg_path.exists():
        return None

    with open(hb_path) as f:
        hitboxes = json.load(f)

    with Image.open(bg_path) as img:
        bg_width, bg_height = img.size

    # Read name + sections (if any) from level.json
    name = session_id
    level_sections: list[dict] = []
    for lj_path in [sdir / "level.json", GAME_PUBLIC_LEVELS / session_id / "level.json"]:
        if lj_path.exists():
            with open(lj_path) as f:
                lj = json.load(f)
            name = lj.get("name", session_id)
            level_sections = lj.get("sections") or []
            break

    # Build dogs array — create variant directories from inpainted.png if they don't exist
    dogs_base = dogs_dir(session_id)
    inpainted_path = sdir / "inpainted.png"
    if not inpainted_path.exists():
        inpainted_path = sdir / "color.png"

    needs_extraction = not dogs_base.exists() or not any(dogs_base.glob("dog_*/variant_*.png"))

    if needs_extraction and inpainted_path.exists() and bg_path.exists():
        # Extract each dog's crop from the inpainted image and save as variant_000.png
        from levelbuilder.image_ops import _crop_box
        from levelbuilder.hitboxes import Hitbox as HitboxDC

        with Image.open(inpainted_path) as inpainted, Image.open(bg_path) as bg_img:
            w, h = bg_img.size
            for i, hb in enumerate(hitboxes):
                dog_folder = dogs_base / f"dog_{i:02d}"
                dog_folder.mkdir(parents=True, exist_ok=True)
                variant_path = dog_folder / "variant_000.png"
                if not variant_path.exists():
                    hitbox = HitboxDC(x=hb["x"], y=hb["y"], radius=hb.get("r", hb.get("radius", 50)))
                    box = _crop_box(hitbox, w, h, padding=1.5)
                    crop = inpainted.crop(box)
                    crop.save(variant_path)

    dogs = []
    for i in range(len(hitboxes)):
        dog_folder = dogs_base / f"dog_{i:02d}"
        has_variants = dog_folder.exists() and any(dog_folder.glob("variant_*.png"))
        dogs.append({
            "index": i,
            "status": "done" if has_variants else "pending",
            # activeVariant is the sentinel that gates partial-export: `is not None`
            # means "shippable." Dogs without variants on disk must be None, not
            # 0 — a legitimate successfully-painted dog uses activeVariant=0 as
            # its first real variant, and conflating "no variant" with "variant 0"
            # silently ships errored dogs (fix 015).
            "activeVariant": 0 if has_variants else None,
            "promptOverride": None,
        })

    # Ensure color.png, bw.png, level.json exist in session dir
    # (script-generated levels may only have them in public/levels/)
    for fname in ("color.png", "level.json"):
        if not (sdir / fname).exists():
            pub = GAME_PUBLIC_LEVELS / session_id / fname
            if pub.exists():
                shutil.copy2(pub, sdir / fname)
    if not (sdir / "bw.png").exists() and bg_path.exists():
        with Image.open(bg_path) as src:
            bw = src.convert("L").convert("RGB")
        bw.save(sdir / "bw.png")
        bw.close()

    # Infer orientation from BOTH signals: sections present AND bg is actually wider
    # than tall. A portrait bg with a stray `sections: [...]` in level.json (from a
    # hand-edit or mis-run of the landscape CLI) would otherwise be silently
    # promoted to landscape with 16:9/4K defaults that mis-match the real bg.
    is_landscape = bool(level_sections) and bg_width > bg_height
    inferred_mode = "landscape" if is_landscape else "portrait"
    inferred_aspect, inferred_size = _defaults_for_mode(inferred_mode)

    # Pull the legacy dog prompt from the canonical source so it stays in
    # sync if the template is edited later. Pre-readable-id sessions were
    # all pixelart/dog.
    from levelbuilder.prompts import get_entity_prompt as _get_entity_prompt
    data = {
        "id": session_id,
        "style": "pixelart",
        "dog_prompt": _get_entity_prompt("old_pixel_art", "dog"),
        "scene_prompt": name,
        "model": "google/gemini-3.1-flash-image-preview",
        "bg_model": "google/gemini-3.1-flash-image-preview",
        "inpaint_model": "google/gemini-3.1-flash-image-preview",
        "n_options": len(list(sdir.glob("bg_*.png"))),
        "n_dogs": len(hitboxes),
        "mode": inferred_mode,
        "aspect_ratio": inferred_aspect,
        "image_size": inferred_size,
        "created_at": now_iso(),
        # Derive index from the ACTUAL filename, not enumerate() position
        # (fresh-review P3 — ledger 054 #28): with a gap in the bg files
        # (bg_00 deleted, bg_01 kept) the positional synthesis produced a
        # record {index: 0, file: "bg_00.png"} pointing at a nonexistent file.
        "backgrounds": [
            {"index": int(m.group(1)), "file": f.name, "generationTime": 0}
            for f in sorted(sdir.glob("bg_*.png"))
            if (m := re.match(r"^bg_(\d{2})\.png$", f.name))
        ],
        "selected_bg": next(
            (int(m.group(1)) for f in sorted(sdir.glob("bg_*.png"))
             if (m := re.match(r"^bg_(\d{2})\.png$", f.name))),
            0,
        ),
        "bg_width": bg_width,
        "bg_height": bg_height,
        # Synthesis only carries level.json's sections forward when orientation
        # actually agrees. A portrait-classified session with stale landscape
        # sections would expose phantom section overlays on the wire — keep the
        # session-state internally consistent: orientation is the source of truth.
        "sections": level_sections if inferred_mode == "landscape" else [],
        "dogs": dogs,
    }
    # Synthesis happens once per legacy session on first hydrate; serialize the
    # write so a concurrent first-access from two threads can't both synthesize
    # and clobber each other.
    with _session_lock:
        if load_session_raw(session_id) is None:
            save_session(session_id, data)
        else:
            # Another thread won the synthesis race; return what's now on disk
            # rather than overwriting it.
            return load_session_raw(session_id)
    return data


def hydrate_session(session_id: str) -> dict | None:
    """Load session and hydrate with variant info from dogs/ directory.

    Returns the full SessionResponse shape for the frontend.
    """
    raw = ensure_session_json(session_id)
    if raw is None:
        return None

    sdir = session_dir(session_id)

    # Level orientation. Legacy sessions (pre-landscape feature) default to portrait.
    # On disk the field is `mode`; on the wire we expose `orientation` (distinct
    # from any future UI flow-state field that might want the name `mode`).
    orientation = raw.get("mode") or "portrait"

    # Self-heal: SSE streams that die after saving bg_NN.png to disk but
    # before persisting the backgrounds[] / selected_bg fields to
    # session.json leave the session in a state where the wizard sees
    # "no backgrounds" and renders a clean Step 1 form. Scan disk for
    # bg_NN.png files and reconstruct the backgrounds list + default the
    # selection to bg_00.png when present.
    _BG_RE = re.compile(r"^bg_(\d{2})\.png$")
    on_disk_bg_indices = sorted(
        int(m.group(1)) for f in sdir.iterdir() if f.is_file() and (m := _BG_RE.match(f.name))
    ) if sdir.exists() else []

    raw_backgrounds = raw.get("backgrounds") or []
    if not raw_backgrounds and on_disk_bg_indices:
        raw_backgrounds = [{"index": i, "file": f"bg_{i:02d}.png", "generationTime": 0.0} for i in on_disk_bg_indices]

    # Get background dimensions from session.json (cached) or image file
    bg_width = raw.get("bg_width", 0)
    bg_height = raw.get("bg_height", 0)
    selected_bg = raw.get("selected_bg")
    if selected_bg is None and on_disk_bg_indices:
        selected_bg = on_disk_bg_indices[0]
    if selected_bg is not None and (bg_width == 0 or bg_height == 0):
        bg_path = sdir / f"bg_{selected_bg:02d}.png"
        if bg_path.exists():
            img = Image.open(bg_path)
            bg_width, bg_height = img.size
            img.close()

    # Hydrate per-dog state from dogs/ directory + session.json dogs field
    raw_dogs = raw.get("dogs", [])
    raw_dogs_by_idx = {d["index"]: d for d in raw_dogs}

    dogs_base = dogs_dir(session_id)
    hydrated_dogs = []
    _DOG_FOLDER_RE = re.compile(r"^dog_(\d+)$")
    # Indices whose dog was deleted by id (tombstone). A deleted dog's folder can
    # exist on disk — delete renames it away, but an in-flight paid job finishing
    # AFTER the delete can mkdir it back. Without this skip, that orphan folder
    # hydrates as an id-less "ghost" dog the UI can neither select nor delete
    # (fresh-review P1 — ledger 054 #2). A LIVE dogs[] entry at the same index
    # (legitimate index reuse after deleting the max slot) takes precedence.
    _deleted_indices = {
        i for i in (raw.get("deleted_dog_indices") or []) if isinstance(i, int)
    }
    if dogs_base.exists():
        for dog_folder in sorted(dogs_base.iterdir()):
            if not dog_folder.is_dir():
                continue
            m = _DOG_FOLDER_RE.match(dog_folder.name)
            if m is None:
                continue
            idx = int(m.group(1))
            if idx in _deleted_indices and idx not in raw_dogs_by_idx:
                continue
            # Only variant_*.png are selectable paintings. The folder also holds
            # sprite_NNN.png / sprite_mask_NNN.png cutout derivatives, and "s"
            # sorts before "v" — including them put a sprite at variants[0] on
            # every painted dog, breaking the activeVariant index contract the
            # UI relies on (fresh-review P1 — ledger 054 #3, verified on real
            # sessions). Contiguity from variant_000 (get_next_variant_index
            # mints len(existing)) keeps list position == variant index.
            variants = sorted(
                f"dogs/{dog_folder.name}/{f.name}"
                for f in dog_folder.iterdir()
                if f.suffix == ".png" and f.name.startswith("variant_")
            )
            raw_dog = raw_dogs_by_idx.get(idx, {})
            hydrated_dogs.append({
                "index": idx,
                "id": raw_dog.get("id"),  # A1: stable id (None until backfilled/minted)
                "status": raw_dog.get("status", "done" if variants else "pending"),
                # CRITICAL: do NOT `or 0` here — that falsy-coerces None→0 on every
                # wire response and nullifies the 015 partial-export filter. An
                # errored dog has activeVariant=None on disk; the UI must see that
                # explicitly so its readers can distinguish "unpainted" from
                # "variant 0 selected". See types.ts:34 `activeVariant: number | null`.
                "activeVariant": raw_dog.get("activeVariant"),
                "promptOverride": raw_dog.get("promptOverride"),
                "variants": variants,
            })

    hydrated_indices = {d["index"] for d in hydrated_dogs}
    for idx in sorted(set(raw_dogs_by_idx) - hydrated_indices):
        raw_dog = raw_dogs_by_idx[idx]
        hydrated_dogs.append({
            "index": idx,
            "id": raw_dog.get("id"),  # A1: stable id (None until backfilled/minted)
            "status": raw_dog.get("status", "pending"),
            "activeVariant": raw_dog.get("activeVariant"),
            "promptOverride": raw_dog.get("promptOverride"),
            "variants": [],
        })
    hydrated_dogs.sort(key=lambda d: d["index"])

    # Get hitboxes from the latest hitboxes.json
    hitboxes = [
        {"x": h["x"], "y": h["y"], "r": h.get("r", h.get("radius", 30)),
         **({"id": h["id"]} if h.get("id") else {})}
        for h in (raw.get("hitboxes") or [])
        if isinstance(h, dict) and "x" in h and "y" in h
    ]
    hb_path = sdir / "hitboxes.json"
    if hb_path.exists():
        with open(hb_path) as f:
            hb_data = json.load(f)
        # Normalize to wire format {x, y, r, id?}. id carried through (A1) so the
        # client can address dogs by stable id; absent on un-backfilled sessions.
        hitboxes = [
            {"x": h["x"], "y": h["y"], "r": h.get("r", h.get("radius", 30)),
             **({"id": h["id"]} if h.get("id") else {})}
            for h in hb_data
        ]

    bg_model = raw.get("bg_model") or raw.get("model", "")
    inpaint_model = raw.get("inpaint_model") or raw.get("model", "")
    mask_params = raw.get("mask_params") or {}
    bg_provider = raw.get("bg_provider") or ("layer" if str(bg_model).startswith("layer/") else "merceka")
    bundled_manifest = load_bundled_manifest() or {}
    previewed_locally = any(
        isinstance(level, dict) and level.get("id") == session_id
        for level in bundled_manifest.get("levels") or []
    )
    catalog_entry = _catalog_level_entry(session_id)
    return {
        "id": session_id,
        "orientation": orientation,
        "style": raw.get("style", ""),
        "model": bg_model,
        "bgModel": bg_model,
        "bgProvider": bg_provider,
        "inpaintModel": inpaint_model,
        "upscaleEnabled": bool(raw.get("upscale_enabled", False)),
        "upscaleModel": raw.get("upscale_model"),
        "upscaleTargetLongEdge": _coerce_upscale_target_long_edge(raw.get("upscale_target_long_edge")),
        "scenePrompt": raw.get("scene_prompt", ""),
        "dogPrompt": raw.get("dog_prompt", ""),
        "nDogs": raw.get("n_dogs", 7),
        "backgrounds": raw_backgrounds,
        "selectedBgIndex": selected_bg,
        "bgWidth": bg_width,
        "bgHeight": bg_height,
        "sections": _camera_sections(raw.get("sections") or []),
        "hitboxes": hitboxes,
        "dogs": hydrated_dogs,
        "setting": raw.get("setting"),
        "scene": raw.get("scene"),
        "entity": raw.get("entity"),
        "promptContext": raw.get("prompt_context") or {},
        "archived": bool(raw.get("archived", False)),
        "exported": previewed_locally,
        "catalogUploaded": catalog_entry is not None,
        "catalogListable": bool(catalog_entry and catalog_entry.get("listable") is True),
        "catalogTombstoned": bool(catalog_entry and catalog_entry.get("tombstonedAt") is not None),
        "bundledInApp": bool(catalog_entry and catalog_entry.get("bundledInApp") is True),
        "exportedVariant": raw.get("exported_variant", "gemini"),
        # Accepted vertical-extension config (targetAspect + bandsRef), or None.
        # The band-generation stage writes it on accept; export/publish key off it.
        "extension": raw.get("extension"),
        # Which candidate bands currently exist on disk (session extension/ dir).
        # Lets the editor re-surface the Accept action after a reload without
        # forcing a fresh (paid) regeneration to rediscover completed bands.
        "extensionBands": {
            "top": (session_dir(session_id) / "extension" / "top.png").exists(),
            "bottom": (session_dir(session_id) / "extension" / "bottom.png").exists(),
        },
        "maskParams": {
            "radial": float(mask_params.get("radial", 0.0)),
            "feather": float(mask_params.get("feather", 0.0)),
        },
    }


def create_session(
    session_id: str,
    scene_prompt: str,
    dog_prompt: str,
    style: str,
    model: str,
    n_options: int,
    n_dogs: int,
    bg_model: str | None = None,
    inpaint_model: str | None = None,
    mode: Literal["portrait", "landscape"] = "portrait",
    aspect_ratio: str = "9:16",
    image_size: str = "1K",
    upscale_enabled: bool = False,
    upscale_model: str | None = None,
    upscale_target_long_edge: int = 3840,
    setting: str | None = None,
    scene: str | None = None,
    entity: str | None = None,
    tags: list[str] | None = None,
    bg_provider: str | None = None,
    prompt_context: dict[str, Any] | None = None,
) -> dict:
    """Create a new session directory and write initial session.json.

    Landscape mode forces aspect_ratio="16:9" and image_size="4K" by default.
    If the modular upscale stage is enabled, landscape uses a 2K source so the
    post-generation upscale can create 4K candidates from an approved layout.
    Portrait mode respects client values.

    Setting/scene/entity are persisted so list_sessions can surface them
    directly (no id-string parsing) and so _detect_setting can prefer the
    stored value over prefix heuristics.
    """
    if mode == "landscape":
        aspect_ratio, image_size = _defaults_for_mode(mode)
        if upscale_enabled:
            image_size = "2K"

    sdir = session_dir(session_id)
    sdir.mkdir(parents=True, exist_ok=True)
    _record_archive_state(session_id, archived=False, variants=[])
    resolved_bg_model = bg_model or model
    resolved_inpaint_model = inpaint_model or model
    resolved_bg_provider = bg_provider or ("layer" if str(resolved_bg_model).startswith("layer/") else "merceka")
    clean_tags: list[str] = []
    for tag in tags or []:
        clean_tag = str(tag).strip()[:64]
        if clean_tag and clean_tag not in clean_tags:
            clean_tags.append(clean_tag)
        if len(clean_tags) >= 20:
            break

    data = {
        "id": session_id,
        "style": style,
        "dog_prompt": dog_prompt,
        "scene_prompt": scene_prompt,
        "model": resolved_bg_model,
        "bg_model": resolved_bg_model,
        "bg_provider": resolved_bg_provider,
        "inpaint_model": resolved_inpaint_model,
        "n_options": n_options,
        "n_dogs": n_dogs,
        "mode": mode,
        "aspect_ratio": aspect_ratio,
        "image_size": image_size,
        "upscale_enabled": upscale_enabled,
        "upscale_model": upscale_model,
        "upscale_target_long_edge": upscale_target_long_edge,
        "setting": setting,
        "scene": scene,
        "entity": entity,
        "tags": clean_tags,
        "prompt_context": prompt_context or {},
        "created_at": now_iso(),
        "backgrounds": [],
        "selected_bg": None,
        "bg_width": 0,
        "bg_height": 0,
        "sections": [],
        "dogs": [],
    }
    save_session(session_id, data)
    return data


def update_session_field(session_id: str, **fields: Any) -> None:
    """Update specific fields in session.json."""
    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return
        raw.update(fields)
        save_session(session_id, raw)


def record_generated_background(
    session_id: str,
    bg_index: int,
    generation_time: float,
    bg_width: int,
    bg_height: int,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Persist a generated background immediately after bg_NN.png is written.

    SSE clients can disconnect after provider work starts. The image may still
    arrive and be saved, but the stream cleanup path may never see the finished
    future. Recording here keeps session.json aligned with files on disk.
    """
    if bg_width <= 0 or bg_height <= 0:
        raise ValueError(
            f"bg dimensions must be positive, got {bg_width}x{bg_height}"
        )

    bg_info = _background_info(
        bg_index,
        generation_time,
        bg_width,
        bg_height,
        metadata,
    )

    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return None
        _record_background_locked(
            raw,
            bg_info,
            select=False,
            auto_select_if_empty=True,
        )
        save_session(session_id, raw)
        return bg_info


def merge_background_records(session_id: str, backgrounds: list[dict[str, Any]]) -> None:
    """Merge background records without clobbering upscaled/manual candidates."""
    if not backgrounds:
        return
    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return
        for bg_info in backgrounds:
            if not isinstance(bg_info, dict):
                continue
            _record_background_locked(
                raw,
                dict(bg_info),
                select=False,
                auto_select_if_empty=True,
            )
        save_session(session_id, raw)


def background_info(raw: dict[str, Any], bg_index: int) -> dict[str, Any] | None:
    return _backgrounds_by_index(raw).get(bg_index)


def has_downstream_artifacts(session_id: str) -> bool:
    sdir = session_dir(session_id)
    for path in (sdir / "hitboxes.json", sdir / "color.png", sdir / "inpainted.png", sdir / "level.json"):
        if path.exists():
            return True

    raw = load_session_raw(session_id) or {}
    for dog in raw.get("dogs") or []:
        if isinstance(dog, dict) and dog.get("activeVariant") is not None:
            return True

    dog_root = dogs_dir(session_id)
    return dog_root.exists() and any(dog_root.glob("dog_*/variant_*.png"))


def select_background(session_id: str, bg_index: int, bg_width: int, bg_height: int) -> dict[str, Any] | None:
    """Atomically record the selected background and, for landscape sessions,
    (re)compute section ranges from bg_width.

    All reads and writes happen under `_session_lock` so a concurrent mode-change
    or second select-bg can't observe stale state.

    Stale-width handling: sections are regenerated when the stored `bg_width`
    disagrees with the new `bg_width` (re-select of a different-width bg);
    otherwise existing geometry is preserved and normalized to xStart/xEnd.
    """
    if bg_width <= 0 or bg_height <= 0:
        raise ValueError(
            f"bg dimensions must be positive, got {bg_width}x{bg_height}"
        )

    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return
        fields: dict[str, Any] = {
            "selected_bg": bg_index,
            "bg_width": bg_width,
            "bg_height": bg_height,
        }
        if raw.get("mode") == "landscape":
            stored_width = raw.get("bg_width") or 0
            existing = raw.get("sections") or []
            # Regenerate when bg_width truly changed OR when there are no sections yet.
            # Keys off the stored bg_width (not the existing sections' xEnd) so
            needs_fresh = not existing or stored_width != bg_width
            if needs_fresh:
                fields["sections"] = section_ranges(bg_width)
            else:
                fields["sections"] = _camera_sections(existing)
        raw.update(fields)
        save_session(session_id, raw)
        return _selection_payload(raw)


def build_level_dict(
    session_id: str,
    hitboxes: list[dict],
    width: int,
    height: int,
    style: str | None = None,
    painted_indices: list[int] | None = None,
    sprite_metadata_by_index: dict[int, dict] | None = None,
) -> dict:
    """Canonical shape for the level.json payload, extracted to a single
    site so every writer (full inpaint finalise, recomposite finalise,
    magenta finalise, synthesise_level_json, export_to_game) agrees on
    field names, radius fallback, and dog-id formatting.

    Pre-extraction, five near-duplicate inline builders had silent drift:
    one used `hb["r"]` without fallback; another fell back to
    `hb.get("radius", 30)`; a third used `hb_entry["r"]` only. A new
    field would have needed five edits.

    Arguments
    ---------
    session_id
        Used for `id`, the `name` line, and the image-url roots.
    hitboxes
        Per-dog hitbox list. Each element MUST carry `x` and `y`, and
        SHOULD carry either `r` (canonical) or `radius` (legacy).
    width / height
        Final image dimensions (pixels).
    style
        Session's style slug for the human-readable `name`. Defaults to
        'unknown' when missing — matches prior ad-hoc callers.
    painted_indices
        Optional filter: if given, only hitboxes at these indices are
        included in the `dogs` array. Used by partial-export and
        synthesise_level_json paths that may ship a 9/10 subset.
    sprite_metadata_by_index
        Optional pickup sprite metadata keyed by original dog index.
        Present only for crop-inpainted dogs whose transparent sprite
        artifact exists on disk.
    """
    if painted_indices is not None:
        painted_set = set(painted_indices)
        selected = [(i, hb) for i, hb in enumerate(hitboxes) if i in painted_set]
    else:
        selected = list(enumerate(hitboxes))

    def dog_entry(i: int, hb: dict) -> dict:
        entry = {
            "id": f"dog_{i:02d}",
            "x": hb["x"],
            "y": hb["y"],
            "r": hb.get("r", hb.get("radius", 30)),
        }
        if sprite_metadata_by_index is not None and i in sprite_metadata_by_index:
            entry["sprite"] = sprite_metadata_by_index[i]
        return entry

    return {
        "id": session_id,
        "name": f"Level {session_id} ({style or 'unknown'})",
        "width": width,
        "height": height,
        "bwImage": f"levels/{session_id}/bw.png",
        "colorImage": f"levels/{session_id}/color.png",
        "dogs": [dog_entry(i, hb) for i, hb in selected],
    }


def _section_for_x(sections: list[dict], x: float) -> dict:
    for sec in sections:
        if x >= sec["xStart"] and x < sec["xEnd"]:
            return sec
    return sections[-1]


def mobile_visibility_report(
    level_data: dict,
    viewports: list[dict] | None = None,
    near_margin: int = 0,
) -> dict:
    """Check hitboxes against the mobile runtime camera math.

    Builder safe zones are image-space heuristics. The game runtime
    cover-scales the image to each device viewport, so narrow/tall phones can
    crop more than the reference canvas. Sectioned landscape levels additionally
    anchor each camera view at section.xStart and show one phone-width slice.
    """
    width = int(level_data.get("width") or 0)
    height = int(level_data.get("height") or 0)
    dogs = level_data.get("dogs") or []
    sections = level_data.get("sections") or []
    viewports = viewports or MOBILE_VISIBILITY_VIEWPORTS
    issues: list[dict] = []

    if width <= 0 or height <= 0:
        return {"ok": False, "issues": [{"error": "missing level dimensions"}], "viewports": viewports}

    for dog in dogs:
        x = float(dog["x"])
        y = float(dog["y"])
        r = float(dog.get("r", dog.get("radius", 30)))
        dog_id = dog.get("id")
        for vp in viewports:
            vw = float(vp["width"])
            vh = float(vp["height"])
            scale = max(vw / width, vh / height)
            if sections:
                sec = _section_for_x(sections, x)
                screen_x = x * scale - float(sec["xStart"]) * scale
                screen_y = (vh - height * scale) / 2 + y * scale
            else:
                screen_x = (vw - width * scale) / 2 + x * scale
                screen_y = (vh - height * scale) / 2 + y * scale
            screen_r = r * scale

            left = screen_x - screen_r
            right = screen_x + screen_r
            top = screen_y - screen_r
            bottom = screen_y + screen_r
            bounds = {
                "left": round(left, 1),
                "right": round(right, 1),
                "top": round(top, 1),
                "bottom": round(bottom, 1),
                "width": int(vw),
                "height": int(vh),
            }
            screen = {
                "x": round(screen_x, 1),
                "y": round(screen_y, 1),
                "r": round(screen_r, 1),
            }
            if left < 0 or right > vw or top < 0 or bottom > vh:
                issues.append({
                    "type": "clipped",
                    "dogId": dog_id,
                    "viewport": vp["name"],
                    "screen": screen,
                    "bounds": bounds,
                })
            elif near_margin > 0 and (
                left < near_margin
                or right > vw - near_margin
                or top < near_margin
                or bottom > vh - near_margin
            ):
                issues.append({
                    "type": "near_border",
                    "dogId": dog_id,
                    "viewport": vp["name"],
                    "screen": screen,
                    "bounds": bounds,
                })

            # HUD/banner fractions and the section safe-margin are single-sourced
            # from dog_pipeline.sections (plan -004 U1) so the publish gate, the
            # auto-placer, and the canvas can't drift on the same constants.
            blocked = [
                ("HUD", 0.0, 0.0, vw, vh * _SECTIONS_HUD_FRACTION),
                ("AD", 0.0, vh - vh * _SECTIONS_BANNER_FRACTION, vw, vh * _SECTIONS_BANNER_FRACTION),
            ]
            if sections:
                safe_x = vw * _SECTIONS_VIEWPORT_SAFE_FRACTION
                blocked.extend([
                    ("SAFE_L", 0.0, 0.0, safe_x, vh),
                    ("SAFE_R", vw - safe_x, 0.0, safe_x, vh),
                ])
            # Square continuous levels pan across their overflow AND pinch-zoom
            # (GameScene: "let the player pan across any overflow at minimum
            # zoom"; PinchZoom to 2.5x) — every bird can be brought into the
            # unobscured band, so HUD/AD overlap is never publish-blocking for
            # them. Portrait and sectioned levels retain the strict
            # fixed-camera gate. (2026-08-06: replaced the old limited
            # safe-area-travel model, which still blocked the canonical
            # square lineup.)
            square_pannable = (
                not sections and height > 0 and 0.95 <= width / height <= 1.05
            )
            for label, bx, by, bw, bh in blocked:
                if label in ("HUD", "AD") and square_pannable:
                    continue
                if right > bx and left < bx + bw and bottom > by and top < by + bh:
                    issues.append({
                        "type": "blocked_area",
                        "area": label,
                        "dogId": dog_id,
                        "viewport": vp["name"],
                        "screen": screen,
                        "bounds": bounds,
                    })

    return {"ok": len(issues) == 0, "issues": issues, "viewports": viewports, "nearMargin": near_margin}


def blocking_visibility_issues(report: dict) -> list[dict]:
    """Filter a mobile_visibility_report down to publish-blocking issues.

    Only `blocked_area` blocks a publish — a dog overlapping the HUD/ad band (or
    section safe-margins) is unplayable. `clipped` / `near_border` are advisory
    warnings the operator may accept. This mirrors the client's
    visibilityWarnings.blockingVisibilityIssues filter so server and UI agree on
    exactly what blocks.
    """
    return [issue for issue in report.get("issues", []) if issue.get("type") == "blocked_area"]


def synthesise_level_json(session_id: str) -> None:
    """Write level.json from current session state WITHOUT re-pasting pixels.

    Partial-inpaint sessions that predated the finalise-on-recomposite
    change have color.png on disk but no level.json. Calling
    recomposite_color to create it would re-paste every variant through
    compose_with_mask — and any legacy variant saved before the crop-box
    sidecar (commit 87de4d83) would paste at a different position because
    size-based padding inference shifts edge-clipped crops. That produced
    the 'export shifted my crop' bug.

    This function only writes the metadata file. Pixels on disk (color.png,
    bw.png, eval.png if present) are untouched — the preview the user
    already approved ships verbatim.
    """
    sdir = session_dir(session_id)
    raw = load_session_raw(session_id) or {}
    hb_path = sdir / "hitboxes.json"
    color_path = sdir / "color.png"
    if not hb_path.exists() or not color_path.exists():
        return
    try:
        hitbox_list = json.loads(hb_path.read_text())
    except (OSError, json.JSONDecodeError):
        return
    if not hitbox_list:
        return
    target_map = active_dog_variant_targets(session_id, raw.get("dogs", []), hitbox_list)
    if target_map:
        painted = [(i, hb) for i, hb in enumerate(hitbox_list) if i in target_map]
    else:
        dogs_meta = {d["index"]: d for d in raw.get("dogs", []) if isinstance(d, dict)}
        painted = [
            (i, hb) for i, hb in enumerate(hitbox_list)
            if is_painted_dog_meta(dogs_meta.get(i))
        ]
    if not painted:
        return
    from PIL import Image as _I
    with _I.open(color_path) as im:
        w_img, h_img = im.size
    level_data = build_level_dict(
        session_id,
        hitbox_list,
        width=w_img,
        height=h_img,
        style=raw.get("style"),
        painted_indices=[i for i, _ in painted],
        sprite_metadata_by_index=active_sprite_metadata_map(session_id, raw.get("dogs", []), hitbox_list),
    )
    path = sdir / "level.json"
    tmp = path.with_suffix(f".json.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    try:
        tmp.write_text(json.dumps(level_data, indent=2))
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _load_hitboxes_raw(sdir: Path) -> list:
    """Read the current hitboxes.json array (or [] if absent/unreadable).

    Used by save_hitboxes to recover existing stable ids for id-less incoming
    hitboxes (reconcile-by-id, spec -004 §6.3). The read is a best-effort
    OPTIMISATION — its failure must never abort the save it precedes, so a
    missing or corrupt prior file degrades to [] (mint fresh) rather than
    raising; the authoritative new array is written regardless.
    """
    path = sdir / "hitboxes.json"
    if not path.exists():
        return []
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


COMPARISON_INPUT_FILES = ("hitboxes.json",)


def clone_session_for_comparison(session_id: str, mode: str) -> str:
    """Clone a session's INPUTS (backgrounds + hitboxes + recipe metadata)
    into `<sid>__cmp_<mode>` so an inpaint approach can run isolated — outputs
    (dogs/, color.png, level.json) are never cloned, and re-cloning the same
    mode replaces the previous comparison run wholesale."""
    _validate_session_id_or_raise(session_id)
    sdir = session_dir(session_id)
    raw = load_session_raw(session_id)
    if raw is None:
        raise LevelNotReadyError(f"session {session_id} not found")
    clone_id = f"{session_id}__cmp_{mode}"
    clone_dir = LEVELS_DIR / clone_id
    if clone_dir.exists():
        shutil.rmtree(clone_dir)
    clone_dir.mkdir(parents=True)
    for bg in sorted(sdir.glob("bg_*.png")):
        shutil.copy2(bg, clone_dir / bg.name)
    for name in COMPARISON_INPUT_FILES:
        src = sdir / name
        if src.exists():
            shutil.copy2(src, clone_dir / name)
    clone_raw = dict(raw)
    clone_raw["dogs"] = []
    clone_raw.pop("inpaint_mode", None)
    clone_raw["comparison_of"] = session_id
    clone_raw["comparison_mode"] = mode
    with open(clone_dir / "session.json", "w") as f:
        json.dump(clone_raw, f, indent=2)
    return clone_id


def recenter_hitboxes_to_sprites(
    session_id: str,
    *,
    max_offset_fraction: float = 0.5,
) -> dict:
    """Recenter hitboxes onto their active sprite's visible bbox center.

    The inpainted animal often sits off the requested center; a tap point
    outside (or on the fringe of) the visible sprite is a guaranteed player
    miss even when it satisfies the looser cleanup-box gate. Policy: move a
    hitbox to the sprite bbox center when the current center is outside the
    bbox OR farther than `max_offset_fraction * r` from it. Fork addition
    (2026-07-29) — the pilot audit found 9/40 birds beyond this threshold.
    """
    _validate_session_id_or_raise(session_id)
    sdir = session_dir(session_id)
    hb_path = sdir / "hitboxes.json"
    if not hb_path.exists():
        raise LevelNotReadyError("missing hitboxes.json")
    with open(hb_path) as f:
        hitboxes = json.load(f)
    raw = load_session_raw(session_id) or {}
    moved: list[dict] = []
    # Resolve sprites by DOG index, not through the hitbox target map: a hitbox
    # that drifted far enough to stop rebinding is exactly the one that most
    # needs recentering, and going through the target map silently skipped it.
    for dog in raw.get("dogs") or []:
        if not isinstance(dog, dict) or not is_painted_dog_meta(dog):
            continue
        index = dog.get("index")
        variant = dog.get("activeVariant")
        if not isinstance(index, int) or not isinstance(variant, int):
            continue
        if index >= len(hitboxes):
            continue
        sprite = _level_sprite_metadata(session_id, index, variant)
        if sprite is None:
            continue
        hb = hitboxes[index]
        cx = sprite["x"] + sprite["width"] / 2
        cy = sprite["y"] + sprite["height"] / 2
        inside = (
            sprite["x"] <= hb["x"] <= sprite["x"] + sprite["width"]
            and sprite["y"] <= hb["y"] <= sprite["y"] + sprite["height"]
        )
        radius = hb.get("r", hb.get("radius", 30))
        distance = ((hb["x"] - cx) ** 2 + (hb["y"] - cy) ** 2) ** 0.5
        if not inside or distance > radius * max_offset_fraction:
            entry = {
                "index": index,
                "from": [hb["x"], hb["y"]],
                "to": [int(cx), int(cy)],
                "distance": round(distance, 1),
            }
            # A recenter is tap-accurate but useless if the bird itself sits in
            # the band that cover-scaling crops on the narrowest phones. Flag
            # it so callers surface the risk instead of shipping blind.
            from levelbuilder.sections import (
                PORTRAIT_REF_WIDTH as _REF_W,
                PORTRAIT_REFERENCE_DEADZONES as _REF_DZ,
            )
            raw_meta = raw if isinstance(raw, dict) else {}
            level_width = int(raw_meta.get("bg_width") or _REF_W)
            crop_band = next((w for (label, _x, _y, w, _h) in _REF_DZ if label == "CROP_L"), 90)
            band = crop_band * level_width / _REF_W
            if cx < band or cx > level_width - band:
                entry["cropRisk"] = True
            moved.append(entry)
            hb["x"], hb["y"] = int(cx), int(cy)
    if moved:
        save_hitboxes(session_id, hitboxes)
        _refresh_eval_overlay(session_id, hitboxes)
    return {"sessionId": session_id, "moved": moved, "total": len(hitboxes)}


def _refresh_eval_overlay(session_id: str, hitboxes: list[dict]) -> None:
    """Keep the review overlay synchronized with authoritative hitboxes."""
    sdir = session_dir(session_id)
    color_path = sdir / "color.png"
    if not color_path.exists():
        return
    from levelbuilder.api.inpaint import Hitbox, evaluate_hitboxes

    with Image.open(color_path) as source:
        source.load()
        evaluated = evaluate_hitboxes(
            source.convert("RGB"),
            [
                Hitbox(
                    x=int(hitbox["x"]),
                    y=int(hitbox["y"]),
                    radius=int(hitbox.get("r", hitbox.get("radius", 30))),
                )
                for hitbox in hitboxes
            ],
            opacity=0.3,
        )
    temp = (sdir / "eval.png").with_suffix(".png.tmp")
    evaluated.save(temp, format="PNG")
    evaluated.close()
    os.replace(temp, sdir / "eval.png")


def reconcile_magenta_hitboxes_to_detections(
    session_id: str,
    *,
    detections: list[dict],
    minimum_confidence: float = 0.5,
) -> dict:
    """Recenter whole-image magenta hitboxes onto recognized subject bounds.

    Magenta mode has no isolated sprite metadata, so the crop-mode recenter
    cannot operate. Recognition remains an explicit input; this function owns
    only deterministic validation, one-to-one assignment, stable-id
    preservation, and persistence. It fails closed unless recognition returns
    exactly one usable detection per existing hitbox.
    """
    from scipy.optimize import linear_sum_assignment

    _validate_session_id_or_raise(session_id)
    sdir = session_dir(session_id)
    hitboxes = _load_hitboxes_raw(sdir)
    if not hitboxes:
        raise LevelNotReadyError("missing hitboxes.json")

    normalized: list[dict] = []
    for index, detection in enumerate(detections):
        if not isinstance(detection, dict):
            raise LevelNotReadyError(f"detection {index} must be an object")
        try:
            x = float(detection["x"])
            y = float(detection["y"])
            width = float(detection["width"])
            height = float(detection["height"])
            confidence = float(detection.get("confidence", 1.0))
        except (KeyError, TypeError, ValueError) as error:
            raise LevelNotReadyError(
                f"detection {index} needs numeric x, y, width, and height"
            ) from error
        if width <= 0 or height <= 0:
            raise LevelNotReadyError(f"detection {index} dimensions must be positive")
        if confidence < minimum_confidence:
            continue
        normalized.append({
            "index": index,
            "cx": x + width / 2,
            "cy": y + height / 2,
            "width": width,
            "height": height,
            "confidence": confidence,
        })
    if len(normalized) != len(hitboxes):
        raise LevelNotReadyError(
            f"recognition must provide exactly {len(hitboxes)} usable detections; "
            f"got {len(normalized)}"
        )

    costs = [
        [
            (float(hitbox["x"]) - detection["cx"]) ** 2
            + (float(hitbox["y"]) - detection["cy"]) ** 2
            for detection in normalized
        ]
        for hitbox in hitboxes
    ]
    rows, columns = linear_sum_assignment(costs)
    reconciled = [dict(hitbox) for hitbox in hitboxes]
    moved: list[dict] = []
    for row, column in zip(rows.tolist(), columns.tolist(), strict=True):
        detection = normalized[column]
        hitbox = reconciled[row]
        old = [int(hitbox["x"]), int(hitbox["y"])]
        cx, cy = int(round(detection["cx"])), int(round(detection["cy"]))
        # Target the visible torso comfortably while retaining mobile tap
        # forgiveness. Bounds are deliberately conservative for 1K portrait.
        radius = int(round(max(detection["width"], detection["height"]) * 0.55))
        radius = max(22, min(64, radius))
        hitbox.update({"x": cx, "y": cy, "r": radius})
        moved.append({
            "hitboxIndex": row,
            "detectionIndex": detection["index"],
            "from": old,
            "to": [cx, cy],
            "radius": radius,
            "confidence": detection["confidence"],
        })

    persisted = save_hitboxes(session_id, reconciled) or reconciled
    _refresh_eval_overlay(session_id, persisted)
    level_path = sdir / "level.json"
    if level_path.exists():
        raw = load_session_raw(session_id) or {}
        width = int(raw.get("bg_width") or 768)
        height = int(raw.get("bg_height") or 1376)
        level_data = build_level_dict(
            session_id,
            persisted,
            width=width,
            height=height,
            style=raw.get("style"),
        )
        tmp = level_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(level_data, indent=2) + "\n")
        os.replace(tmp, level_path)
    return {
        "sessionId": session_id,
        "moved": moved,
        "total": len(persisted),
    }


def _neighbor_free_crop(
    color: "Image.Image",
    clean: "Image.Image | None",
    crop_box: tuple[int, int, int, int],
    detections: dict[int, dict],
    keep_index: int,
) -> "Image.Image":
    """Crop `color` to crop_box with every OTHER bird erased.

    Close birds leak into each other's cutout crops: the model then merges
    them, recreates both (duplicate-component gate -> billed retries), or
    bakes a neighbor fragment into the sprite that visibly vanishes when the
    neighbor is picked up. The clean background is pixel-aligned with the
    painted scene (the canonical square-send invariant), so pasting the
    clean pixels over each intersecting neighbor's padded box — with a
    feathered edge — deletes the neighbor without touching scenery.
    Falls back to a plain crop when no clean bg is available.
    """
    crop = color.crop(crop_box)
    if clean is None:
        return crop
    from PIL import ImageDraw, ImageFilter
    x0, y0, x1, y1 = crop_box
    mask = Image.new("L", crop.size, 0)
    draw = ImageDraw.Draw(mask)
    erased = 0
    for other_index, det in detections.items():
        if other_index == keep_index:
            continue
        pad = max(8, int(round(max(det["width"], det["height"]) * 0.15)))
        nx0 = det["x"] - pad - x0
        ny0 = det["y"] - pad - y0
        nx1 = det["x"] + det["width"] + pad - x0
        ny1 = det["y"] + det["height"] + pad - y0
        if nx1 <= 0 or ny1 <= 0 or nx0 >= crop.width or ny0 >= crop.height:
            continue
        draw.rectangle((nx0, ny0, nx1, ny1), fill=255)
        erased += 1
    if erased == 0:
        return crop
    # Dense clusters: a neighbor's padded box can overlap the KEPT bird's own
    # box — erasing there bites the subject and the model compensates with
    # multi-bird/prop sprites (observed on mushroom_cottage_glade, 18px
    # pairs, 2026-08-06 staged rollout). The kept bird's detection box is
    # sacrosanct: clear it from the mask after all neighbor rects.
    keep = detections.get(keep_index)
    if keep is not None:
        kx0 = keep["x"] - x0
        ky0 = keep["y"] - y0
        draw.rectangle(
            (kx0, ky0, kx0 + keep["width"], ky0 + keep["height"]), fill=0)
    feathered = mask.filter(ImageFilter.GaussianBlur(4))
    clean_crop = clean.crop(crop_box)
    if clean_crop.size != crop.size:
        clean_crop = clean_crop.resize(crop.size, Image.LANCZOS)
    crop.paste(clean_crop.convert("RGB"), (0, 0), feathered)
    return crop


def materialize_detection_sprites(
    session_id: str,
    *,
    detections: list[dict],
    minimum_confidence: float = 0.5,
    force: bool = False,
) -> dict:
    """Create pickup sprites for a reconciled whole-image generation.

    Recognition supplies tight bird bounds. Semantic foreground extraction is
    then constrained to each local bound, producing the same sprite metadata
    contract as crop-mode generation without weakening the export gate.
    """
    from scipy.optimize import linear_sum_assignment
    from levelbuilder.api import inpaint as _inpaint

    _validate_session_id_or_raise(session_id)
    try:
        require_hitboxes_blessed(session_id)
    except ValueError as error:
        raise LevelNotReadyError(str(error)) from error
    sdir = session_dir(session_id)
    color_path = sdir / "color.png"
    if not color_path.exists():
        raise LevelNotReadyError("missing color.png")
    hitboxes = _load_hitboxes_raw(sdir)
    if not hitboxes:
        raise LevelNotReadyError("missing hitboxes.json")

    usable: list[dict] = []
    for index, detection in enumerate(detections):
        try:
            x = int(round(float(detection["x"])))
            y = int(round(float(detection["y"])))
            width = int(round(float(detection["width"])))
            height = int(round(float(detection["height"])))
            confidence = float(detection.get("confidence", 1.0))
        except (KeyError, TypeError, ValueError) as error:
            raise LevelNotReadyError(f"invalid detection {index}") from error
        if width <= 0 or height <= 0:
            raise LevelNotReadyError(f"detection {index} dimensions must be positive")
        if confidence >= minimum_confidence:
            usable.append({
                "index": index,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "cx": x + width / 2,
                "cy": y + height / 2,
            })
    if len(usable) != len(hitboxes):
        raise LevelNotReadyError(
            f"sprite materialization needs exactly {len(hitboxes)} usable detections; "
            f"got {len(usable)}"
        )

    costs = [
        [
            (float(hitbox["x"]) - detection["cx"]) ** 2
            + (float(hitbox["y"]) - detection["cy"]) ** 2
            for detection in usable
        ]
        for hitbox in hitboxes
    ]
    rows, columns = linear_sum_assignment(costs)
    detection_by_hitbox = {
        row: usable[column]
        for row, column in zip(rows.tolist(), columns.tolist(), strict=True)
    }
    raw = load_session_raw(session_id) or {}
    existing_dogs = {
        dog.get("index"): dog
        for dog in raw.get("dogs") or []
        if isinstance(dog, dict) and isinstance(dog.get("index"), int)
    }
    materialized: list[dict] = []
    failed: list[dict] = []
    with Image.open(color_path) as source:
        color = source.convert("RGB")
    # Aligned clean bg for neighbor suppression in cutout crops. Missing bg
    # degrades to plain crops (older sessions), never blocks.
    clean_bg: Image.Image | None = None
    try:
        selected_bg = raw.get("selected_bg")
        if selected_bg is not None:
            bg_path = session_dir(session_id) / f"bg_{int(selected_bg):02d}.png"
            if bg_path.exists():
                with Image.open(bg_path) as _bg_src:
                    clean_bg = _bg_src.convert("RGB")
                if clean_bg.size != color.size:
                    clean_bg = clean_bg.resize(color.size, Image.LANCZOS)
    except (OSError, ValueError):
        clean_bg = None
    try:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        max_workers = max(1, int(os.environ.get("FTD_SPRITE_WORKERS", "5")))
        def _process_one(index: int, hitbox_data: dict):
            detection = detection_by_hitbox[index]
            padding = max(
                16,
                int(round(max(detection["width"], detection["height"]) * 0.35)),
            )
            box = (
                max(0, detection["x"] - padding),
                max(0, detection["y"] - padding),
                min(color.width, detection["x"] + detection["width"] + padding),
                min(color.height, detection["y"] + detection["height"] + padding),
            )
            painted = _neighbor_free_crop(
                color, clean_bg, box, detection_by_hitbox, index)
            hitbox = _inpaint.Hitbox(
                x=int(hitbox_data["x"]),
                y=int(hitbox_data["y"]),
                radius=int(hitbox_data.get("r", hitbox_data.get("radius", 30))),
            )
            # Primary: the map #14 winning technique — LLM flat-key recreate
            # (paid, ~$0.01-0.07/bird, metered). The free chain remains as
            # fallback; SAM2-remote retired in favor of SAM3 (tracked issue).
            # Recreated sprite comes from the 3x3 batched flat-key pass run
            # before this pool (see prebatched above) — one grid call covers
            # nine birds; the ladder already retried failures at 2x2 and
            # single. Missing key -> free extractor chain below.
            sprite_rgba = prebatched.pop(index, None)
            if sprite_rgba is not None:
                # Fit the recreated sprite into the detection box (centered-x,
                # bottom-anchored — same contract as the shipped corpus lane),
                # and synthesize the alpha at crop scale for the metadata path.
                target_w = max(1, detection["width"])
                target_h = max(1, detection["height"])
                scale = min(target_w / sprite_rgba.width, target_h / sprite_rgba.height, 1.0)
                if scale < 1.0:
                    sprite_rgba = sprite_rgba.resize(
                        (max(1, int(sprite_rgba.width * scale)), max(1, int(sprite_rgba.height * scale))),
                        Image.LANCZOS,
                    )
                alpha = Image.new("L", painted.size, 0)
                off_x = max(0, (detection["x"] - box[0]) + (target_w - sprite_rgba.width) // 2)
                off_y = max(0, (detection["y"] - box[1]) + (target_h - sprite_rgba.height))
                alpha.paste(sprite_rgba.getchannel("A"), (off_x, off_y))
                # The sprite pixels must be the RECREATED bird, not scene
                # pixels under its silhouette — composite it into the crop so
                # the masked sprite equals the flat-key output exactly.
                painted.paste(sprite_rgba.convert("RGB"), (off_x, off_y), sprite_rgba.getchannel("A"))
                sprite_rgba.close()
            else:
                alpha = _inpaint._semantic_sprite_alpha(
                    None, painted, hitbox, box, relaxed=True
                )
            if alpha is None:
                alpha = _inpaint._sam_sprite_alpha(
                    painted, hitbox, box, relaxed=True
                )
            if alpha is None:
                alpha = _inpaint._sam2_sprite_alpha(
                    painted, hitbox, box, relaxed=True
                )
            if alpha is None:
                painted.close()
                return ("failed", {
                    "index": index,
                    "detectionIndex": detection["index"],
                    "reason": "extraction_failed",
                })
            dog_dir = dogs_dir(session_id) / f"dog_{index:02d}"
            dog_dir.mkdir(parents=True, exist_ok=True)
            variant_path = dog_dir / "variant_000.png"
            painted.save(variant_path)
            _inpaint._save_variant_box(variant_path, box)
            metadata = _inpaint._save_sprite_assets(
                dog_dir=dog_dir,
                variant_idx=0,
                painted=painted,
                dog_mask=alpha,
                hitbox=hitbox,
                box=box,
                model=raw.get("inpaint_model"),
                prevalidated=True,
            )
            alpha.close()
            painted.close()
            if metadata is None:
                return ("failed", {
                    "index": index,
                    "detectionIndex": detection["index"],
                    "reason": "validation_failed",
                })
            return ("ok", {
                "index": index,
                "detectionIndex": detection["index"],
                "spriteBox": metadata["spriteBox"],
            })

        pending = []
        for index, hitbox_data in enumerate(hitboxes):
            meta_path = dogs_dir(session_id) / f"dog_{index:02d}" / "sprite_000.json"
            if meta_path.exists() and not force and not os.environ.get("FTD_SPRITE_FORCE"):
                try:
                    if json.loads(meta_path.read_text()).get("technique") == "flatkey-recreate-v1":
                        materialized.append({
                            "index": index,
                            "detectionIndex": detection_by_hitbox[index]["index"],
                            "spriteBox": json.loads(meta_path.read_text()).get("spriteBox"),
                            "skipped": True,
                        })
                        continue
                except (OSError, ValueError):
                    pass
            pending.append((index, hitbox_data))
        # Batched flat-key recreate (2x2 default after the controlled 112-bird
        # human review on 2026-08-10): all pending
        # birds' crops go through grid calls FIRST ($0.0045/bird vs $0.034
        # single, quality-matched on the native2k eval; ladder falls back to
        # 2x2 then single per failed panel). _process_one consumes the
        # precomputed sprite and keeps its free-extractor fallback chain.
        prebatched: dict[int, Image.Image] = {}
        if not os.environ.get("FTD_DISABLE_FLATKEY_SPRITES"):
            from levelbuilder.api.flatkey import flatkey_recreate_sprites_batch
            flatkey_model = os.environ.get(
                "FTD_FLATKEY_MODEL", "google/gemini-3.1-flash-image-preview"
            )
            grid_n = max(1, int(os.environ.get("FTD_FLATKEY_GRID", str(DEFAULT_FLATKEY_GRID))))
            entity = str(raw.get("entity") or "bird")
            batch_crops: dict[int, Image.Image] = {}
            # Small detections are grid-poisonous: thumbnailed into a 3x3
            # cell they become illegible and the model recreates the most
            # salient PROP instead of the bird (observed 2026-08-06: a
            # backpack-without-bird sprite from a 90px detection). Below this
            # threshold the bird takes the single-call path, whose judge
            # gate rejects non-birds.
            SMALL_DETECTION_PX = 110
            for index, hitbox_data in pending:
                detection = detection_by_hitbox[index]
                if max(detection["width"], detection["height"]) < SMALL_DETECTION_PX:
                    continue  # -> free extractor chain in _process_one
                padding = max(16, int(round(max(detection["width"], detection["height"]) * 0.35)))
                box = (
                    max(0, detection["x"] - padding),
                    max(0, detection["y"] - padding),
                    min(color.width, detection["x"] + detection["width"] + padding),
                    min(color.height, detection["y"] + detection["height"] + padding),
                )
                batch_crops[index] = _neighbor_free_crop(
                    color, clean_bg, box, detection_by_hitbox, index)
            # Small detections (<110px) NEVER go through recreate — neither
            # grid nor single. Grid cells render them illegibly and the model
            # recreates props; the single path's judge fails OPEN when codex
            # is unavailable, so prop sprites still leaked (measured
            # 2026-08-06, two failed fixes). The free extractor chain cuts
            # the ACTUAL painted pixels instead — the subject is guaranteed
            # because the diff region IS the painted bird. Distant small
            # birds don't need sticker-clean recreates.
            if batch_crops:
                if grid_n >= 2:
                    # Fail-soft like the old per-dog path: a provider outage
                    # degrades to the free extractor chain, never an abort.
                    try:
                        prebatched = flatkey_recreate_sprites_batch(
                            batch_crops, model=flatkey_model, grid=grid_n,
                            entity=entity,
                        )
                    except Exception as exc:
                        prebatched = {}
                        logger.warning(
                            "flatkey batch degraded to free extractor for ALL %d birds: %s",
                            len(batch_crops), exc)
                else:  # FTD_FLATKEY_GRID=1: force the single-call path
                    from levelbuilder.api.flatkey import flatkey_recreate_sprite
                    for index, crop in batch_crops.items():
                        try:
                            single = flatkey_recreate_sprite(crop, model=flatkey_model, entity=entity)
                        except Exception:
                            single = None
                        if single is not None:
                            prebatched[index] = single
        flatkey_count = len(prebatched)
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [pool.submit(_process_one, idx, hb) for idx, hb in pending]
            for fut in as_completed(futures):
                kind, payload = fut.result()
                (materialized if kind == "ok" else failed).append(payload)
    finally:
        color.close()
        if clean_bg is not None:
            clean_bg.close()

    succeeded_indices = {entry["index"] for entry in materialized}
    dogs = []
    for index, hitbox in enumerate(hitboxes):
        existing = existing_dogs.get(index) or {}
        dogs.append({
            **existing,
            "index": index,
            "id": hitbox.get("id") or existing.get("id") or f"dog_{index:02d}",
            "status": "done" if index in succeeded_indices else "failed",
            "activeVariant": 0 if index in succeeded_indices else existing.get("activeVariant"),
            "promptOverride": existing.get("promptOverride"),
        })
    raw["dogs"] = dogs
    save_session(session_id, raw)
    sync_active_sprite_set_to_levels(session_id, dogs, hitboxes)
    return {
        "sessionId": session_id,
        "materialized": len(materialized),
        "sprites": materialized,
        "failed": failed,
        # Fail-LOUD accounting (2026-08-06): a dying provider key degraded
        # batches to the free extractor while every level still printed OK.
        # Drivers must check flatkeyCount vs pendingCount, not exit codes.
        "pendingCount": len(pending),
        "flatkeyCount": flatkey_count,
        "degradedToFreeChain": max(0, len(pending) - flatkey_count),
    }


def sync_active_sprite_set_to_levels(
    session_id: str,
    dogs: list[dict],
    hitboxes: list[dict],
) -> None:
    """Rebuild level birds from current hitboxes and active sprite sidecars."""
    sprite_metadata = active_sprite_metadata_map(session_id, dogs, hitboxes)
    public_root = GAME_PUBLIC_LEVELS / session_id
    if (public_root / "level.json").is_file():
        for dog in dogs:
            index = dog.get("index") if isinstance(dog, dict) else None
            variant = dog.get("activeVariant") if isinstance(dog, dict) else None
            if not isinstance(index, int) or not isinstance(variant, int):
                continue
            source_dir = dogs_dir(session_id) / f"dog_{index:02d}"
            target_dir = public_root / "dogs" / f"dog_{index:02d}"
            target_dir.mkdir(parents=True, exist_ok=True)
            for source in (
                source_dir / f"sprite_{variant:03d}.png",
                source_dir / f"sprite_mask_{variant:03d}.png",
                source_dir / f"sprite_{variant:03d}.json",
                source_dir / f"variant_{variant:03d}.png",
                source_dir / f"variant_{variant:03d}.box.json",
            ):
                if source.is_file():
                    shutil.copy2(source, target_dir / source.name)
    for root in (session_dir(session_id), GAME_PUBLIC_LEVELS / session_id):
        level_path = root / "level.json"
        if not level_path.is_file():
            continue
        level = json.loads(level_path.read_text())
        level["dogs"] = [
            {
                "id": f"dog_{index:02d}",
                "x": hitbox["x"],
                "y": hitbox["y"],
                "r": hitbox.get("r", hitbox.get("radius", 30)),
                **({"difficulty": "hard"} if str(hitbox.get("difficulty") or "").lower() == "hard" else {}),
                **({"sprite": sprite_metadata[index]} if index in sprite_metadata else {}),
            }
            for index, hitbox in enumerate(hitboxes)
        ]
        temporary = level_path.with_suffix(level_path.suffix + ".tmp")
        temporary.write_text(json.dumps(level, indent=2) + "\n")
        temporary.replace(level_path)


def sync_sprite_metadata_to_levels(
    session_id: str,
    dog_index: int,
    variant_index: int,
    metadata: dict[str, Any],
) -> None:
    """Keep authoring and exported level geometry aligned with a sprite sidecar."""
    box = metadata.get("spriteBox")
    if not (isinstance(box, list) and len(box) == 4):
        return
    cleanup = metadata.get("cleanupBox") or box
    if not (isinstance(cleanup, list) and len(cleanup) == 4):
        cleanup = box
    x0, y0, x1, y1 = [int(value) for value in box]
    cx0, cy0, cx1, cy1 = [int(value) for value in cleanup]
    raw = load_session_raw(session_id) or {}
    stable_id = next((
        dog.get("id")
        for dog in raw.get("dogs") or []
        if isinstance(dog, dict) and dog.get("index") == dog_index
    ), None)
    for root in (session_dir(session_id), GAME_PUBLIC_LEVELS / session_id):
        level_path = root / "level.json"
        if not level_path.is_file():
            continue
        level = json.loads(level_path.read_text())
        level_dogs = level.get("dogs") or []
        level_dog = next((
            dog for dog in level_dogs
            if isinstance(dog, dict) and stable_id is not None and dog.get("id") == stable_id
        ), None)
        if level_dog is None and 0 <= dog_index < len(level_dogs):
            level_dog = level_dogs[dog_index]
        if not isinstance(level_dog, dict):
            continue
        level_dog["sprite"] = {
            **(level_dog.get("sprite") or {}),
            "image": f"levels/{session_id}/dogs/dog_{dog_index:02d}/sprite_{variant_index:03d}.png",
            "x": x0,
            "y": y0,
            "width": x1 - x0,
            "height": y1 - y0,
            "anchorX": float(metadata.get("anchorX", 0.5)),
            "anchorY": float(metadata.get("anchorY", 0.5)),
            "cleanup": {
                "x": cx0,
                "y": cy0,
                "width": cx1 - cx0,
                "height": cy1 - cy0,
            },
        }
        temporary = level_path.with_suffix(level_path.suffix + ".tmp")
        temporary.write_text(json.dumps(level, indent=2) + "\n")
        temporary.replace(level_path)


def finalize_one_shot_from_detections(
    session_id: str,
    *,
    detections: list[dict],
    minimum_confidence: float = 0.5,
) -> dict:
    """Turn a one-shot background containing birds into a playable level."""
    _validate_session_id_or_raise(session_id)
    raw = load_session_raw(session_id)
    if raw is None:
        raise LevelNotReadyError(f"session {session_id} not found")
    context = raw.get("prompt_context") or {}
    if not context.get("oneShot"):
        raise LevelNotReadyError("session was not created as one-shot")
    expected = int(context.get("oneShotCount") or raw.get("n_dogs") or 0)
    usable = []
    for index, detection in enumerate(detections):
        try:
            x = float(detection["x"])
            y = float(detection["y"])
            width = float(detection["width"])
            height = float(detection["height"])
            confidence = float(detection.get("confidence", 1.0))
        except (KeyError, TypeError, ValueError) as error:
            raise LevelNotReadyError(f"invalid detection {index}") from error
        if width <= 0 or height <= 0:
            raise LevelNotReadyError(f"detection {index} dimensions must be positive")
        if confidence >= minimum_confidence:
            usable.append((x, y, width, height))
    if len(usable) != expected:
        raise LevelNotReadyError(
            f"one-shot recognition must find exactly {expected} birds; got {len(usable)}"
        )
    selected = raw.get("selected_bg")
    if selected is None:
        raise LevelNotReadyError("No background selected")
    sdir = session_dir(session_id)
    background = sdir / f"bg_{int(selected):02d}.png"
    if not background.exists():
        raise LevelNotReadyError("Background file not found")
    hitboxes = []
    for x, y, width, height in usable:
        radius = max(22, min(64, int(round(max(width, height) * 0.55))))
        hitboxes.append({
            "x": int(round(x + width / 2)),
            "y": int(round(y + height / 2)),
            "r": radius,
        })
    persisted = save_hitboxes(session_id, hitboxes) or hitboxes
    shutil.copy2(background, sdir / "color.png")
    shutil.copy2(background, sdir / "inpainted.png")
    with Image.open(background) as image:
        width, height = image.size
        level_data = build_level_dict(
            session_id,
            persisted,
            width=width,
            height=height,
            style=raw.get("style"),
        )
    (sdir / "level.json").write_text(json.dumps(level_data, indent=2) + "\n")
    update_session_field(session_id, inpaint_mode="one_shot")
    return {"sessionId": session_id, "hitboxes": len(persisted), "colorFile": "color.png"}


def save_hitboxes(session_id: str, hitboxes: list[dict]) -> list[dict] | None:
    """Save hitboxes to the current hitboxes.json (authoritative). Returns the
    id-stamped persisted list (None if a public-package no-op).
    Atomic: tmp + os.replace so a SIGKILL mid-write can't truncate.

    The tmp suffix includes pid + a uuid fragment so concurrent callers
    don't collide on the same tmp name. The wizard debounces hitbox
    saves and the inpaint path also saves — overlapping requests on the
    same session were racing and one would hit FileNotFoundError when
    its tmp was moved mid-flight by the other's os.replace.
    """
    if is_public_package_only(session_id):
        return
    sdir = session_dir(session_id)
    # Stable-id reconcile (A1 mint + B2 Slice-1 reconcile-by-id, spec -004 §6.3).
    # Three cases per incoming hitbox, NONE of which re-stamp an existing identity:
    #   1. carries an id  -> preserved BY VALUE (client-minted uuid or backfilled).
    #   2. id-less but a prior on-disk hitbox occupies the same slot -> RECOVER
    #      that slot's id. A move/save keeps slot order, so this makes the
    #      "move dog 7, dog 8 byte-identical" guarantee hold at the PERSISTENCE
    #      layer even if the client didn't echo the id back — the server, not the
    #      client, owns the on-disk identity (spec §6.1).
    #   3. genuinely new id-less slot (e.g. an appended placement past the end of
    #      the prior array) -> mint the canonical positional id.
    # Reorder/delete identity-safety (id-based matching across a CHANGED array)
    # is Slice 4 — it needs the dog-folder decoupling (spec §6.1). Slice 1 ships
    # place/move/add only, where slot order is preserved.
    # Build a NEW list; never mutate the caller's dicts in place (the crop-inpaint
    # path reuses the same objects for its idempotency key — an in-place id
    # mutation would change that key between submissions).
    # Hold _session_lock around the whole read-modify-write (review P1 #6): the
    # reconcile reads the prior hitboxes.json then os.replaces it; a concurrent
    # delete_dog_by_id (which writes hitboxes.json under the same lock) would
    # otherwise last-writer-win and resurrect/lose entries. All save_hitboxes
    # callers are lock-free (routes + inpaint), so a non-reentrant Lock is safe.
    with _session_lock:
        existing = _load_hitboxes_raw(sdir)
        # Drop any hitbox whose id was DELETED (tombstoned by delete_dog_by_id): a
        # late/in-flight full-array POST from before the delete still carries it, and
        # writing it back would resurrect a half-orphan (final-rereview iter5 P1).
        # Filter UP FRONT (not inside the loop) so the reconcile's positional index
        # stays aligned with `existing` for the id-less case-2 recovery below.
        _tombstoned = set((load_session_raw(session_id) or {}).get("deleted_dog_ids") or [])
        if _tombstoned:
            hitboxes = [h for h in hitboxes if not (isinstance(h, dict) and h.get("id") in _tombstoned)]
        persisted: list = []
        # Ids already carried BY VALUE in this batch: positional recovery must
        # never duplicate one of these. After a delete shifts slots, the prior
        # occupant of slot i can be a hitbox that still exists elsewhere in the
        # incoming array — recovering its id minted duplicates (observed
        # 2026-08-04: review-modal add-after-delete collapsed 4 dogs onto one
        # id and export shipped 8/17 birds).
        carried_ids = {
            h.get("id") for h in hitboxes if isinstance(h, dict) and h.get("id")
        }
        assigned_ids: set = set()
        for index, hitbox in enumerate(hitboxes):
            if not isinstance(hitbox, dict) or hitbox.get("id"):
                persisted.append(hitbox)
                continue
            prior = existing[index] if index < len(existing) else None
            recovered = prior.get("id") if isinstance(prior, dict) else None
            if recovered and (recovered in carried_ids or recovered in assigned_ids):
                recovered = None
            if recovered:
                new_id = recovered  # case 2: the prior slot's id (a move preserves identity)
                assigned_ids.add(new_id)
            else:
                # case 3: genuinely new id-less slot. The canonical positional mint
                # can ALIAS a survivor's id after a tombstone gap (review P1 #8 —
                # EMPIRICALLY a duplicate id collapsing two dogs). Guard against any
                # id already present (incoming-so-far OR prior on-disk); on collision
                # fall back to a random uuid4 so an append can't collide with a
                # survivor. No collision -> the deterministic mint (A1 parity holds).
                new_id = _mint_dog_id(session_id, index)
                seen_ids = {h["id"] for h in persisted if isinstance(h, dict) and h.get("id")}
                seen_ids |= {h["id"] for h in existing if isinstance(h, dict) and h.get("id")}
                # Tombstoned ids are TAKEN too: the mint is deterministic uuid5 over
                # (session, slot), so deleting the dog at the last slot and placing a
                # new one re-mints the dead dog's exact id — which the up-front
                # tombstone filter then silently drops on the NEXT save, losing the
                # operator's new dog (ledger 054 #10). Collision -> random uuid4.
                seen_ids |= _tombstoned
                if new_id in seen_ids:
                    new_id = str(uuid.uuid4())
            persisted.append({**hitbox, "id": new_id})
        path = sdir / "hitboxes.json"
        tmp = path.with_suffix(f".json.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
        try:
            with open(tmp, "w") as f:
                json.dump(persisted, f, indent=2)
            os.replace(tmp, path)
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass
        existing_digest = _semantic_json_sha256(existing)
        persisted_digest = _semantic_json_sha256(persisted)
        if existing_digest != persisted_digest:
            _write_review_file(session_id, "hitbox-review.json", {
                "schemaVersion": 1,
                "reviewStage": "hitboxes",
                "approved": False,
                "blessed": False,
                "blessingMeaning": "current hitbox geometry is human-reviewed",
                "reviewedAt": None,
                "source": "hitbox-change",
                "hitboxesSha256": persisted_digest,
                "hitboxCount": len(persisted),
            })
    # Return the id-STAMPED list so a caller that needs the on-disk identities
    # (the magenta path -> _mark_session_dogs_done) doesn't re-derive them from the
    # still-id-less in-memory input (final-rereview iter3 P1: that minted a
    # divergent dog id -> by-id routes 404).
    return persisted


def get_next_variant_index(session_id: str, dog_index: int) -> int:
    """Get the next available variant index for a dog by scanning its directory.

    Must be called while holding _session_lock for atomicity.
    """
    dog_path = dogs_dir(session_id) / f"dog_{dog_index:02d}"
    dog_path.mkdir(parents=True, exist_ok=True)
    existing = [f for f in dog_path.iterdir() if f.suffix == ".png" and f.name.startswith("variant_")]
    return len(existing)


def _mint_dog_id(session_id: str, dog_index: int) -> str:
    """The stable per-dog id (A1). Lazy-imports canonical_migration to avoid a
    module-load cycle; the value is byte-identical to a future LevelStore
    projection and to backfill_stable_ids.stable_dog_id (formula-parity tested).

    Positional ONLY at this mint instant — the returned id is then carried BY
    VALUE on the dogs[] entry and never re-derived from a later position.
    """
    from levelbuilder.api import canonical_migration as _cm
    return _cm._stable_uuid(session_id, _cm._public_dog_id(dog_index))


def _dog_id_for_index(session_id: str, dog_index: int) -> str:
    """The stable id a new dog INHERITS at creation: the hitbox's OWN id at this
    slot, so `hitbox.id == dog.id` always (review P1 #1/#4 — unifies the client's
    by-value uuid4 placement with the dog meta, which previously minted a server
    uuid5 positionally and diverged → orphaned dogs[] entries + 404s on the by-id
    routes for any forward-placed dog). Falls back to the canonical positional
    mint only for a genuinely id-less (legacy) hitbox slot. The slot lookup is
    positional — correct for a contiguous array; a post-delete tombstone GAP needs
    the id-based join (Batch B, todos/053) and is tracked there.
    """
    hitboxes = _load_hitboxes_raw(session_dir(session_id))
    if 0 <= dog_index < len(hitboxes):
        hb = hitboxes[dog_index]
        if isinstance(hb, dict) and hb.get("id"):
            return str(hb["id"])
    return _mint_dog_id(session_id, dog_index)


def _new_dog_meta(
    session_id: str,
    dog_index: int,
    *,
    status: str,
    active_variant: int | None = None,
    prompt_override: str | None = None,
    id_override: str | None = None,
    **extra: Any,
) -> dict:
    """Build a NEW session.json dogs[] entry, INHERITING the hitbox's stable id
    (A1 + review P1 #1).

    Centralizes the dog-metadata shape so every create path (set_active_variant,
    update_dog_status, regen) binds identically. The id is re-asserted AFTER
    `extra` so a stray `id` key in extra can never clobber the canonical id.

    `id_override` lets a caller bind a SPECIFIC id when dog_index is NOT the
    hitbox's array position (final-rereview P2: the magenta path creates a dog for
    a hitbox at a fresh index, where positional _dog_id_for_index would mint a
    divergent id instead of the hitbox's own).
    """
    dog_id = id_override or _dog_id_for_index(session_id, dog_index)
    entry = {
        "index": dog_index,
        "id": dog_id,
        "status": status,
        "activeVariant": active_variant,
        "promptOverride": prompt_override,
    }
    entry.update(extra)
    entry["id"] = dog_id
    return entry


def resolve_dog_index_by_id(session_id: str, dog_id: str) -> int | None:
    """Resolve a stable dog id to its CURRENT array index (A1 by-id adapter).

    Reads fresh session.json under the lock so a by-id route never acts on a
    stale index. Returns None if no dogs[] entry carries this id (legacy /
    un-backfilled sessions, or an unknown id) — callers map None to 404.
    """
    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return None
        for dog in raw.get("dogs") or []:
            if isinstance(dog, dict) and dog.get("id") == dog_id:
                index = dog.get("index")
                return int(index) if index is not None else None
    return None


def delete_dog_by_id(session_id: str, dog_id: str) -> bool:
    """Delete a dog by stable id, resolve-AND-act under ONE lock (no TOCTOU,
    spec -004 §3.6). Removes the hitbox carrying `dog_id` and the dogs[] entry
    carrying the same id; survivors are NOT renumbered (scheme b tombstone gap,
    §6.1) — their index/id/folder are untouched, so a recomposite re-binds them
    unchanged and "delete dog 7 never changes dog 8" holds on disk.

    Returns False if no hitbox carries the id (legacy/unknown — caller → 404).
    The dog folder is left on disk as a gap (art preserved, orphan-prunable
    later); recompose ignores it since no dogs[] entry or hitbox references it.
    Matching is BY ID on both files independently — never round-tripped through a
    positional index (§6.2).
    """
    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return False
        sdir = session_dir(session_id)
        hitboxes = _load_hitboxes_raw(sdir)
        if not any(isinstance(h, dict) and h.get("id") == dog_id for h in hitboxes):
            return False
        new_hitboxes = [h for h in hitboxes if not (isinstance(h, dict) and h.get("id") == dog_id)]
        dogs = raw.get("dogs") or []
        deleted_index: int | None = None
        for d in dogs:
            if isinstance(d, dict) and d.get("id") == dog_id and isinstance(d.get("index"), int):
                deleted_index = d["index"]
                break
        raw["dogs"] = [d for d in dogs if not (isinstance(d, dict) and d.get("id") == dog_id)]
        # Tombstone the id so a LATE / in-flight save_hitboxes POST (whose full-array
        # body still carries this id from before the delete) can't re-stamp it onto
        # disk (final-rereview iter5 P1). Enforced SERVER-SIDE under the same lock,
        # where no client request-ordering race can defeat it. save_hitboxes' case-3
        # mint also treats these ids as taken (collision -> uuid4), so a re-placed
        # hitbox at the same slot can never re-mint a tombstoned id (ledger 054 #10).
        tombstones = raw.get("deleted_dog_ids") or []
        if dog_id not in tombstones:
            tombstones.append(dog_id)
        raw["deleted_dog_ids"] = tombstones
        # Record the INDEX too: hydrate_session skips an orphan dog_NN folder at a
        # deleted index (no live dogs[] entry) instead of synthesizing an id-less
        # ghost dog from it (ledger 054 #2).
        if deleted_index is not None:
            deleted_indices = raw.get("deleted_dog_indices") or []
            if deleted_index not in deleted_indices:
                deleted_indices.append(deleted_index)
            raw["deleted_dog_indices"] = deleted_indices

        # session.json FIRST (atomic): a crash after this point leaves the tombstone
        # + dogs[] removal durable while the hitbox briefly survives — the next
        # save_hitboxes drops it via the tombstone filter (self-healing). The old
        # order (hitboxes first) lost the tombstone on crash, so a late full-array
        # save could resurrect the id (ledger 054 #24).
        save_session(session_id, raw)

        hb_path = sdir / "hitboxes.json"
        tmp = hb_path.with_suffix(f".json.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
        try:
            with open(tmp, "w") as f:
                json.dump(new_hitboxes, f, indent=2)
            os.replace(tmp, hb_path)
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass

        # Move the dog folder out of the hydrate scan namespace (art preserved,
        # prunable later). Leaving `dog_NN/` in place made hydrate_session rebuild
        # the deleted dog as a ghost on the very next GET (ledger 054 #2); it also
        # merged the dead dog's paintings into the variant list of any future dog
        # that legitimately reuses the index. The deleted_dog_indices skip above
        # stays as the backstop for a folder recreated by an in-flight job.
        if deleted_index is not None:
            dog_folder = dogs_dir(session_id) / f"dog_{deleted_index:02d}"
            if dog_folder.is_dir():
                grave = dogs_dir(session_id) / f"deleted_dog_{deleted_index:02d}.{dog_id[:8]}"
                if not grave.exists():
                    os.replace(dog_folder, grave)
    return True


def set_active_variant(session_id: str, dog_index: int, variant_index: int | None) -> None:
    """Persist the active variant selection for a dog."""
    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return
        dogs = raw.setdefault("dogs", [])
        dog_entry = next((d for d in dogs if d["index"] == dog_index), None)
        if dog_entry is None:
            dogs.append(_new_dog_meta(session_id, dog_index, status="done", active_variant=variant_index))
        else:
            dog_entry["activeVariant"] = variant_index
        save_session(session_id, raw)


def update_dog_status(
    session_id: str, dog_index: int, status: str, *, id_override: str | None = None, **extra: Any,
) -> None:
    """Update the status of a specific dog in session.json. `id_override` binds a
    specific id when CREATING a dog whose index is not its hitbox's array position
    (final-rereview P2 — the magenta fresh-index create)."""
    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return
        dogs = raw.setdefault("dogs", [])
        dog_entry = next((d for d in dogs if d["index"] == dog_index), None)
        if dog_entry is None:
            # Default activeVariant to None, NOT 0. Integer 0 is a legitimate
            # successfully-painted variant index; None is the sentinel for
            # "no painted variant." Conflating them means an errored dog
            # marked via `update_dog_status(..., 'error')` with no activeVariant
            # in extras gets activeVariant=0 and passes the `is not None`
            # partial-export filter (fix 015).
            extra_without_av = {k: v for k, v in extra.items() if k != "activeVariant"}
            dogs.append(_new_dog_meta(
                session_id, dog_index, status=status,
                active_variant=extra.get("activeVariant"),
                id_override=id_override, **extra_without_av,
            ))
        else:
            dog_entry["status"] = status
            dog_entry.update(extra)
        save_session(session_id, raw)


# Map from variant slug to the source color file that should ship as
# `color.png` in the exported level. Callers pass a slug ('gemini',
# 'openai', 'openai_v2') to pick which composite goes to the game.
_VARIANT_COLOR_SRC = {
    "gemini": "color.png",
    "openai": "openai_color.png",
    "openai_v2": "openai_color_v2.png",
}


def _level_extension_config(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Return the session's vertical-extension intent (`targetAspect` +
    `bandsRef`) if one is configured, else None.

    The band-generation stage (future PR) is what writes this into session.json;
    until then no session carries it and export stays native-only. Fail-fast on a
    malformed config (missing keys / bad types raise) — no defensive fallback."""
    cfg = raw.get("extension")
    if cfg is None:
        return None
    return {
        "targetAspect": float(cfg["targetAspect"]),
        "bandsRef": str(cfg["bandsRef"]),
    }


def _write_native_source_package(
    dst: Path, level_data: dict[str, Any], band_src_dir: Path | None = None
) -> None:
    """Persist the immutable native source under `<dst>/native/` so publish can
    re-derive the baked package deterministically.

    Copies the (still-native, pre-publish) root art, the accepted extension bands
    (from `band_src_dir` → `native/bands/`), and writes the native-coordinate
    level.json — which already carries the extension block. Never bakes; the bake
    happens at publish time from this source. Called only for extension levels,
    so the no-extension export path is byte-unchanged.

    The dir is rebuilt from scratch each export (rmtree first) so it stays a
    clean mirror of the current native art — a level that drops a bg layer or a
    bw mask between exports never leaves a stale file behind for the bake to
    pick up."""
    native_dir = dst / "native"
    if native_dir.exists():
        shutil.rmtree(native_dir)
    native_dir.mkdir(parents=True, exist_ok=True)
    for name in ("color.png", "bw.png"):
        src = dst / name
        if src.exists():
            shutil.copy2(src, native_dir / name)
    for bg_src in sorted(dst.glob("bg_[0-9][0-9].png")):
        shutil.copy2(bg_src, native_dir / bg_src.name)
    # Extension bands ride along in native/bands/ so the level package is a
    # self-contained bake input (derive reads them there; no external band store).
    # Fail loudly if a declared-extension level is missing a band at export time —
    # shipping a native/ that declares an extension with an incomplete native/bands/
    # would only surface as a failure deep in the publish bake (fail-fast policy).
    if band_src_dir is not None:
        bands_dst = native_dir / "bands"
        bands_dst.mkdir(parents=True, exist_ok=True)
        for side in ("top", "bottom"):
            band = band_src_dir / f"{side}.png"
            if not band.exists():
                raise LevelNotReadyError(
                    f"extension level missing {side} band ({band}) — regenerate the "
                    f"extension before exporting"
                )
            shutil.copy2(band, bands_dst / f"{side}.png")
    tmp = (native_dir / "level.json").with_suffix(
        f".json.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    )
    try:
        with open(tmp, "w") as f:
            json.dump(level_data, f, indent=2)
        os.replace(tmp, native_dir / "level.json")
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _require_local_alignment(sdir: Path, raw: dict, *, max_shift: int = 8) -> None:
    """Refuse export when the painted scene is spatially warped vs the clean bg.

    Verified live 2026-08-05 ("the docks are pasted offset"): a sizeless
    OpenAI edits call returned a non-square canvas that edit_image stretched
    back to 4096², displacing content by up to ~190px near the edges while
    the image CENTER stayed aligned — so whole-image/quadrant shift checks
    read 0. Restore patches cut from the undistorted clean bg then land
    visibly offset on pickup. Probe a 3x3 grid of local windows with phase
    correlation; any window shifted beyond max_shift px fails the export.
    """
    import numpy as _np

    # Dev-only bypass for A/B evaluation exports where the human IS the
    # judge. Never set in a production/build lane.
    if os.environ.get("FTD_SKIP_ALIGNMENT_GATE") == "1":
        return

    color_path = sdir / "color.png"
    selected = raw.get("selected_bg") or 0
    bg_path = sdir / f"bg_{int(selected):02d}.png"
    if not color_path.exists() or not bg_path.exists():
        return
    with Image.open(color_path) as _c:
        color = _c.convert("L")
        with Image.open(bg_path) as _b:
            clean = _b.convert("L")
            if clean.size != color.size:
                clean = clean.resize(color.size, Image.LANCZOS)
            ca = _np.asarray(color, dtype=_np.float64)
            ba = _np.asarray(clean, dtype=_np.float64)
    H, W = ca.shape
    win_h, win_w = H // 4, W // 4
    bad: list[str] = []
    for gy in range(3):
        for gx in range(3):
            y0 = (H - win_h) * gy // 2
            x0 = (W - win_w) * gx // 2
            a = ca[y0:y0 + win_h, x0:x0 + win_w]
            b = ba[y0:y0 + win_h, x0:x0 + win_w]
            fa, fb = _np.fft.fft2(a - a.mean()), _np.fft.fft2(b - b.mean())
            spec = fa * _np.conj(fb)
            spec /= _np.abs(spec) + 1e-9
            corr = _np.abs(_np.fft.ifft2(spec))
            dy, dx = _np.unravel_index(int(_np.argmax(corr)), corr.shape)
            if dy > win_h // 2:
                dy -= win_h
            if dx > win_w // 2:
                dx -= win_w
            if abs(int(dx)) > max_shift or abs(int(dy)) > max_shift:
                bad.append(f"grid({gx},{gy}) shift=({int(dx)},{int(dy)})")
    if bad:
        raise LevelNotReadyError(
            "painted scene is spatially misaligned with the clean background "
            f"(warped/stretched paint output): {', '.join(bad)}. "
            "Regenerate the paint with an aspect-preserving model call before exporting."
        )


def _write_birdless_restore_bg(sdir: Path, dst: Path, raw: dict, level_data: dict) -> None:
    """Whole-image paint modes ship a restore background that is the PAINTED
    scene minus birds, at full scene resolution.

    Two live defects this kills (observed on device, build 6): the copied
    session bg_00 was the 1K pre-upscale original (runtime scaled it 4x under
    a 4096 scene), and the model's scene-wide drift meant every cleanup patch
    swapped drifted pixels for clean-bg pixels — a visible few-pixel jump on
    every pickup. Patching ONLY each bird's cleanup region out of the painted
    color keeps every other pixel byte-identical to the scene."""
    from PIL import ImageFilter as _IF

    with Image.open(sdir / "color.png") as _c:
        color = _c.convert("RGB")
    selected = raw.get("selected_bg") or 0
    bg_path = sdir / f"bg_{int(selected):02d}.png"
    if not bg_path.exists():
        color.close()
        return
    with Image.open(bg_path) as _b:
        clean = _b.convert("RGB")
    if clean.size != color.size:
        clean = clean.resize(color.size, Image.LANCZOS)
    out = color.copy()
    # Erase ONLY the bird pixels (local diff vs clean bg inside the cleanup
    # rect, dilated + feathered) — a rectangular patch visibly reverts drifted
    # scenery around the bird when the runtime swaps it in ("pickup destroys
    # background", device build 10). Masked erasure keeps every non-bird pixel
    # byte-identical to the scene, so the swap is seamless at any box size.
    import numpy as _np
    from scipy import ndimage as _ndi
    color_arr = _np.asarray(color, dtype=_np.int16)
    clean_arr = _np.asarray(clean, dtype=_np.int16)
    for dog in (level_data.get("dogs") or []):
        sprite = dog.get("sprite") if isinstance(dog, dict) else None
        cleanup = sprite.get("cleanup") if isinstance(sprite, dict) else None
        if not isinstance(cleanup, dict):
            continue
        x, y = int(cleanup["x"]), int(cleanup["y"])
        w, h = int(cleanup["width"]), int(cleanup["height"])
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(out.width, x + w), min(out.height, y + h)
        if x1 <= x0 or y1 <= y0:
            continue
        # Register the clean patch to the painted scene before pasting: the
        # paint model redraws nearby strokes a few pixels off, so an unshifted
        # clean patch breaks every line crossing the mask edge. Phase
        # correlation on the cleanup neighborhood finds the local translation
        # (clamped to ±8px; subpixel is overkill for line art).
        pad = 32
        ay0, ay1 = max(0, y0 - pad), min(out.height, y1 + pad)
        ax0, ax1 = max(0, x0 - pad), min(out.width, x1 + pad)
        a = color_arr[ay0:ay1, ax0:ax1].sum(axis=2).astype(_np.float64)
        b = clean_arr[ay0:ay1, ax0:ax1].sum(axis=2).astype(_np.float64)
        fa, fb = _np.fft.fft2(a - a.mean()), _np.fft.fft2(b - b.mean())
        rspec = fa * _np.conj(fb)
        rspec /= _np.abs(rspec) + 1e-9
        corr = _np.abs(_np.fft.ifft2(rspec))
        dy, dx = _np.unravel_index(int(_np.argmax(corr)), corr.shape)
        if dy > a.shape[0] // 2:
            dy -= a.shape[0]
        if dx > a.shape[1] // 2:
            dx -= a.shape[1]
        if abs(dx) > 8 or abs(dy) > 8:
            dx = dy = 0
        shifted_clean = clean_arr if (dx == 0 and dy == 0) else _np.roll(clean_arr, (dy, dx), axis=(0, 1))
        diff = _np.abs(color_arr[y0:y1, x0:x1] - shifted_clean[y0:y1, x0:x1]).sum(axis=2) > 45
        diff = _ndi.binary_dilation(diff, iterations=4)
        mask = Image.fromarray((diff * 255).astype("uint8")).filter(_IF.GaussianBlur(3))
        patch = Image.fromarray(shifted_clean[y0:y1, x0:x1].astype("uint8"))
        # Sharpness matching (2026-08-05, "the difference is resolution"):
        # the paint model outputs crisper high-frequency detail than the
        # lanczos-upscaled clean bg (measured 11.98 vs 8.64 gradient energy),
        # so revealed patches read as a blur pop. Unsharp-mask the clean
        # patch toward the local painted crispness, scaled by the measured
        # gradient ratio and clamped to sane bounds.
        def _grad_energy(gray: _np.ndarray) -> float:
            gy, gx = _np.gradient(gray.astype(_np.float64))
            return float(_np.sqrt(gx * gx + gy * gy).mean())
        painted_g = _grad_energy(color_arr[y0:y1, x0:x1].mean(axis=2))
        clean_g = _grad_energy(shifted_clean[y0:y1, x0:x1].mean(axis=2))
        if clean_g > 0 and painted_g / clean_g > 1.05:
            percent = int(min(180.0, (painted_g / clean_g - 1.0) * 200.0))
            patch = patch.filter(_IF.UnsharpMask(radius=2, percent=percent, threshold=2))
        out.paste(patch, (x0, y0), mask)
    out.save(dst / "bg_00.png")
    (dst / "bg_00.webp").unlink(missing_ok=True)
    color.close(); clean.close(); out.close()


def export_to_game(
    session_id: str,
    variant: str = "gemini",
    *,
    update_preview_manifest: bool = True,
    update_preview_variant: bool = True,
    destination_root: Path | None = None,
    enforce_visibility: bool = True,
) -> dict:
    """Copy level assets to public/levels/ and optionally update local preview manifests.

    `variant` selects which composite file gets shipped as `color.png` in
    the public package. The session's `exportedVariant` field is updated only
    when that package is also the local preview package.

    Regenerates level.json from current hitboxes.json before copying,
    so that any hitbox adjustments made after inpainting are included.

    For landscape sessions, writes `sections[]` into level.json. For portrait
    sessions, actively removes any stale `sections` key (handles
    landscape→portrait mode flip so the game doesn't instantiate
    SectionController against obsolete boundaries).
    """
    _validate_session_id_or_raise(session_id)
    sdir = session_dir(session_id)
    public_levels_root = destination_root or GAME_PUBLIC_LEVELS
    canonical = read_canonical_session(session_id)
    from .canonical_bird_contract import CanonicalReadState

    if canonical.state is not CanonicalReadState.MIGRATION_REQUIRED and canonical.pointer is None:
        detail = f": {canonical.detail}" if canonical.detail else ""
        raise LevelNotReadyError(f"canonical authoring is {canonical.state.value}{detail}")
    if canonical.pointer is not None:
        from .canonical_export import CanonicalExportError, export_canonical_revision

        try:
            result = export_canonical_revision(canonical_session_store(session_id), public_levels_root)
        except CanonicalExportError as error:
            raise LevelNotReadyError(str(error)) from error
        if update_preview_manifest:
            _ensure_levels_index_entry(session_id)
            upsert_bundled_manifest_level(session_id)
        return {
            "levelId": session_id,
            "path": f"public/levels/{session_id}/",
            "variant": "canonical",
            "contentRevision": result["contentRevision"],
        }
    dst = public_levels_root / session_id
    color_src_name = _VARIANT_COLOR_SRC.get(variant, "color.png")
    color_src = sdir / color_src_name
    actual_variant = variant
    if not color_src.exists():
        # Fall back to color.png if the requested variant file is missing
        # (e.g. gallery opened an older session before the openai_v2 run).
        color_src = sdir / "color.png"
        actual_variant = "gemini"
    # NOTE: the stale-color.png refresh (the by-id recompose split can leave
    # color.png stale at export time) is deferred to AFTER the validation gates
    # below — see `refresh_color_only` near the color.png copy. Running it here (at
    # the top) mutated the session dir even when the export was later REJECTED by a
    # gate, and the full recomposite_color clobbered the export-authored level.json
    # (final-rereview P2).

    # Regenerate level.json from current hitboxes (may have been adjusted post-inpaint)
    hb_path = sdir / "hitboxes.json"
    level_path = sdir / "level.json"
    if not color_src.exists():
        raise LevelNotReadyError(f"missing color image for variant {variant!r}")
    if not hb_path.exists():
        raise LevelNotReadyError("missing hitboxes.json")
    if not level_path.exists():
        raise LevelNotReadyError("missing level.json")

    if hb_path.exists() and level_path.exists():
        # Held under _session_lock so concurrent exports for the same session
        # serialize — prevents both writers from racing on the shared tmp_path.
        # NOTE: threading.Lock is process-local; multi-worker uvicorn would need
        # an fcntl.flock migration. Document constraint, don't fix here.
        with _session_lock:
            raw = load_session_raw(session_id) or {}
            mode = raw.get("mode") or "portrait"

            with open(hb_path) as f:
                hitboxes = json.load(f)
            with open(level_path) as f:
                level_data = json.load(f)

            # Partial-export policy: when session.json carries per-dog
            # metadata, only include hitboxes whose dog has an activeVariant
            # on disk. A 9/10 session ships as a 9-dog level; the missing
            # hitbox is silently dropped so the game runtime never sees an
            # index with no painted dog. Previously we blocked export until
            # the user regenerated the failed dog.
            #
            # Legacy sessions (empty raw["dogs"]) pre-date per-dog tracking —
            # fall back to including every hitbox and trust that if the user
            # has a level.json + color.png on disk, the level is shippable.
            #
            # Magenta mode: a single composite covers every hitbox, so every
            # dog legitimately has activeVariant=None (no per-dog variant
            # file). Treat magenta sessions the same as legacy — ship every
            # hitbox. Without this branch the activeVariant filter rejects
            # every magenta re-export (todo 023 regression).
            raw_dogs = raw.get("dogs") or []
            is_whole_image = raw.get("inpaint_mode") in {"magenta", "one_shot"}
            if raw_dogs and not is_whole_image:
                target_map = active_dog_variant_targets(session_id, raw_dogs, hitboxes)
                require_all_painted_dogs_mapped(session_id, raw_dogs, target_map)
                if target_map:
                    painted_indices = sorted(target_map.keys())
                else:
                    dog_by_index = {
                        d.get("index"): d
                        for d in raw_dogs
                        if isinstance(d, dict)
                    }
                    painted_indices = [
                        i for i in range(len(hitboxes))
                        if is_painted_dog_meta(dog_by_index.get(i))
                    ]
                if not painted_indices:
                    raise LevelNotReadyError(
                        "no dogs have been painted yet — place hitboxes and inpaint first"
                    )
            else:
                painted_indices = list(range(len(hitboxes)))

            sprite_metadata_by_index = active_sprite_metadata_map(session_id, raw_dogs, hitboxes)
            require_sprite_metadata_for_indices(
                session_id=session_id,
                sprite_metadata_by_index=sprite_metadata_by_index,
                painted_indices=painted_indices,
            )

            # HITL relabels routinely nudge a center just outside its baked
            # cleanup box; the geometry gate then refuses the export. Expand
            # each box minimally to contain its hitbox center (+16px pad,
            # clamped to the level) — the shipped background is clean
            # everywhere, so a slightly larger reveal patch is always safe.
            # (Third manual occurrence of this repair on 2026-08-07 — now
            # automatic.)
            _PAD = 16
            level_w = int(level_data.get("width") or 0)
            level_h = int(level_data.get("height") or 0)
            for i in painted_indices:
                sprite = sprite_metadata_by_index.get(i)
                cleanup = sprite.get("cleanup") if isinstance(sprite, dict) else None
                if not isinstance(cleanup, dict):
                    continue
                cx, cy = hitboxes[i]["x"], hitboxes[i]["y"]
                x0, y0 = cleanup["x"], cleanup["y"]
                x1, y1 = x0 + cleanup["width"], y0 + cleanup["height"]
                if x0 <= cx <= x1 and y0 <= cy <= y1:
                    continue
                x0 = min(x0, max(0, cx - _PAD))
                y0 = min(y0, max(0, cy - _PAD))
                if level_w: x1 = max(x1, min(level_w, cx + _PAD))
                else: x1 = max(x1, cx + _PAD)
                if level_h: y1 = max(y1, min(level_h, cy + _PAD))
                else: y1 = max(y1, cy + _PAD)
                cleanup.update({"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0})

            # Update dogs array with current hitbox positions — painted only.
            level_data["dogs"] = [
                {
                    "id": f"dog_{i:02d}",
                    "x": hitboxes[i]["x"],
                    "y": hitboxes[i]["y"],
                    "r": hitboxes[i].get("r", hitboxes[i].get("radius", 30)),
                    # Per-bird difficulty (easy is the unmarked default): the
                    # hard/easy ratio experiment records which birds were
                    # painted as camouflage subjects.
                    **({"difficulty": "hard"} if str(hitboxes[i].get("difficulty") or "").lower() == "hard" else {}),
                    **({"sprite": sprite_metadata_by_index[i]} if i in sprite_metadata_by_index else {}),
                }
                for i in painted_indices
            ]

            # Sections: landscape writes + validates, portrait removes any stale key.
            # The game's SectionController keys off Array.isArray(sections) && sections.length > 0,
            # so leaving a stale landscape sections[] on a portrait level would instantiate
            # section logic against the wrong level layout. Invariants (contiguity, full
            # coverage) are enforced pre-write so a hand-edited session.json can't ship
            # a corrupt level that parses JSON but breaks SectionController at runtime.
            if mode == "landscape":
                width = level_data.get("width")
                if width is None:
                    raise SectionsInvariantError(
                        "level.json missing required 'width' field"
                    )
                sections = raw.get("sections") or []
                _validate_sections(sections, width)
                level_data["sections"] = _camera_sections(sections)
            else:
                level_data.pop("sections", None)

            # Vertical-extension intent: when the session carries an extension
            # config, stamp the extension block with NATIVE dims and zero bands.
            # export never bakes — the realized band geometry is computed at
            # publish time (derive_baked_package) from this native source. Absent
            # config ⇒ strip any stale block so a re-export reverts cleanly and
            # the no-extension path stays byte-identical.
            ext_cfg = _level_extension_config(raw)
            if ext_cfg is not None:
                level_data["extension"] = {
                    "targetAspect": ext_cfg["targetAspect"],
                    "bandsRef": ext_cfg["bandsRef"],
                    "topBand": 0,
                    "bottomBand": 0,
                    "nativeWidth": int(level_data["width"]),
                    "nativeHeight": int(level_data["height"]),
                }
            else:
                level_data.pop("extension", None)

            # Schema gate: validate the assembled level against LevelFileV1
            # BEFORE the atomic write, so a malformed level never lands on disk
            # (and never ships to a player). This is the export-time half of
            # Workstream C's contract; the generated TS type is the runtime
            # half. Re-raise as LevelNotReadyError so callers/UI handle it via
            # the existing not-ready error surface.
            try:
                LevelFileV1.model_validate(level_data)
            except ValidationError as exc:
                raise LevelNotReadyError(
                    f"level.json failed schema validation: {exc.error_count()} "
                    f"error(s)\n{exc}"
                ) from exc

            # Visibility gate (fail-closed): run the SAME mobile_visibility_report
            # the UI shows against the EXACT level dict about to ship, and refuse
            # to publish if any dog falls in a blocked_area (HUD/ad band or
            # section safe-margins) on any device viewport. This closes the
            # agent/direct-API bypass — the gate previously lived only in
            # StepExport.tsx, so a non-UI caller could publish an unplayable
            # level. Runs before the atomic write so a blocked level produces no
            # on-disk side effect. enforce_visibility lets an internal re-export
            # opt out, but every real publish path (preview/export/approve) keeps
            # the default-closed gate.
            if enforce_visibility:
                report = mobile_visibility_report(level_data)
                blocking = blocking_visibility_issues(report)
                if blocking:
                    raise VisibilityBlockedError(blocking)

            # Atomic write: write to tmp then rename. Prevents a crash / disk-full
            # mid-write from leaving level.json truncated — a corruption class that
            # would brick the runtime (JSON parse failure or missing keys). The
            # try/finally guarantees the tmp is unlinked if json.dump raises mid-write
            # so a failed export doesn't leak orphans into the session dir. The
            # cleanup itself swallows OSError so an unlink failure can't mask the
            # original write failure (which is what the caller actually needs to see).
            tmp_path = level_path.with_suffix(".json.tmp")
            try:
                with open(tmp_path, "w") as f:
                    json.dump(level_data, f, indent=2)
                os.replace(tmp_path, level_path)
            finally:
                # On the happy path os.replace removes the tmp; this is a no-op.
                # On the sad path it cleans up the partial-write orphan.
                try:
                    tmp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    # Freshen the gemini color.png now that ALL validation gates have passed
    # (final-rereview P2): the by-id recompose split can leave it stale, but doing
    # this at the top mutated the session dir even on a REJECTED export. color-ONLY
    # (refresh_color_only does NOT touch level.json — the export authored that
    # above; the full recomposite_color would clobber it). Skip magenta (its
    # color.png is the whole-image output, not a per-variant compose) and openai_*
    # (unaffected by the split).
    if (
        color_src == sdir / "color.png"
        and (load_session_raw(session_id) or {}).get("inpaint_mode") not in {"magenta", "one_shot"}
    ):
        from levelbuilder.api import inpaint as _inpaint
        _inpaint.refresh_color_only(session_id)

    dst.mkdir(parents=True, exist_ok=True)
    # Copy the variant-specific color source under the shipped name
    # `color.png` (the game reads `color.png` regardless of which variant
    # the author picked).
    if color_src.exists():
        shutil.copy2(color_src, dst / "color.png")
        # Invalidate the stale .webp derivative: the preview manifest and the
        # dist packager PREFER color.webp when present, so refreshing only the
        # PNG shipped OLD art with NEW hitboxes (fresh-review P1 — ledger 054
        # #1). The manifest falls back to the fresh PNG until the optimizer
        # regenerates the derivative from it.
        (dst / "color.webp").unlink(missing_ok=True)
    bw_src = sdir / "bw.png"
    if bw_src.exists():
        shutil.copy2(bw_src, dst / "bw.png")
    # Ship the VALIDATED in-memory level_data, never a re-read of the session
    # file (fresh-review P2 — ledger heading 21): the lock is released before
    # this copy phase, so a background recomposite finishing in the window
    # could swap level.json on disk between the schema/visibility gates and
    # the copy — shipping an unvalidated, sections-less file to the game.
    dst_level_tmp = (dst / "level.json").with_suffix(f".json.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    try:
        with open(dst_level_tmp, "w") as f:
            json.dump(level_data, f, indent=2)
        os.replace(dst_level_tmp, dst / "level.json")
    finally:
        if dst_level_tmp.exists():
            try:
                dst_level_tmp.unlink()
            except OSError:
                pass
    whole_image = raw.get("inpaint_mode") in {"magenta", "one_shot"}
    for bg_src in sorted(sdir.glob("bg_[0-9][0-9].png")):
        if whole_image and bg_src.name != "bg_00.png":
            # Authoring-only upscale tiers: shipping them tripled the native
            # bundle (observed 322MB vs the 100MB cap on build 9).
            continue
        shutil.copy2(bg_src, dst / bg_src.name)
        # Same stale-derivative invalidation as color.webp above (054 #1).
        (dst / bg_src.name).with_suffix(".webp").unlink(missing_ok=True)
    if whole_image:
        _require_local_alignment(sdir, raw)
        _write_birdless_restore_bg(sdir, dst, raw, level_data)
    # Bundle derivatives are part of the export so catalog snapshots always
    # match what ships: 2560/q70 webp for scene + restore bg.
    for stem in ("color", "bg_00"):
        png = dst / f"{stem}.png"
        if not png.exists():
            continue
        with Image.open(png) as img:
            im = img.convert("RGB")
            if im.width > 2560:
                im = im.resize((2560, int(im.height * 2560 / im.width)), Image.LANCZOS)
            im.save(dst / f"{stem}.webp", format="WEBP", quality=70, method=6)

    public_dogs_dir = dst / "dogs"
    if public_dogs_dir.exists():
        shutil.rmtree(public_dogs_dir)
    # Same validated-snapshot rule for the sprite copies (ledger heading 21).
    for dog in (level_data.get("dogs") or []):
        sprite = dog.get("sprite") if isinstance(dog, dict) else None
        image = sprite.get("image") if isinstance(sprite, dict) else None
        if not isinstance(image, str):
            continue
        prefix = f"levels/{session_id}/"
        if not image.startswith(prefix):
            continue
        rel_path = image[len(prefix):]
        src = sdir / rel_path
        if not src.exists():
            continue
        target = dst / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        # Flyout sprites display small (dissolve flashes them ~0.3s); cap the
        # shipped texture so 20 birds/level stay bundle-friendly. Metadata
        # boxes are scene-coordinate, so texture size is free to shrink.
        try:
            with Image.open(target) as _sp:
                if max(_sp.size) > 288:
                    _scale = 288 / max(_sp.size)
                    _small = _sp.convert("RGBA").resize(
                        (max(1, int(_sp.width * _scale)), max(1, int(_sp.height * _scale))), Image.LANCZOS,
                    )
                    _small.save(target, optimize=True)
                    _small.close()
        except (OSError, ValueError):
            pass
        for sibling_name in (
            src.with_suffix(".json").name,
            f"sprite_mask_{src.stem.removeprefix('sprite_')}.png",
        ):
            sibling = src.parent / sibling_name
            if sibling.exists():
                shutil.copy2(sibling, target.parent / sibling.name)

    # Extension levels persist their immutable native source under native/ so
    # publish can re-derive the baked package. Runs after the root art is in
    # place (still native, since export never bakes), so the copy captures native
    # art. On the revert path (a level that dropped its extension config), delete
    # any orphan native/ dir — otherwise publish (which re-derives from native/)
    # would resurrect the extension and ship baked art for a level the author
    # explicitly reverted to native.
    if level_data.get("extension") is not None:
        # NOTE (deferred follow-up): if the scene (color.png) is re-inpainted AFTER
        # the extension is accepted, the accepted bands become stale (built from the
        # old scene). A dimension change is caught downstream by verify:level-geometry
        # (baked aspect mismatch); a same-dimension content change ships a visible
        # seam the author must fix by re-extending. A clean auto-invalidation needs
        # care around export's own color.png refresh (refresh_color_only mutates
        # color.png before this point), so it's left as a follow-up rather than a
        # fragile mtime/hash guard here.
        _write_native_source_package(dst, level_data, band_src_dir=sdir / "extension")
    else:
        stale_native = dst / "native"
        if stale_native.exists():
            shutil.rmtree(stale_native)

    # Fail-closed gate (v2 schema authority): validate the freshly written
    # package BEFORE any manifest is touched. On refusal, remove the package
    # so level dirs and manifests stay coherent as one atomic unit — the game
    # hard-fails boot on a manifest that references a bad package.
    from .export_gate import ExportGateError, validate_level_dir

    try:
        validate_level_dir(public_levels_root, session_id)
    except ExportGateError:
        if dst.exists():
            shutil.rmtree(dst)
        raise

    if update_preview_manifest:
        _ensure_levels_index_entry(session_id)
        upsert_bundled_manifest_level(session_id)

    if update_preview_variant:
        update_session_field(session_id, exported_variant=actual_variant)

    return {"levelId": session_id, "path": f"public/levels/{session_id}/", "variant": actual_variant}


def _ensure_levels_index_entry(session_id: str) -> None:
    # Read / update / atomic-write the index under lock so concurrent
    # preview + revoke + reorder requests can't interleave.
    with _session_lock:
        index = load_levels_index()
        if any(e.get("id") == session_id for e in index):
            return
        level_json_path = GAME_PUBLIC_LEVELS / session_id / "level.json"
        name = session_id
        if level_json_path.exists():
            with open(level_json_path) as f:
                lj = json.load(f)
            name = lj.get("name", session_id)
        index.append({"id": session_id, "name": name, "jsonPath": f"levels/{session_id}/level.json"})
        save_levels_index(index)


def upsert_bundled_manifest_level(session_id: str) -> dict:
    """Add or replace one exported public level in the runtime manifest.

    The game and Game View read bundled-manifest.json, not the legacy
    levels-index.json, so export must keep this file in sync too.
    """
    _validate_session_id_or_raise(session_id)
    try:
        entry = PublicLevels.public_level_manifest_entry(GAME_PUBLIC_LEVELS, session_id)
    except FileNotFoundError as exc:
        raise LevelNotReadyError(str(exc)) from exc
    with _session_lock:
        manifest = load_bundled_manifest() or {
            "version": 1,
            "manifestRevision": 0,
            "experimentId": "ftd_levelset_v1",
            "levels": [],
        }
        levels = manifest.get("levels") or []
        replaced = False
        next_levels: list[dict] = []
        for existing in levels:
            if existing.get("id") == session_id:
                next_levels.append(entry)
                replaced = True
            else:
                next_levels.append(existing)
        if not replaced:
            next_levels.append(entry)

        manifest["levels"] = next_levels
        manifest["generatedAt"] = PublicLevels.utc_now_iso()
        save_bundled_manifest(manifest)
        return manifest


def _bundled_manifest_contains_level(session_id: str) -> bool:
    manifest = load_bundled_manifest() or {}
    return any(level.get("id") == session_id for level in manifest.get("levels") or [])


def _refresh_bundled_manifest_level_if_present(session_id: str) -> None:
    """Refresh preview manifest hashes only when the level is already previewed."""
    _validate_session_id_or_raise(session_id)
    try:
        entry = PublicLevels.public_level_manifest_entry(GAME_PUBLIC_LEVELS, session_id)
    except FileNotFoundError as exc:
        raise LevelNotReadyError(str(exc)) from exc
    with _session_lock:
        manifest = load_bundled_manifest()
        if not isinstance(manifest, dict):
            return
        levels = manifest.get("levels") or []
        replaced = False
        next_levels: list[dict] = []
        for existing in levels:
            if existing.get("id") == session_id:
                next_levels.append(entry)
                replaced = True
            else:
                next_levels.append(existing)
        if not replaced:
            return
        manifest["levels"] = next_levels
        manifest["generatedAt"] = PublicLevels.utc_now_iso()
        save_bundled_manifest(manifest)


def load_bundled_manifest() -> dict | None:
    """Return the current bundled-manifest.json (None if missing).
    Structure: {version, manifestRevision, generatedAt, experimentId, levels[]}.
    The game's src/data/levels.ts actually reads this file \u2014 levels-index.json
    is a legacy artefact kept for older publish tooling."""
    return PublicLevels.load_bundled_manifest(GAME_PUBLIC_LEVELS)


def save_bundled_manifest(manifest: dict) -> None:
    """Atomic write of bundled-manifest.json."""
    PublicLevels.save_bundled_manifest(GAME_PUBLIC_LEVELS, manifest)


def load_catalog_manifest() -> dict | None:
    """Return the current catalog-manifest.json (None if missing)."""
    return PublicLevels.load_catalog_manifest(GAME_PUBLIC_LEVELS)


def save_catalog_manifest(manifest: dict) -> None:
    """Atomic write of catalog-manifest.json."""
    PublicLevels.save_catalog_manifest(GAME_PUBLIC_LEVELS, manifest)


def load_catalog_snapshot(catalog_revision: str) -> dict | None:
    """Return a catalog snapshot for a prior catalog revision when retained."""
    return PublicLevels.load_catalog_snapshot(GAME_PUBLIC_LEVELS, catalog_revision)


def save_catalog_snapshot(manifest: dict) -> None:
    """Persist a catalog snapshot without changing the live catalog manifest."""
    PublicLevels.save_catalog_snapshot(GAME_PUBLIC_LEVELS, manifest)


def _save_catalog_snapshot_if_valid(manifest: dict | None) -> None:
    if not isinstance(manifest, dict):
        return
    catalog_revision = manifest.get("catalogRevision")
    levels = manifest.get("levels")
    if not isinstance(catalog_revision, str) or not isinstance(levels, list):
        return
    # A matching revision NAME alone is not proof of compatibility (PR #261
    # rereview P2, re-flagged by the 2026-06-10 fresh review — ledger 054 #29
    # / #36): a stale or hand-edited snapshot file can sit under the same
    # revision while its CONTENT diverges from the manifest being published.
    # Compare content; overwrite on mismatch instead of silently reusing.
    existing = load_catalog_snapshot(catalog_revision)
    if existing is None or existing != manifest:
        save_catalog_snapshot(manifest)


def _next_catalog_revision(manifest: dict | None) -> tuple[int, str]:
    current = 0
    if isinstance(manifest, dict):
        value = manifest.get("revisionNumber")
        if isinstance(value, int) and value >= 0:
            current = value
    snapshots = PublicLevels.catalog_snapshot_dir(GAME_PUBLIC_LEVELS)
    if snapshots.is_dir():
        for path in snapshots.glob("catalog-*.json"):
            suffix = path.stem.removeprefix("catalog-")
            if suffix.isdigit():
                current = max(current, int(suffix))
    next_revision = current + 1
    return next_revision, f"catalog-{next_revision:06d}"


def _catalog_levels_by_id(manifest: dict | None) -> dict[str, dict]:
    if not isinstance(manifest, dict):
        return {}
    levels = manifest.get("levels") or []
    return {
        level.get("id"): level
        for level in levels
        if isinstance(level, dict) and isinstance(level.get("id"), str)
    }


def _catalog_level_entry(session_id: str) -> dict | None:
    return _catalog_levels_by_id(load_catalog_manifest()).get(session_id)


def _write_catalog_levels(levels: list[dict], previous_manifest: dict | None) -> dict:
    _save_catalog_snapshot_if_valid(previous_manifest)
    revision_number, catalog_revision = _next_catalog_revision(previous_manifest)
    normalized_levels = []
    seen_ids: set[str] = set()
    seen_package_ids: set[str] = set()
    for level in sorted(levels, key=lambda item: str(item.get("id", ""))):
        level_id = level.get("id")
        package_id = level.get("packageId")
        if not isinstance(level_id, str) or not isinstance(package_id, str):
            continue
        if level_id in seen_ids or package_id in seen_package_ids:
            raise ValueError(f"duplicate catalog metadata for level {level_id!r} or package {package_id!r}")
        seen_ids.add(level_id)
        seen_package_ids.add(package_id)
        normalized_levels.append({**level, "catalogRevision": catalog_revision})

    manifest = {
        "version": 1,
        "revisionNumber": revision_number,
        "catalogRevision": catalog_revision,
        "generatedAt": PublicLevels.utc_now_iso(),
        "levels": normalized_levels,
    }
    save_catalog_snapshot(manifest)
    save_catalog_manifest(manifest)
    return manifest


def preview_level_locally(session_id: str, variant: str = "gemini") -> dict:
    """List a level for local preview without mutating catalog-uploaded bytes."""
    _validate_session_id_or_raise(session_id)
    catalog_entry = _catalog_level_entry(session_id)
    if catalog_entry is not None:
        catalog_variant = catalog_entry.get("sourceVariant")
        if isinstance(catalog_variant, str) and catalog_variant != variant:
            raise LevelNotReadyError(
                "catalog-uploaded assets are retained; approve and upload the selected variant to update the catalog package before previewing it locally"
            )
        _ensure_levels_index_entry(session_id)
        if _bundled_manifest_contains_level(session_id):
            upsert_bundled_manifest_level(session_id)
        if isinstance(catalog_variant, str):
            update_session_field(session_id, exported_variant=catalog_variant)
            variant = catalog_variant
        return {"levelId": session_id, "path": f"public/levels/{session_id}/", "variant": variant}

    return export_to_game(session_id, variant=variant, update_preview_manifest=True)


def _replace_public_package_from_staging(session_id: str, staging_root: Path) -> Path | None:
    staged_package = staging_root / session_id
    public_package = GAME_PUBLIC_LEVELS / session_id
    backup_package = GAME_PUBLIC_LEVELS / f".catalog-backup-{session_id}-{uuid.uuid4().hex}"
    if not staged_package.exists():
        raise FileNotFoundError(f"Staged catalog package missing: {staged_package}")
    backup: Path | None = None
    if public_package.exists():
        os.replace(public_package, backup_package)
        backup = backup_package
    os.replace(staged_package, public_package)
    return backup


def _restore_public_package_backup(session_id: str, backup: Path | None) -> None:
    public_package = GAME_PUBLIC_LEVELS / session_id
    if public_package.exists():
        shutil.rmtree(public_package)
    if backup is not None and backup.exists():
        os.replace(backup, public_package)


def _cleanup_package_backup(backup: Path | None) -> None:
    if backup is not None and backup.exists():
        shutil.rmtree(backup)


def _retain_immutable_package_revision(session_id: str, staging_root: Path, content_revision: str) -> Path:
    """Keep canonical package bytes addressable for catalog rollback and installed clients."""
    revision_slug = content_revision.removeprefix("sha256:")
    retained = GAME_PUBLIC_LEVELS / ".package-revisions" / session_id / revision_slug
    staged = staging_root / session_id
    if retained.exists():
        return retained
    retained.parent.mkdir(parents=True, exist_ok=True)
    temporary = retained.with_name(f".{retained.name}.tmp-{uuid.uuid4().hex}")
    try:
        shutil.copytree(staged, temporary)
        os.replace(temporary, retained)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return retained


def _catalog_approval_signature(
    *,
    session_id: str,
    variant: str,
    bundled_in_app: bool | None,
    cohort_buckets: list[Any] | None,
) -> str:
    return json.dumps({
        "sessionId": session_id,
        "variant": variant,
        "bundledInApp": bundled_in_app,
        "cohortBuckets": cohort_buckets,
    }, sort_keys=True, separators=(",", ":"))


def _remember_catalog_approval_result(request_id: str, signature: str, result: dict[str, Any]) -> None:
    _CATALOG_APPROVAL_REQUESTS[request_id] = {"signature": signature, "result": result}
    while len(_CATALOG_APPROVAL_REQUESTS) > _CATALOG_APPROVAL_REQUEST_LIMIT:
        oldest_request_id = next(iter(_CATALOG_APPROVAL_REQUESTS))
        del _CATALOG_APPROVAL_REQUESTS[oldest_request_id]


def _merge_existing_catalog_metadata(
    new_entry: dict,
    existing_entry: dict | None,
    *,
    bundled_in_app: bool | None,
    cohort_buckets: list[Any] | None,
) -> dict:
    if existing_entry is None:
        return new_entry

    merged = dict(new_entry)
    merged["retention"] = existing_entry.get("retention", new_entry.get("retention"))

    if bundled_in_app is None:
        merged["bundledInApp"] = bool(existing_entry.get("bundledInApp"))
    if cohort_buckets is None:
        existing_cohorts = existing_entry.get("cohortBuckets")
        if isinstance(existing_cohorts, list):
            merged["cohortBuckets"] = existing_cohorts
            merged["allCohortAvailable"] = PublicLevels.is_all_cohort_available(existing_cohorts)
            merged["listable"] = bool(merged.get("listable") and merged["allCohortAvailable"])

    tombstoned_at = existing_entry.get("tombstonedAt")
    if tombstoned_at is not None:
        merged["tombstonedAt"] = tombstoned_at
        if "tombstoneReason" in existing_entry:
            merged["tombstoneReason"] = existing_entry.get("tombstoneReason")
        merged["listable"] = False

    return merged


def refresh_catalog_packages(session_ids: list[str]) -> dict:
    """Refresh existing catalog packages in one revision after a deterministic batch edit.

    This does not upload or activate anything. It keeps the checked-in catalog
    projection byte-coherent with public/levels while preserving human-owned
    visibility, cohort, retention, tombstone, and source-variant metadata.
    """
    normalized_ids = sorted(set(session_ids))
    for session_id in normalized_ids:
        _validate_session_id_or_raise(session_id)

    with _catalog_lock:
        previous_manifest = load_catalog_manifest()
        existing_by_id = _catalog_levels_by_id(previous_manifest)
        missing = [session_id for session_id in normalized_ids if session_id not in existing_by_id]
        if missing:
            raise ValueError(f"Catalog entries not found: {', '.join(missing)}")
        _, catalog_revision = _next_catalog_revision(previous_manifest)
        for session_id in normalized_ids:
            existing_entry = existing_by_id[session_id]
            entry = PublicLevels.public_level_catalog_entry(
                GAME_PUBLIC_LEVELS,
                session_id,
                catalog_revision=catalog_revision,
                bundled_in_app=bool(existing_entry.get("bundledInApp")),
                cohort_buckets=existing_entry.get("cohortBuckets"),
                listable=bool(existing_entry.get("listable")),
            )
            entry = _merge_existing_catalog_metadata(
                entry,
                existing_entry,
                bundled_in_app=None,
                cohort_buckets=None,
            )
            if "sourceVariant" in existing_entry:
                entry["sourceVariant"] = existing_entry["sourceVariant"]
            existing_by_id[session_id] = entry
        manifest = _write_catalog_levels(list(existing_by_id.values()), previous_manifest)
    return {
        "catalogRevision": manifest["catalogRevision"],
        "refreshedLevels": normalized_ids,
    }


def approve_level_for_catalog(
    session_id: str,
    variant: str = "gemini",
    *,
    bundled_in_app: bool | None = None,
    cohort_buckets: list[Any] | None = None,
    request_id: str | None = None,
) -> dict:
    """Register a reviewed full package in the production catalog without live-listing it."""
    _validate_session_id_or_raise(session_id)
    previewed_locally = _bundled_manifest_contains_level(session_id)
    request_signature = _catalog_approval_signature(
        session_id=session_id,
        variant=variant,
        bundled_in_app=bundled_in_app,
        cohort_buckets=cohort_buckets,
    )

    with _catalog_lock:
        if request_id is not None:
            previous_request = _CATALOG_APPROVAL_REQUESTS.get(request_id)
            if previous_request is not None:
                if previous_request.get("signature") != request_signature:
                    raise CatalogApprovalConflict("Catalog approval request id was already used for a different package request.")
                result = previous_request.get("result")
                if isinstance(result, dict):
                    return result
                raise CatalogApprovalConflict("Catalog approval request is already in progress.")
            _CATALOG_APPROVAL_REQUESTS[request_id] = {"signature": request_signature}

        staging_root = GAME_PUBLIC_LEVELS / f".catalog-staging-{session_id}-{uuid.uuid4().hex}"
        backup: Path | None = None
        try:
            export_result = export_to_game(
                session_id,
                variant=variant,
                update_preview_manifest=False,
                update_preview_variant=False,
                destination_root=staging_root,
            )
            previous_manifest = load_catalog_manifest()
            _, catalog_revision = _next_catalog_revision(previous_manifest)
            existing_by_id = _catalog_levels_by_id(previous_manifest)
            existing_entry = existing_by_id.get(session_id)
            entry = PublicLevels.public_level_catalog_entry(
                staging_root,
                session_id,
                catalog_revision=catalog_revision,
                bundled_in_app=bool(bundled_in_app) if bundled_in_app is not None else bool(existing_entry and existing_entry.get("bundledInApp")),
                cohort_buckets=cohort_buckets if cohort_buckets is not None else (existing_entry.get("cohortBuckets") if existing_entry else None),
            )
            entry["sourceVariant"] = export_result["variant"]
            content_revision = export_result.get("contentRevision")
            if isinstance(content_revision, str):
                retained = _retain_immutable_package_revision(session_id, staging_root, content_revision)
                entry["contentRevision"] = content_revision
                entry["retainedPackagePath"] = retained.relative_to(GAME_PUBLIC_LEVELS).as_posix()
            existing_by_id[session_id] = _merge_existing_catalog_metadata(
                entry,
                existing_entry,
                bundled_in_app=bundled_in_app,
                cohort_buckets=cohort_buckets,
            )
            backup = _replace_public_package_from_staging(session_id, staging_root)
            try:
                manifest = _write_catalog_levels(list(existing_by_id.values()), previous_manifest)
            except Exception:
                _restore_public_package_backup(session_id, backup)
                raise
            _cleanup_package_backup(backup)
            if previewed_locally:
                _refresh_bundled_manifest_level_if_present(session_id)
                update_session_field(session_id, exported_variant=export_result["variant"])
            entry = _catalog_levels_by_id(manifest)[session_id]
            result = {**export_result, "catalogRevision": manifest["catalogRevision"], "catalogEntry": entry}
            if request_id is not None:
                _remember_catalog_approval_result(request_id, request_signature, result)
            return result
        except Exception:
            if request_id is not None:
                pending = _CATALOG_APPROVAL_REQUESTS.get(request_id)
                if pending is not None and "result" not in pending:
                    del _CATALOG_APPROVAL_REQUESTS[request_id]
            raise
        finally:
            if staging_root.exists():
                shutil.rmtree(staging_root)


def list_catalog_candidates(*, include_tombstoned: bool = False) -> list[dict]:
    """Return levels that a global V1 sequence draft may select from the catalog."""
    manifest = load_catalog_manifest()
    levels = manifest.get("levels") if isinstance(manifest, dict) else []
    candidates = []
    for level in levels or []:
        if not isinstance(level, dict):
            continue
        if level.get("allCohortAvailable") is not True:
            continue
        if level.get("listable") is True:
            candidates.append(level)
            continue
        if include_tombstoned and level.get("tombstonedAt") is not None:
            candidates.append(level)
    return sorted(candidates, key=lambda item: item["id"])


def update_catalog_retention(
    session_id: str,
    *,
    active_sequence_versions: list[str] | None = None,
    rollback_sequence_versions: list[str] | None = None,
) -> dict:
    """Update sequence-retention metadata for a catalog entry without bumping catalogRevision."""
    _validate_session_id_or_raise(session_id)
    with _catalog_lock:
        manifest = load_catalog_manifest()
        levels_by_id = _catalog_levels_by_id(manifest)
        entry = levels_by_id.get(session_id)
        if entry is None:
            raise ValueError(f"Catalog entry not found: {session_id}")
        entry = {
            **entry,
            "retention": {
                "activeSequenceVersions": sorted(active_sequence_versions or []),
                "rollbackEligibleSequenceVersions": sorted(rollback_sequence_versions or []),
            },
        }
        levels_by_id[session_id] = entry
        next_manifest = {
            **(manifest or {"version": 1, "revisionNumber": 0, "catalogRevision": "catalog-unavailable"}),
            "generatedAt": PublicLevels.utc_now_iso(),
            "levels": [levels_by_id[level_id] for level_id in sorted(levels_by_id)],
        }
        save_catalog_manifest(next_manifest)
        save_catalog_snapshot(next_manifest)
    return _catalog_levels_by_id(next_manifest)[session_id]


def update_catalog_retention_for_activation_versions(active_version: str, versions: list[dict[str, Any]]) -> dict:
    """Project activation ledger retention into catalog metadata without changing catalogRevision."""
    active_by_level: dict[str, set[str]] = {}
    rollback_by_level: dict[str, set[str]] = {}
    for version in versions:
        sequence_version = version.get("sequenceVersion")
        if not isinstance(sequence_version, str):
            continue
        level_ids = [level_id for level_id in version.get("levelIds") or [] if isinstance(level_id, str)]
        if sequence_version == active_version:
            for level_id in level_ids:
                active_by_level.setdefault(level_id, set()).add(sequence_version)
        if version.get("rollbackEligible") is True and sequence_version != active_version:
            for level_id in level_ids:
                rollback_by_level.setdefault(level_id, set()).add(sequence_version)

    with _catalog_lock:
        manifest = load_catalog_manifest()
        levels_by_id = _catalog_levels_by_id(manifest)
        for level_id, entry in list(levels_by_id.items()):
            active_versions = sorted(active_by_level.get(level_id, set()))
            rollback_versions = sorted(rollback_by_level.get(level_id, set()))
            levels_by_id[level_id] = {
                **entry,
                "retention": {
                    "activeSequenceVersions": active_versions,
                    "rollbackEligibleSequenceVersions": rollback_versions,
                },
            }
        next_manifest = {
            **(manifest or {"version": 1, "revisionNumber": 0, "catalogRevision": "catalog-unavailable"}),
            "generatedAt": PublicLevels.utc_now_iso(),
            "levels": [levels_by_id[level_id] for level_id in sorted(levels_by_id)],
        }
        save_catalog_manifest(next_manifest)
        save_catalog_snapshot(next_manifest)
        return next_manifest


def tombstone_catalog_level(session_id: str, *, reason: str = "") -> dict:
    """Mark a catalog entry unlistable while retaining package assets on disk."""
    _validate_session_id_or_raise(session_id)
    with _catalog_lock:
        previous_manifest = load_catalog_manifest()
        levels_by_id = _catalog_levels_by_id(previous_manifest)
        entry = levels_by_id.get(session_id)
        if entry is None:
            raise ValueError(f"Catalog entry not found: {session_id}")
        tombstoned_entry = {
            **entry,
            "listable": False,
            "tombstonedAt": PublicLevels.utc_now_iso(),
            "tombstoneReason": reason,
        }
        levels_by_id[session_id] = tombstoned_entry
        manifest = _write_catalog_levels(list(levels_by_id.values()), previous_manifest)
    return {
        "levelId": session_id,
        "assetsRetained": (GAME_PUBLIC_LEVELS / session_id / "level.json").exists(),
        "catalogRevision": manifest["catalogRevision"],
        "catalogEntry": _catalog_levels_by_id(manifest)[session_id],
    }


def _levels_index_entry_from_manifest_level(level: dict) -> dict:
    level_id = level.get("id")
    level_json = ((level.get("assets") or {}).get("levelJson") or {}).get("path")
    return {
        "id": level_id,
        "name": level.get("name", level_id),
        "jsonPath": level_json or f"levels/{level_id}/level.json",
    }


def reorder_bundled_manifest(ids_in_order: list[str]) -> dict:
    """Reorder the `levels` array of bundled-manifest.json to match the
    supplied id order. Levels whose id isn't in the supplied list are
    dropped (they won't ship). Levels whose id is in the supplied list
    but not in the current manifest are silently skipped (no new-level
    creation via reorder). Also keeps the legacy levels-index.json in
    the same order so validators can catch future drift. Returns the
    updated manifest."""
    for sid in ids_in_order:
        _validate_session_id_or_raise(sid)
    with _session_lock:
        manifest = load_bundled_manifest() or {}
        levels = manifest.get("levels") or []
        by_id = {e.get("id"): e for e in levels if e.get("id")}
        reordered = [by_id[i] for i in ids_in_order if i in by_id]
        manifest["levels"] = reordered
        manifest["generatedAt"] = PublicLevels.utc_now_iso()
        save_bundled_manifest(manifest)
        index = load_levels_index()
        index_by_id = {e.get("id"): e for e in index if e.get("id")}
        save_levels_index([
            index_by_id.get(level["id"], _levels_index_entry_from_manifest_level(level))
            for level in reordered
        ])
        return manifest


def load_levels_index() -> list[dict]:
    """Return the current levels-index.json contents (or empty list)."""
    return PublicLevels.load_levels_index(GAME_PUBLIC_LEVELS)


def save_levels_index(entries: list[dict]) -> None:
    """Overwrite levels-index.json atomically with the given ordered entries."""
    PublicLevels.save_levels_index(GAME_PUBLIC_LEVELS, entries)


def reorder_levels_index(ids_in_order: list[str]) -> list[dict]:
    """Reorder levels-index.json to match the supplied id order. Any
    existing entries whose id is not in the supplied list are dropped
    (they won't appear in-game). Returns the new ordered list.

    Held under `_session_lock` \u2014 concurrent export/revoke/reorder
    requests all serialize against this lock so the read-modify-write
    sequence can't interleave and truncate the index."""
    for sid in ids_in_order:
        _validate_session_id_or_raise(sid)
    with _session_lock:
        current = load_levels_index()
        by_id = {e["id"]: e for e in current if "id" in e}
        ordered = [by_id[i] for i in ids_in_order if i in by_id]
        save_levels_index(ordered)
        return ordered


_SESSION_ID_RE = re.compile(r"^[a-z0-9_-]{3,120}$")


def clear_incomplete_sessions(protect_exported: bool = True) -> dict:
    """Hard-delete session directories that never completed: no color.png,
    no openai_color*.png, no hitboxes.json. Typical cause is a timed-out
    batch run — the UI leaves session.json + bg_00.png on disk and no
    way for the user to finish them.

    `protect_exported=True` skips any session that has a live entry in
    public/levels/ (defence-in-depth — should be impossible since exported
    sessions always have color.png, but the extra check is cheap).
    """
    deleted: list[str] = []
    skipped: list[str] = []
    for d in sorted(LEVELS_DIR.iterdir()):
        if not d.is_dir():
            continue
        has_session = (d / "session.json").exists()
        has_color = (
            (d / "color.png").exists()
            or (d / "openai_color.png").exists()
            or (d / "openai_color_v2.png").exists()
        )
        has_hitboxes = (d / "hitboxes.json").exists()
        if not has_session:
            continue
        if has_color or has_hitboxes:
            continue
        if protect_exported and (GAME_PUBLIC_LEVELS / d.name / "level.json").exists():
            skipped.append(d.name)
            continue
        try:
            _validate_session_id_or_raise(d.name)
        except ValueError:
            skipped.append(d.name)
            continue
        shutil.rmtree(d)
        deleted.append(d.name)
    return {"deleted": deleted, "skipped": skipped, "count": len(deleted)}


def _validate_session_id_or_raise(session_id: str) -> None:
    """Defence-in-depth guard: every helper that touches disk paths keyed
    on a session id must call this. Prevents a future route that forgets
    the route-layer regex from turning into a path-traversal rm-rf."""
    if not isinstance(session_id, str) or not _SESSION_ID_RE.match(session_id):
        raise ValueError(f"Invalid session id: {session_id!r}")


def set_archived(session_id: str, archived: bool, variant: str | None = None) -> None:
    """Mark / unmark a variant as archived. Each variant card in the
    Gallery is independently archivable; the archived state lives as a
    list of variant slugs on the session. When `variant` is None the
    entire session is flagged (legacy, fallback).

    Unarchive semantics MUST clear both bits:
      * the per-variant entry in `archived_variants`
      * the session-wide `archived` flag (legacy),
    because the UI treats either bit as "archived" and wouldn't otherwise
    be able to un-stick a card whose session was archived under the
    session-wide scheme before we moved to per-variant.

    Source on disk is never touched \u2014 this is a soft-delete."""
    _validate_session_id_or_raise(session_id)
    with _session_lock:
        raw = load_session_raw(session_id)
        if raw is None:
            return
        if variant is None:
            raw["archived"] = bool(archived)
            if not archived:
                # Clear legacy per-variant list too so the whole session
                # is fully restored.
                raw["archived_variants"] = []
        else:
            current = set(raw.get("archived_variants") or [])
            if archived:
                current.add(variant)
            else:
                current.discard(variant)
                # Downgrade any residual session-wide archive: user is
                # saying "this card is NOT archived," so the umbrella
                # flag can't be left on.
                if raw.get("archived"):
                    raw["archived"] = False
            raw["archived_variants"] = sorted(current)
        save_session(session_id, raw)
        _record_archive_state(
            session_id,
            archived=bool(raw.get("archived", False)),
            variants=list(raw.get("archived_variants") or []),
        )


def revoke_export(session_id: str) -> dict:
    """Remove a level from local preview while preserving catalog-uploaded assets."""
    _validate_session_id_or_raise(session_id)
    dst = GAME_PUBLIC_LEVELS / session_id
    catalog_entry = _catalog_level_entry(session_id)
    preserve_public_assets = catalog_entry is not None
    with _session_lock:
        removed_dir = dst.exists() and not preserve_public_assets
        if removed_dir:
            shutil.rmtree(dst)
        current = load_levels_index()
        new_index = [e for e in current if e.get("id") != session_id]
        if len(new_index) != len(current):
            save_levels_index(new_index)
        manifest = load_bundled_manifest() or {}
        levels = manifest.get("levels") or []
        new_levels = [e for e in levels if e.get("id") != session_id]
        if len(new_levels) != len(levels):
            manifest["levels"] = new_levels
            manifest["generatedAt"] = PublicLevels.utc_now_iso()
            save_bundled_manifest(manifest)
    return {"levelId": session_id, "removed": removed_dir, "assetsRetained": bool(preserve_public_assets and dst.exists())}
