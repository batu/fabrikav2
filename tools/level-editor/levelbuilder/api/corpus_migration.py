"""Deterministic, journaled migration of legacy bird sessions to canonical revisions."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageChops, ImageStat

from .canonical_bird_contract import CanonicalReadState, CanonicalRevisionStore, validate_snapshot

MigrationAction = Literal["migrate", "unchanged", "quarantine", "skip_archived", "frozen_public"]
RESTORE_FRAME_MAE_LIMIT = 5.0
RESTORE_LOCAL_MAE_LIMIT = 15.0


@dataclass(frozen=True)
class LevelMigrationPlan:
    level_id: str
    action: MigrationAction
    issues: tuple[str, ...]
    snapshot: dict[str, Any] | None = None
    restore_source: str | None = None

    def summary(self) -> dict[str, Any]:
        return {
            "levelId": self.level_id,
            "action": self.action,
            "issues": list(self.issues),
            "restoreSource": self.restore_source,
        }


def _json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _asset(root: Path, path: Path) -> dict[str, Any]:
    payload = path.read_bytes()
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
    }


def _review_history(session_dir: Path, public_dir: Path | None) -> list[dict[str, Any]]:
    history = []
    for kind, filename in (("hitboxes", "hitbox-review.json"), ("finalCutouts", "golden-review.json")):
        for root in (session_dir, public_dir):
            if root is None:
                continue
            assertion = _json(root / filename)
            if isinstance(assertion, dict) and (assertion.get("approved") is True or assertion.get("blessed") is True):
                history.append({
                    "kind": kind,
                    "assertion": assertion,
                    "source": "legacy-migration",
                    "verificationRequired": True,
                })
                break
    return history


def _candidate_restore(session_dir: Path, public_dir: Path | None, selected_bg: int) -> Path | None:
    if public_dir is not None:
        for name in ("bg_00.png", "bg_00.webp"):
            candidate = public_dir / name
            if candidate.is_file():
                return candidate
    candidate = session_dir / f"bg_{selected_bg:02d}.png"
    return candidate if candidate.is_file() else None


def _mean_absolute_difference(first: Image.Image, second: Image.Image) -> float:
    return sum(ImageStat.Stat(ImageChops.difference(first.convert("RGB"), second.convert("RGB"))).mean) / 3


def _canonical_pixel_issues(
    session_dir: Path,
    snapshot: dict[str, Any],
    *,
    restore_override: Path | None = None,
) -> list[str]:
    issues: list[str] = []
    try:
        scene = session_dir / snapshot["assets"]["scene"]["path"]
        clean = session_dir / snapshot["assets"]["cleanBackground"]["path"]
        restore = restore_override or session_dir / snapshot["restore"]["asset"]["path"]
        for label, path, descriptor in (
            ("scene", scene, snapshot["assets"]["scene"]),
            ("clean_background", clean, snapshot["assets"]["cleanBackground"]),
            ("restore", restore, snapshot["restore"]["asset"]),
        ):
            payload = path.read_bytes()
            if len(payload) != descriptor["bytes"] or hashlib.sha256(payload).hexdigest() != descriptor["sha256"]:
                issues.append(f"{label}_asset_hash_mismatch")
        if issues:
            return issues
        with Image.open(scene) as scene_image, Image.open(clean) as clean_image, Image.open(restore) as restore_image:
            if scene_image.size != clean_image.size or scene_image.size != restore_image.size:
                return ["restore_dimensions_mismatch"]
            preview_size = (256, 256)
            frame_mae = _mean_absolute_difference(
                clean_image.resize(preview_size), restore_image.resize(preview_size),
            )
            if frame_mae > RESTORE_FRAME_MAE_LIMIT:
                issues.append(f"restore_scene_mismatch:{frame_mae:.2f}")
            for bird in snapshot["birds"]:
                cleanup = bird["cleanup"]
                box = (
                    cleanup["x"], cleanup["y"],
                    cleanup["x"] + cleanup["width"], cleanup["y"] + cleanup["height"],
                )
                local_mae = _mean_absolute_difference(clean_image.crop(box), restore_image.crop(box))
                if local_mae > RESTORE_LOCAL_MAE_LIMIT:
                    issues.append(f"{bird['birdId']}:restore_residue_outlier:{local_mae:.2f}")
    except (KeyError, OSError, TypeError, ValueError):
        issues.append("canonical_asset_validation_failed")
    return issues


def plan_legacy_level(
    session_dir: Path | None,
    public_dir: Path | None,
    *,
    archived: bool,
) -> LevelMigrationPlan:
    level_id = (session_dir or public_dir).name  # type: ignore[union-attr]
    if archived:
        return LevelMigrationPlan(level_id, "skip_archived", ())
    if session_dir is None:
        return LevelMigrationPlan(level_id, "frozen_public", ("public_only_requires_explicit_import",))
    read = CanonicalRevisionStore(session_dir).read(inspect_quarantined_source=True)
    if read.state is CanonicalReadState.VALID_CURRENT:
        pixel_issues = _canonical_pixel_issues(session_dir, read.snapshot)
        if pixel_issues:
            return LevelMigrationPlan(level_id, "quarantine", tuple(sorted(pixel_issues)))
        return LevelMigrationPlan(level_id, "unchanged", ())
    if read.state is not CanonicalReadState.MIGRATION_REQUIRED:
        return LevelMigrationPlan(level_id, "quarantine", (f"canonical_{read.state.value}",))

    issues: list[str] = []
    raw = _json(session_dir / "session.json", {})
    hitboxes = _json(session_dir / "hitboxes.json", [])
    dogs = raw.get("dogs") if isinstance(raw, dict) else None
    if not isinstance(hitboxes, list) or not hitboxes:
        issues.append("missing_hitboxes")
    if not isinstance(dogs, list) or not dogs:
        issues.append("missing_session_dogs")
    scene = session_dir / "color.png"
    if not scene.is_file():
        issues.append("missing_scene")
    selected_bg = int(raw.get("selected_bg") or 0) if isinstance(raw, dict) else 0
    clean = session_dir / f"bg_{selected_bg:02d}.png"
    if not clean.is_file():
        issues.append("missing_clean_background")
    restore = _candidate_restore(session_dir, public_dir, selected_bg)
    if restore is None:
        issues.append("missing_restore")
    if issues:
        return LevelMigrationPlan(level_id, "quarantine", tuple(sorted(issues)))

    hitboxes_by_id = {
        str(item.get("id")): item for item in hitboxes
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
    }
    dogs_by_id = {
        str(item.get("id")): item for item in dogs
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
    }
    if len(hitboxes_by_id) != len(hitboxes):
        issues.append("missing_or_duplicate_hitbox_ids")
    if len(dogs_by_id) != len(dogs):
        issues.append("missing_or_duplicate_dog_ids")
    if set(hitboxes_by_id) != set(dogs_by_id):
        issues.append("bird_id_set_mismatch")
    if issues:
        return LevelMigrationPlan(level_id, "quarantine", tuple(sorted(issues)))

    scene_asset = _asset(session_dir, scene)
    clean_asset = _asset(session_dir, clean)
    birds: list[dict[str, Any]] = []
    for order, hitbox in enumerate(hitboxes):
        bird_id = str(hitbox["id"])
        dog = dogs_by_id[bird_id]
        index = dog.get("index")
        variant = dog.get("activeVariant")
        if not isinstance(index, int) or index < 0:
            issues.append(f"{bird_id}:invalid_compatibility_slot")
            continue
        if not isinstance(variant, int) or variant < 0:
            issues.append(f"{bird_id}:missing_active_variant")
            continue
        dog_dir = session_dir / "dogs" / f"dog_{index:02d}"
        sprite_path = dog_dir / f"sprite_{variant:03d}.png"
        sidecar = _json(sprite_path.with_suffix(".json"), {})
        sprite_box = sidecar.get("spriteBox") if isinstance(sidecar, dict) else None
        cleanup_box = sidecar.get("cleanupBox") if isinstance(sidecar, dict) else None
        if not sprite_path.is_file() or not isinstance(sprite_box, list) or len(sprite_box) != 4:
            issues.append(f"{bird_id}:missing_sprite_projection")
            continue
        if not isinstance(cleanup_box, list) or len(cleanup_box) != 4:
            issues.append(f"{bird_id}:missing_cleanup_projection")
            continue
        sx0, sy0, sx1, sy1 = map(int, sprite_box)
        cx0, cy0, cx1, cy1 = map(int, cleanup_box)
        x, y = int(hitbox["x"]), int(hitbox["y"])
        if sx1 <= sx0 or sy1 <= sy0:
            issues.append(f"{bird_id}:invalid_sprite_box")
            continue
        if cx1 <= cx0 or cy1 <= cy0 or not (cx0 <= x <= cx1 and cy0 <= y <= cy1):
            issues.append(f"{bird_id}:cleanup_misses_hitbox")
            continue
        sprite_asset = _asset(session_dir, sprite_path)
        birds.append({
            "birdId": bird_id,
            "compatibilitySlot": f"dog_{index:02d}",
            "presentationOrder": order,
            "hitbox": {"x": x, "y": y, "r": int(hitbox.get("r", hitbox.get("radius", 30)))},
            "activeGeneration": {
                "generationId": f"legacy:{index}:{variant}",
                "inputSceneSha256": scene_asset["sha256"],
            },
            "sprite": {
                "asset": sprite_asset,
                "placement": {"x": sx0, "y": sy0, "width": sx1 - sx0, "height": sy1 - sy0},
                "anchorX": float(sidecar.get("anchorX", 0.5)),
                "anchorY": float(sidecar.get("anchorY", 0.5)),
                "flipX": sidecar.get("flipX") is True,
                "flipY": sidecar.get("flipY") is True,
            },
            "cleanup": {
                "x": cx0, "y": cy0, "width": cx1 - cx0, "height": cy1 - cy0,
                "sourceSpriteSha256": sprite_asset["sha256"],
            },
        })
    if issues or len(birds) != len(hitboxes):
        return LevelMigrationPlan(level_id, "quarantine", tuple(sorted(set(issues))))
    try:
        with Image.open(scene) as scene_image, Image.open(restore) as restore_image:
            if scene_image.size != restore_image.size:
                issues.append("restore_dimensions_mismatch")
    except OSError:
        issues.append("unreadable_scene_or_restore")
    if issues:
        return LevelMigrationPlan(level_id, "quarantine", tuple(sorted(issues)))

    restore_relative = restore.relative_to(session_dir).as_posix() if restore.is_relative_to(session_dir) else None
    restore_asset = _asset(session_dir, restore) if restore_relative is not None else {
        "path": f".canonical/imported-assets/restore{restore.suffix.lower()}",
        "sha256": hashlib.sha256(restore.read_bytes()).hexdigest(),
        "bytes": restore.stat().st_size,
    }
    snapshot = validate_snapshot({
        "schemaVersion": 1,
        "sessionId": level_id,
        "assets": {"scene": scene_asset, "cleanBackground": clean_asset},
        "restore": {"asset": restore_asset, "sourceSceneSha256": scene_asset["sha256"]},
        "birds": birds,
        "reviews": {},
        "operational": {
            "migration": {"state": "verification_required", "source": "legacy-v1"},
            "reviewHistory": _review_history(session_dir, public_dir),
        },
    })
    pixel_issues = _canonical_pixel_issues(session_dir, snapshot, restore_override=restore)
    if pixel_issues:
        return LevelMigrationPlan(level_id, "quarantine", tuple(sorted(pixel_issues)))
    return LevelMigrationPlan(
        level_id, "migrate", (), snapshot=snapshot,
        restore_source=str(restore) if restore_relative is None else None,
    )


def checksum_tree(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*")) if path.is_file()
    }


def plan_corpus(
    source_root: Path,
    public_root: Path,
    *,
    archived_ids: set[str],
) -> list[LevelMigrationPlan]:
    source_ids = {
        path.name for path in source_root.iterdir()
        if path.is_dir() and ((path / "session.json").is_file() or (path / ".canonical").is_dir())
    } if source_root.is_dir() else set()
    public_ids = {
        path.name for path in public_root.iterdir()
        if path.is_dir() and (path / "level.json").is_file()
    } if public_root.is_dir() else set()
    return [
        plan_legacy_level(
            source_root / level_id if level_id in source_ids else None,
            public_root / level_id if level_id in public_ids else None,
            archived=level_id in archived_ids,
        )
        for level_id in sorted(source_ids | public_ids | archived_ids)
    ]


def plan_manifest(plans: list[LevelMigrationPlan]) -> dict[str, Any]:
    summaries = [plan.summary() for plan in plans]
    digest = hashlib.sha256(
        json.dumps(summaries, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {"schemaVersion": 1, "manifestSha256": f"sha256:{digest}", "levels": summaries}


def apply_level_plan(plan: LevelMigrationPlan, session_dir: Path, journal_root: Path) -> dict[str, Any]:
    journal_root.mkdir(parents=True, exist_ok=True)
    journal_path = journal_root / f"{plan.level_id}.json"
    if journal_path.is_file():
        previous = _json(journal_path)
        if (
            isinstance(previous, dict)
            and previous.get("action") == plan.action
            and previous.get("issues") == list(plan.issues)
        ):
            return previous
    before = checksum_tree(session_dir)
    result = {"levelId": plan.level_id, "action": plan.action, "issues": list(plan.issues), "before": before}
    if plan.action == "migrate" and plan.snapshot is not None:
        if plan.restore_source is not None:
            source = Path(plan.restore_source)
            destination = session_dir / plan.snapshot["restore"]["asset"]["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(f".{destination.name}.tmp-{uuid.uuid4().hex}")
            shutil.copy2(source, temporary)
            os.replace(temporary, destination)
        pointer = CanonicalRevisionStore(session_dir).commit(plan.snapshot, expected_content_revision=None)
        result["contentRevision"] = pointer.content_revision
    elif plan.action == "quarantine":
        root = session_dir / ".canonical"
        root.mkdir(parents=True, exist_ok=True)
        temporary = root / f"quarantine.tmp-{uuid.uuid4().hex}.json"
        temporary.write_text(json.dumps({"schemaVersion": 1, "issues": list(plan.issues)}, indent=2) + "\n")
        os.replace(temporary, root / "quarantine.json")
    result["after"] = checksum_tree(session_dir)
    temporary_journal = journal_path.with_suffix(".tmp")
    temporary_journal.write_text(json.dumps(result, indent=2) + "\n")
    os.replace(temporary_journal, journal_path)
    return result
