"""Deterministic, journaled migration of legacy bird sessions to canonical revisions."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageChops, ImageStat

from .canonical_bird_contract import (
    CanonicalReadResult,
    CanonicalReadState,
    CanonicalRevisionStore,
    invalidate_reviews,
    validate_snapshot,
)

MigrationAction = Literal["migrate", "unchanged", "quarantine", "skip_archived", "frozen_public"]
RESTORE_FRAME_MAE_LIMIT = 5.0
RESTORE_LOCAL_MAE_LIMIT = 15.0
MAX_SPRITE_BIND_DISTANCE_DIAGONALS = 0.75
MIN_SPRITE_BIND_MARGIN = 15.0


@dataclass(frozen=True)
class LevelMigrationPlan:
    level_id: str
    action: MigrationAction
    issues: tuple[str, ...]
    snapshot: dict[str, Any] | None = None
    restore_source: str | None = None
    # Set when the plan replaces the CURRENT canonical revision (stale-restore
    # refresh) instead of migrating a legacy level; apply commits CAS-bound to
    # this revision so concurrent edits are never clobbered.
    expected_content_revision: str | None = None

    def summary(self) -> dict[str, Any]:
        return {
            "levelId": self.level_id,
            "action": self.action,
            "issues": list(self.issues),
            "restoreSource": self.restore_source,
        }


class CleanupIdentityRepairError(ValueError):
    """Raised when cleanup geometry cannot prove one unambiguous bird binding."""


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex}")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temporary, path)


def restore_verified_legacy_hitbox_review(
    session_dir: Path,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Promote an exact legacy hitbox assertion into canonical review state.

    Migration retained old approvals as history, but canonical reads quite
    correctly ignored that history.  Promotion is safe only when the current
    authoring hitboxes are byte-semantically identical to the human-reviewed
    snapshot and contain the same stable bird IDs as the canonical revision.
    """
    store = CanonicalRevisionStore(session_dir)
    current = store.read()
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None or current.pointer is None:
        return {"levelId": session_dir.name, "restored": False, "reason": "canonical_not_current"}
    if isinstance(current.snapshot.get("reviews", {}).get("hitboxes"), dict):
        return {"levelId": session_dir.name, "restored": False, "reason": "already_reviewed"}

    history = current.snapshot.get("operational", {}).get("reviewHistory", [])
    historical = next((
        item for item in reversed(history)
        if isinstance(item, dict) and item.get("kind") == "hitboxes"
        and isinstance(item.get("assertion"), dict)
        and item["assertion"].get("approved") is True
    ), None)
    if historical is None:
        return {"levelId": session_dir.name, "restored": False, "reason": "no_historical_approval"}
    assertion = historical["assertion"]
    reviewed_at = assertion.get("reviewedAt")
    stored_digest = assertion.get("hitboxesSha256")
    hitboxes = _json(session_dir / "hitboxes.json", [])
    if not isinstance(reviewed_at, str) or not reviewed_at:
        return {"levelId": session_dir.name, "restored": False, "reason": "missing_review_timestamp"}
    if not isinstance(hitboxes, list) or not hitboxes:
        return {"levelId": session_dir.name, "restored": False, "reason": "missing_hitboxes"}
    current_digest = hashlib.sha256(
        json.dumps(hitboxes, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    if stored_digest != current_digest:
        return {"levelId": session_dir.name, "restored": False, "reason": "hitbox_hash_mismatch"}
    if assertion.get("hitboxCount") not in (None, len(hitboxes)):
        return {"levelId": session_dir.name, "restored": False, "reason": "hitbox_count_mismatch"}
    hitbox_ids = {item.get("id") for item in hitboxes if isinstance(item, dict)}
    canonical_ids = {bird["birdId"] for bird in current.snapshot["birds"]}
    if len(hitbox_ids) != len(hitboxes) or hitbox_ids != canonical_ids:
        return {"levelId": session_dir.name, "restored": False, "reason": "bird_id_set_mismatch"}

    from .canonical_bird_contract import bless_snapshot

    restored = bless_snapshot(
        current.snapshot,
        review_kind="hitboxes",
        reviewer="human:legacy-verified",
        reviewed_at=reviewed_at,
    )
    if dry_run:
        return {
            "levelId": session_dir.name,
            "restored": False,
            "eligible": True,
            "reason": "exact_historical_approval",
            "reviewedAt": reviewed_at,
        }
    pointer = store.commit(
        restored,
        expected_content_revision=current.pointer.content_revision,
        expected_operational_revision=current.pointer.operational_revision,
    )
    return {
        "levelId": session_dir.name,
        "restored": True,
        "contentRevision": pointer.content_revision,
        "reviewedAt": reviewed_at,
    }


def restore_verified_legacy_final_cutout_review(
    session_dir: Path,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Promote an unchanged legacy final-cutout assertion after migration."""
    store = CanonicalRevisionStore(session_dir)
    current = store.read()
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None or current.pointer is None:
        return {"levelId": session_dir.name, "restored": False, "reason": "canonical_not_current"}
    reviews = current.snapshot.get("reviews", {})
    if isinstance(reviews.get("finalCutouts"), dict):
        return {"levelId": session_dir.name, "restored": False, "reason": "already_reviewed"}
    if not isinstance(reviews.get("hitboxes"), dict):
        return {"levelId": session_dir.name, "restored": False, "reason": "hitboxes_not_reviewed"}

    history = current.snapshot.get("operational", {}).get("reviewHistory", [])
    historical = next((
        item for item in reversed(history)
        if isinstance(item, dict) and item.get("kind") == "finalCutouts"
        and isinstance(item.get("assertion"), dict)
        and item["assertion"].get("approved") is True
    ), None)
    if historical is None:
        return {"levelId": session_dir.name, "restored": False, "reason": "no_historical_approval"}
    assertion = historical["assertion"]
    reviewed_at = assertion.get("reviewedAt")
    level_path = session_dir / "level.json"
    if not isinstance(reviewed_at, str) or not reviewed_at:
        return {"levelId": session_dir.name, "restored": False, "reason": "missing_review_timestamp"}
    if not level_path.is_file() or assertion.get("levelSha256") != hashlib.sha256(level_path.read_bytes()).hexdigest():
        return {"levelId": session_dir.name, "restored": False, "reason": "level_hash_mismatch"}
    if assertion.get("sceneSha256") != current.snapshot["assets"]["scene"]["sha256"]:
        return {"levelId": session_dir.name, "restored": False, "reason": "scene_hash_mismatch"}

    asserted_birds = assertion.get("birds")
    if not isinstance(asserted_birds, list) or len(asserted_birds) != len(current.snapshot["birds"]):
        return {"levelId": session_dir.name, "restored": False, "reason": "bird_count_mismatch"}
    canonical_by_slot = {bird["compatibilitySlot"]: bird for bird in current.snapshot["birds"]}
    for asserted in asserted_birds:
        if not isinstance(asserted, dict):
            return {"levelId": session_dir.name, "restored": False, "reason": "invalid_bird_assertion"}
        bird = canonical_by_slot.get(asserted.get("dogId"))
        if bird is None:
            return {"levelId": session_dir.name, "restored": False, "reason": "bird_slot_mismatch"}
        placement = bird["sprite"]["placement"]
        expected_box = [
            placement["x"], placement["y"],
            placement["x"] + placement["width"], placement["y"] + placement["height"],
        ]
        if asserted.get("spriteSha256") != bird["sprite"]["asset"]["sha256"]:
            return {"levelId": session_dir.name, "restored": False, "reason": "sprite_hash_mismatch"}
        if asserted.get("spriteBox") != expected_box:
            return {"levelId": session_dir.name, "restored": False, "reason": "sprite_placement_mismatch"}
        if bool(asserted.get("flipX", False)) != bird["sprite"]["flipX"] or bool(
            asserted.get("flipY", False)
        ) != bird["sprite"]["flipY"]:
            return {"levelId": session_dir.name, "restored": False, "reason": "sprite_flip_mismatch"}

    from .canonical_bird_contract import bless_snapshot

    restored = bless_snapshot(
        current.snapshot,
        review_kind="finalCutouts",
        reviewer="human:legacy-verified",
        reviewed_at=reviewed_at,
    )
    if dry_run:
        return {
            "levelId": session_dir.name,
            "restored": False,
            "eligible": True,
            "reason": "exact_historical_approval",
            "reviewedAt": reviewed_at,
        }
    pointer = store.commit(
        restored,
        expected_content_revision=current.pointer.content_revision,
        expected_operational_revision=current.pointer.operational_revision,
    )
    return {
        "levelId": session_dir.name,
        "restored": True,
        "contentRevision": pointer.content_revision,
        "reviewedAt": reviewed_at,
    }


def propose_cleanup_identity_repair(session_dir: Path) -> dict[str, Any]:
    """Prove a full slot-to-bird bijection from cleanup boxes and hitbox centers."""
    quarantine = _json(session_dir / ".canonical" / "quarantine.json", {})
    issues = quarantine.get("issues") if isinstance(quarantine, dict) else None
    cleanup_only = isinstance(issues, list) and bool(issues) and all(
        isinstance(issue, str) and issue.endswith(":cleanup_misses_hitbox")
        for issue in issues
    )
    bird_id_set_only = issues == ["bird_id_set_mismatch"]
    if not cleanup_only and not bird_id_set_only:
        raise CleanupIdentityRepairError(
            "repair requires a cleanup-only or bird-id-set quarantine"
        )

    raw = _json(session_dir / "session.json", {})
    hitboxes = _json(session_dir / "hitboxes.json", [])
    dogs = raw.get("dogs") if isinstance(raw, dict) else None
    if not isinstance(dogs, list) or not isinstance(hitboxes, list) or len(dogs) != len(hitboxes):
        raise CleanupIdentityRepairError("session dogs and reviewed hitboxes must have equal cardinality")
    hitbox_ids = [item.get("id") for item in hitboxes if isinstance(item, dict)]
    if len(hitbox_ids) != len(hitboxes) or any(not isinstance(value, str) or not value for value in hitbox_ids):
        raise CleanupIdentityRepairError("every hitbox must have a stable bird ID")
    if len(set(hitbox_ids)) != len(hitbox_ids):
        raise CleanupIdentityRepairError("hitbox bird IDs must be unique")

    bindings: list[dict[str, Any]] = []
    claimed: set[str] = set()
    exact = True
    sprite_evidence: list[dict[str, Any]] = []
    for dog in dogs:
        if not isinstance(dog, dict) or not isinstance(dog.get("index"), int):
            raise CleanupIdentityRepairError("every session dog must have a compatibility slot")
        index = dog["index"]
        variant = dog.get("activeVariant")
        if not isinstance(variant, int) or variant < 0:
            raise CleanupIdentityRepairError(f"dog_{index:02d} has no active sprite")
        sidecar = _json(session_dir / "dogs" / f"dog_{index:02d}" / f"sprite_{variant:03d}.json", {})
        cleanup = sidecar.get("cleanupBox") if isinstance(sidecar, dict) else None
        sprite_box = sidecar.get("spriteBox") if isinstance(sidecar, dict) else None
        if not isinstance(cleanup, list) or len(cleanup) != 4:
            raise CleanupIdentityRepairError(f"dog_{index:02d} has no cleanup box")
        if not isinstance(sprite_box, list) or len(sprite_box) != 4:
            raise CleanupIdentityRepairError(f"dog_{index:02d} has no sprite box")
        sx0, sy0, sx1, sy1 = map(int, sprite_box)
        if sx1 <= sx0 or sy1 <= sy0:
            raise CleanupIdentityRepairError(f"dog_{index:02d} has an invalid sprite box")
        sprite_evidence.append({
            "dog": dog,
            "index": index,
            "sidecarPath": sidecar,
            "spriteBox": [sx0, sy0, sx1, sy1],
            "cleanupBox": list(map(int, cleanup)),
            "center": ((sx0 + sx1) / 2, (sy0 + sy1) / 2),
            "diagonal": ((sx1 - sx0) ** 2 + (sy1 - sy0) ** 2) ** 0.5,
        })
        x0, y0, x1, y1 = map(int, cleanup)
        matches = [
            hitbox for hitbox in hitboxes
            if isinstance(hitbox, dict) and x0 <= int(hitbox["x"]) <= x1 and y0 <= int(hitbox["y"]) <= y1
        ]
        if len(matches) != 1:
            exact = False
            continue
        bird_id = str(matches[0]["id"])
        if bird_id in claimed:
            exact = False
            continue
        claimed.add(bird_id)
        bindings.append({
            "compatibilitySlot": f"dog_{index:02d}",
            "index": index,
            "oldBirdId": dog.get("id"),
            "birdId": bird_id,
        })
    if exact and claimed == set(hitbox_ids):
        return {
            "levelId": session_dir.name,
            "method": "cleanup-containment",
            "bindings": bindings,
            "issues": issues,
        }

    from scipy.optimize import linear_sum_assignment

    costs = [[
        ((evidence["center"][0] - float(hitbox["x"])) ** 2
         + (evidence["center"][1] - float(hitbox["y"])) ** 2) ** 0.5
        for hitbox in hitboxes
    ] for evidence in sprite_evidence]
    rows, columns = linear_sum_assignment(costs)
    if len(rows) != len(hitboxes):
        raise CleanupIdentityRepairError("sprite-to-hitbox assignment is incomplete")
    bindings = []
    weak: list[str] = []
    for row, column in zip(rows.tolist(), columns.tolist(), strict=True):
        evidence = sprite_evidence[row]
        hitbox = hitboxes[column]
        distance = costs[row][column]
        normalized = distance / max(1.0, evidence["diagonal"])
        alternatives = sorted(costs[row])
        margin = alternatives[1] - alternatives[0] if len(alternatives) > 1 else float("inf")
        if normalized > MAX_SPRITE_BIND_DISTANCE_DIAGONALS or margin < MIN_SPRITE_BIND_MARGIN:
            weak.append(
                f"dog_{evidence['index']:02d}(distance={distance:.1f},normalized={normalized:.3f},margin={margin:.1f})"
            )
        cx0, cy0, cx1, cy1 = evidence["cleanupBox"]
        hx, hy = int(hitbox["x"]), int(hitbox["y"])
        proposed_cleanup = None if cx0 <= hx <= cx1 and cy0 <= hy <= cy1 else [
            min(cx0, hx - 2), min(cy0, hy - 2), max(cx1, hx + 2), max(cy1, hy + 2),
        ]
        bindings.append({
            "compatibilitySlot": f"dog_{evidence['index']:02d}",
            "index": evidence["index"],
            "oldBirdId": evidence["dog"].get("id"),
            "birdId": str(hitbox["id"]),
            "distance": round(distance, 3),
            "normalizedDistance": round(normalized, 6),
            "margin": round(margin, 3),
            "proposedCleanupBox": proposed_cleanup,
        })
    if weak:
        raise CleanupIdentityRepairError("low-confidence global assignment: " + ", ".join(weak))
    return {
        "levelId": session_dir.name,
        "method": "sprite-center-hungarian",
        "bindings": bindings,
        "issues": issues,
    }


def repair_cleanup_identity_bindings(
    session_dir: Path,
    public_dir: Path | None,
    journal_root: Path,
    *,
    preserve_review_kinds: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """Rebind only proven identities, then create an unreviewed canonical revision."""
    proposal = propose_cleanup_identity_repair(session_dir)
    raw = _json(session_dir / "session.json", {})
    dogs = raw["dogs"]
    by_index = {binding["index"]: binding for binding in proposal["bindings"]}
    for dog in dogs:
        dog["id"] = by_index[dog["index"]]["birdId"]

    quarantine_path = session_dir / ".canonical" / "quarantine.json"
    quarantine_payload = quarantine_path.read_bytes()
    session_path = session_dir / "session.json"
    session_payload = session_path.read_bytes()
    level_path = session_dir / "level.json"
    level_payload = level_path.read_bytes() if level_path.is_file() else None
    sidecar_payloads: dict[Path, bytes] = {}
    history_path = session_dir / ".canonical" / "quarantine-history" / (
        hashlib.sha256(quarantine_payload).hexdigest() + ".json"
    )
    try:
        _atomic_json(session_path, raw)
        for binding in proposal["bindings"]:
            cleanup = binding.get("proposedCleanupBox")
            if cleanup is None:
                continue
            dog = next(item for item in dogs if item["index"] == binding["index"])
            sidecar_path = (
                session_dir / "dogs" / binding["compatibilitySlot"]
                / f"sprite_{dog['activeVariant']:03d}.json"
            )
            sidecar_payloads[sidecar_path] = sidecar_path.read_bytes()
            sidecar = json.loads(sidecar_payloads[sidecar_path])
            sidecar["cleanupBox"] = cleanup
            _atomic_json(sidecar_path, sidecar)
        history_path.parent.mkdir(parents=True, exist_ok=True)
        if not history_path.exists():
            history_path.write_bytes(quarantine_payload)
        quarantine_path.unlink()
        plan = plan_legacy_level(session_dir, public_dir, archived=False)
        if plan.action != "migrate" or plan.snapshot is None:
            raise CleanupIdentityRepairError(
                "rebound level did not pass migration: " + ", ".join(plan.issues)
            )
        if preserve_review_kinds:
            from .canonical_bird_contract import bless_snapshot

            snapshot = plan.snapshot
            history = {
                item["kind"]: item for item in snapshot["operational"].get("reviewHistory", [])
            }
            for kind in ("hitboxes", "finalCutouts"):
                if kind not in preserve_review_kinds:
                    continue
                assertion = history.get(kind, {}).get("assertion", {})
                reviewed_at = assertion.get("reviewedAt")
                if not isinstance(reviewed_at, str) or not reviewed_at:
                    raise CleanupIdentityRepairError(f"cannot preserve {kind} review without its timestamp")
                snapshot = bless_snapshot(
                    snapshot,
                    review_kind=kind,
                    reviewer="human:legacy-repair",
                    reviewed_at=reviewed_at,
                )
            plan = LevelMigrationPlan(
                plan.level_id,
                plan.action,
                plan.issues,
                snapshot=snapshot,
                restore_source=plan.restore_source,
            )
        applied = apply_level_plan(plan, session_dir, journal_root)
        level = _json(level_path, {})
        if not isinstance(level, dict):
            level = {}
        existing_by_slot = {
            f"dog_{index:02d}": dog for index, dog in enumerate(level.get("dogs", []))
            if isinstance(dog, dict)
        }
        projected = []
        for bird in sorted(plan.snapshot["birds"], key=lambda item: item["presentationOrder"]):
            dog = dict(existing_by_slot.get(bird["compatibilitySlot"], {}))
            dog.update({"id": bird["birdId"], **bird["hitbox"]})
            sprite = dict(dog.get("sprite") or {})
            sprite.update(bird["sprite"]["placement"])
            sprite["cleanup"] = {key: bird["cleanup"][key] for key in ("x", "y", "width", "height")}
            sprite.update({key: bird["sprite"][key] for key in ("anchorX", "anchorY", "flipX", "flipY")})
            dog["sprite"] = sprite
            dog["compatibilitySlot"] = bird["compatibilitySlot"]
            projected.append(dog)
        level["dogs"] = projected
        level["artifactRevision"] = applied["contentRevision"]
        level["compatibilityAliases"] = {
            bird["compatibilitySlot"]: bird["birdId"] for bird in plan.snapshot["birds"]
        }
        _atomic_json(level_path, level)
    except Exception:
        _atomic_json(session_path, json.loads(session_payload))
        if level_payload is None:
            level_path.unlink(missing_ok=True)
        else:
            _atomic_json(level_path, json.loads(level_payload))
        quarantine_path.parent.mkdir(parents=True, exist_ok=True)
        quarantine_path.write_bytes(quarantine_payload)
        for sidecar_path, payload in sidecar_payloads.items():
            _atomic_json(sidecar_path, json.loads(payload))
        raise
    return {
        **proposal,
        "contentRevision": applied["contentRevision"],
        "reviewRequired": not {"hitboxes", "finalCutouts"}.issubset(preserve_review_kinds),
        "preservedReviews": sorted(preserve_review_kinds),
        "quarantineHistory": history_path.relative_to(session_dir).as_posix(),
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


def _scene_matches_clean(
    scene_path: Path,
    clean_path: Path,
    cleanup_boxes: list[tuple[int, int, int, int]],
) -> bool:
    """True when the painted scene sits on this clean background: outside the
    birds' cleanup regions the two frames must agree within the restore frame
    limit. Guards the stale-public-restore fallback — a clean background
    unrelated to the scene must never be promoted to restore truth. The bird
    regions are masked out so the check stays independent of bird count."""
    try:
        with Image.open(scene_path) as scene_image, Image.open(clean_path) as clean_image:
            if scene_image.size != clean_image.size:
                return False
            width, height = scene_image.size
            scene_preview = scene_image.convert("RGB").copy()
            clean_preview = clean_image.convert("RGB")
            for x0, y0, x1, y1 in cleanup_boxes:
                box = (
                    max(0, min(width, int(x0))), max(0, min(height, int(y0))),
                    max(0, min(width, int(x1))), max(0, min(height, int(y1))),
                )
                if box[2] > box[0] and box[3] > box[1]:
                    scene_preview.paste(clean_preview.crop(box), box)
            preview_size = (256, 256)
            return _mean_absolute_difference(
                scene_preview.resize(preview_size), clean_preview.resize(preview_size),
            ) <= RESTORE_FRAME_MAE_LIMIT
    except OSError:
        return False


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


_RESTORE_ONLY_ISSUE_MARKERS = ("restore_scene_mismatch:", ":restore_residue_outlier:", "restore_asset_hash_mismatch")


def _stale_restore_refresh_plan(
    session_dir: Path,
    read: "CanonicalReadResult",
    pixel_issues: list[str],
) -> LevelMigrationPlan | None:
    """Plan a restore refresh for a VALID canonical level whose committed
    restore asset went stale (the level was regenerated after export). Only
    applies when every pixel issue is restore-class and the painted scene
    provably sits on the committed clean background; the refresh points
    restore at the clean background and invalidates restore-dependent
    reviews through the normal artifact-class policy."""
    if not all(
        any(marker in issue for marker in _RESTORE_ONLY_ISSUE_MARKERS)
        for issue in pixel_issues
    ):
        return None
    snapshot = read.snapshot
    scene = session_dir / snapshot["assets"]["scene"]["path"]
    clean = session_dir / snapshot["assets"]["cleanBackground"]["path"]
    cleanup_boxes = [
        (
            bird["cleanup"]["x"], bird["cleanup"]["y"],
            bird["cleanup"]["x"] + bird["cleanup"]["width"],
            bird["cleanup"]["y"] + bird["cleanup"]["height"],
        )
        for bird in snapshot["birds"]
    ]
    if not _scene_matches_clean(scene, clean, cleanup_boxes):
        return None
    refreshed = copy.deepcopy(snapshot)
    refreshed["restore"] = {
        "asset": copy.deepcopy(snapshot["assets"]["cleanBackground"]),
        "sourceSceneSha256": snapshot["assets"]["scene"]["sha256"],
    }
    refreshed = invalidate_reviews(refreshed, changed_artifacts={"restore"})
    remaining = _canonical_pixel_issues(session_dir, refreshed)
    if remaining:
        return None
    return LevelMigrationPlan(
        session_dir.name,
        "migrate",
        (),
        snapshot=refreshed,
        expected_content_revision=read.pointer.content_revision if read.pointer else None,
    )


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
            refreshed = _stale_restore_refresh_plan(session_dir, read, pixel_issues)
            if refreshed is not None:
                return refreshed
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

    def _restore_plan(restore_path: Path) -> LevelMigrationPlan:
        restore_relative = (
            restore_path.relative_to(session_dir).as_posix()
            if restore_path.is_relative_to(session_dir) else None
        )
        restore_asset = _asset(session_dir, restore_path) if restore_relative is not None else {
            "path": f".canonical/imported-assets/restore{restore_path.suffix.lower()}",
            "sha256": hashlib.sha256(restore_path.read_bytes()).hexdigest(),
            "bytes": restore_path.stat().st_size,
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
        pixel_issues = _canonical_pixel_issues(session_dir, snapshot, restore_override=restore_path)
        if pixel_issues:
            return LevelMigrationPlan(level_id, "quarantine", tuple(sorted(pixel_issues)))
        return LevelMigrationPlan(
            level_id, "migrate", (), snapshot=snapshot,
            restore_source=str(restore_path) if restore_relative is None else None,
        )

    bird_cleanup_boxes = [
        (
            bird["cleanup"]["x"], bird["cleanup"]["y"],
            bird["cleanup"]["x"] + bird["cleanup"]["width"],
            bird["cleanup"]["y"] + bird["cleanup"]["height"],
        )
        for bird in birds
    ]
    plan = _restore_plan(restore)
    if plan.action == "quarantine" and restore != clean and _scene_matches_clean(scene, clean, bird_cleanup_boxes):
        # The exported package's restore (public bg_00) goes stale when the
        # level is regenerated after export. When the painted scene provably
        # sits on the session's clean background — restore reveals that
        # background — the clean background is the deterministic fallback
        # truth. The stale public package still needs a re-export to match.
        fallback = _restore_plan(clean)
        if fallback.action == "migrate":
            return fallback
    return plan


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
        # A validated migrate plan supersedes any quarantine marker from an
        # earlier pass. The reader (and commit's CAS read) treat the marker's
        # presence as authoritative, so it must go before the commit: left in
        # place it keeps a healthy level quarantined forever and makes a
        # refresh commit CAS-fail against `actual None`. If the commit still
        # conflicts, the next planner pass re-evaluates from scratch.
        (session_dir / ".canonical" / "quarantine.json").unlink(missing_ok=True)
        pointer = CanonicalRevisionStore(session_dir).commit(
            plan.snapshot, expected_content_revision=plan.expected_content_revision,
        )
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


class PublicImportError(ValueError):
    """Raised when a public package cannot seed coherent authoring state."""


def import_authoring_from_public(session_dir: Path, public_dir: Path) -> dict[str, Any]:
    """Rebuild a session's authoring state from its shipped public package.

    The public level.json is the one internally consistent record of a
    shipped level (bird slot, position, radius, sprite geometry, cleanup).
    When session-side hitboxes/dogs have drifted beyond honest identity
    repair, this resets session authoring to the public truth: scene and
    clean background copied from the package, hitboxes/dogs/sidecars derived
    from level.json. The normal migration gates then re-validate the level;
    nothing is committed here.
    """
    level_path = public_dir / "level.json"
    try:
        level = json.loads(level_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise PublicImportError(f"unreadable level.json: {error}") from error
    dogs = level.get("dogs")
    if not isinstance(dogs, list) or not dogs:
        raise PublicImportError("level.json has no birds")
    for name in ("color.png", "bg_00.png"):
        if not (public_dir / name).is_file():
            raise PublicImportError(f"public package is missing {name}")

    marker = f"levels/{public_dir.name}/"
    imported: list[dict[str, Any]] = []
    for position, dog in enumerate(dogs):
        if not isinstance(dog, dict):
            raise PublicImportError(f"bird {position} is not an object")
        sprite = dog.get("sprite")
        image = sprite.get("image") if isinstance(sprite, dict) else None
        if not isinstance(image, str):
            raise PublicImportError(f"bird {dog.get('id')} has no sprite image")
        relative = image.split(marker, 1)[-1] if marker in image else image
        match = re.fullmatch(r"dogs/dog_(\d+)/sprite_(\d+)\.png", relative)
        if match is None:
            raise PublicImportError(f"bird {dog.get('id')} sprite path is not slot-shaped: {relative}")
        index, variant = int(match.group(1)), int(match.group(2))
        cleanup = sprite.get("cleanup")
        required = all(isinstance(dog.get(key), (int, float)) for key in ("x", "y")) and isinstance(cleanup, dict)
        if not required:
            raise PublicImportError(f"bird {dog.get('id')} is missing geometry")
        source_png = public_dir / relative
        source_sidecar = source_png.with_suffix(".json")
        if not source_png.is_file() or not source_sidecar.is_file():
            # Some packages reference a slot whose artifacts were lost from
            # the public tree; the session's own slot-addressed sprite is the
            # only remaining copy. Geometry still comes from level.json.
            source_png = session_dir / relative
            source_sidecar = source_png.with_suffix(".json")
            if not source_png.is_file() or not source_sidecar.is_file():
                raise PublicImportError(f"bird {dog.get('id')} is missing sprite artifacts")
        imported.append({
            "levelDog": dog,
            "index": index,
            "variant": variant,
            "relative": relative,
            "sourcePng": source_png,
            "sourceSidecar": source_sidecar,
        })
    slots = [item["index"] for item in imported]
    if len(set(slots)) != len(slots):
        raise PublicImportError("duplicate sprite slots in level.json")

    # Validation passed for every bird; only now mutate the session.
    for name in ("color.png", "bg_00.png"):
        shutil.copy2(public_dir / name, session_dir / name)
    hitboxes: list[dict[str, Any]] = []
    session_dogs: list[dict[str, Any]] = []
    for item in imported:
        dog = item["levelDog"]
        sprite = dog["sprite"]
        cleanup = sprite["cleanup"]
        target_png = session_dir / item["relative"]
        target_png.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item["sourcePng"], target_png)
        mask = item["sourcePng"].with_name(f"sprite_mask_{item['variant']:03d}.png")
        if mask.is_file():
            shutil.copy2(mask, target_png.with_name(mask.name))
        sidecar = json.loads(item["sourceSidecar"].read_text())
        # Canonical validation requires the cleanup box to contain the hitbox
        # center; some shipped packages violate it (the runtime tolerates
        # this), so expand minimally with the export gate's 20px pad.
        pad = 20
        hb_x, hb_y = int(dog["x"]), int(dog["y"])
        cleanup_box = [
            min(int(cleanup["x"]), hb_x - pad),
            min(int(cleanup["y"]), hb_y - pad),
            max(int(cleanup["x"]) + int(cleanup["width"]), hb_x + pad),
            max(int(cleanup["y"]) + int(cleanup["height"]), hb_y + pad),
        ]
        sidecar.update({
            "spriteBox": [
                int(sprite["x"]), int(sprite["y"]),
                int(sprite["x"]) + int(sprite["width"]),
                int(sprite["y"]) + int(sprite["height"]),
            ],
            "cleanupBox": cleanup_box,
            **({"anchorX": sprite["anchorX"]} if isinstance(sprite.get("anchorX"), (int, float)) else {}),
            **({"anchorY": sprite["anchorY"]} if isinstance(sprite.get("anchorY"), (int, float)) else {}),
            **({"flipX": sprite["flipX"]} if isinstance(sprite.get("flipX"), bool) else {}),
            **({"flipY": sprite["flipY"]} if isinstance(sprite.get("flipY"), bool) else {}),
        })
        target_sidecar = target_png.with_suffix(".json")
        target_sidecar.write_text(json.dumps(sidecar, indent=2) + "\n")
        # The canonical contract forbids slot-shaped birdIds, and public
        # level.json ids ARE slots. Mint a deterministic identity from the
        # import provenance so re-imports converge on the same ids.
        bird_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"ftb:public-import:{public_dir.name}:dog_{item['index']:02d}:sprite_{item['variant']:03d}",
        ))
        hitboxes.append({
            "id": bird_id,
            "x": int(dog["x"]), "y": int(dog["y"]),
            "r": int(dog.get("r", 30)),
        })
        session_dogs.append({
            "id": bird_id,
            "index": item["index"],
            "activeVariant": item["variant"],
            "status": "done",
        })
    (session_dir / "hitboxes.json").write_text(json.dumps(hitboxes, indent=2) + "\n")
    session_path = session_dir / "session.json"
    raw = _json(session_path, {})
    raw.update({"dogs": session_dogs, "selected_bg": 0})
    session_path.write_text(json.dumps(raw, indent=2) + "\n")
    return {
        "levelId": session_dir.name,
        "birds": len(imported),
        "source": "public-level-json",
    }
