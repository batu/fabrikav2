"""CL-14 — before/after on extract with accept/revert.

Every canonical revision is retained and every asset's bytes are
digest-addressed in the CAS (FF-1), so "revert" is honest history surgery:
recommit the prior sprite descriptor (asset + placement + cleanup + its
generation provenance) onto the current snapshot. No bytes are invented;
review invalidation follows the normal sprite-pixels rule.
"""
from __future__ import annotations

from typing import Any

from .canonical_bird_contract import (
    ContractValidationError,
    RevisionConflictError,
    invalidate_reviews,
    snapshot_revisions,
    validate_snapshot,
)


def sprite_history(session_id: str, bird_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    """Distinct sprite assets this bird has carried, newest first, each with a
    content revision that can be reverted to."""
    import hashlib
    import json

    from . import session as S

    store = S.canonical_session_store(session_id)
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    current = store.read()
    revisions: list[dict[str, Any]] = []
    if current.snapshot is not None:
        revisions.append(current.snapshot)
    for path in sorted(store.revisions_dir.glob("revision-*.json"),
                       key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            raw = path.read_bytes()
            if f"revision-{hashlib.sha256(raw).hexdigest()}.json" != path.name:
                continue
            snapshot = validate_snapshot(json.loads(raw), validate_reviews=False)
        except (OSError, ValueError, ContractValidationError):
            continue
        revisions.append(snapshot)
    for snapshot in revisions:
        bird = next((b for b in snapshot.get("birds", []) if b.get("birdId") == bird_id), None)
        asset = ((bird or {}).get("sprite") or {}).get("asset")
        if not isinstance(asset, dict):
            continue
        if asset["sha256"] in seen:
            continue
        seen.add(asset["sha256"])
        entries.append({
            "sha256": asset["sha256"],
            "path": asset["path"],
            "contentRevision": snapshot_revisions(snapshot).content_revision,
        })
        if len(entries) >= limit:
            break
    return entries


def revert_bird_sprite(
    session_id: str,
    bird_id: str,
    *,
    to_content_revision: str,
    expected_content_revision: str,
    actor: str,
):
    """Recommit the sprite block a prior revision recorded for this bird."""
    from . import session as S
    from .canonical_assets import AssetIntegrityError, resolve_asset
    from .geometry_service import GeometryResult, _project_geometry

    store = S.canonical_session_store(session_id)
    current = store.read()
    if current.snapshot is None or current.pointer is None:
        raise ContractValidationError("not a canonical session")
    if current.pointer.content_revision != expected_content_revision:
        raise RevisionConflictError(expected_content_revision, current.pointer.content_revision)
    historical = store.snapshot_for_content_revision(to_content_revision)
    if historical is None:
        raise ContractValidationError(f"unknown content revision: {to_content_revision}")
    prior = next((b for b in historical.get("birds", []) if b.get("birdId") == bird_id), None)
    if prior is None or not isinstance((prior.get("sprite") or {}).get("asset"), dict):
        raise ContractValidationError(f"{bird_id} has no sprite at {to_content_revision}")

    updated = invalidate_reviews(
        current.snapshot,
        changed_artifacts={"spritePixels", "spritePlacement", "cleanup", "activeGeneration"},
    )
    target = next((b for b in updated["birds"] if b.get("birdId") == bird_id), None)
    if target is None:
        raise ContractValidationError(f"unknown birdId: {bird_id}")
    target["sprite"] = dict(prior["sprite"])
    target["cleanup"] = dict(prior["cleanup"])
    prior_generation = prior.get("activeGeneration")
    if prior_generation is not None:
        # CR-t3 P0-2: provenance is never forged. A sprite generated against a
        # DIFFERENT scene cannot claim the current one — refuse; regenerate.
        if prior_generation.get("inputSceneSha256") != updated["assets"]["scene"]["sha256"]:
            raise ContractValidationError(
                f"{bird_id}'s prior sprite was generated against a different scene; "
                "revert is only valid within the same scene — regenerate instead"
            )
        target["activeGeneration"] = dict(prior_generation)
    if isinstance(target.get("cleanup"), dict):
        target["cleanup"]["sourceSpriteSha256"] = target["sprite"]["asset"]["sha256"]
        # CR-t3 P0-3: restored cleanup must still contain the CURRENT hitbox
        # center — a later hitbox move can make old geometry erase the wrong
        # pixels.
        hitbox = target["hitbox"]
        cleanup = target["cleanup"]
        if not (cleanup["x"] <= hitbox["x"] <= cleanup["x"] + cleanup["width"]
                and cleanup["y"] <= hitbox["y"] <= cleanup["y"] + cleanup["height"]):
            raise ContractValidationError(
                f"{bird_id}'s prior cleanup no longer contains the current hitbox "
                "center; move the hitbox back or regenerate instead of reverting"
            )

    # Restore the path projection from the CAS before commit verification.
    descriptor = target["sprite"]["asset"]
    try:
        resolved = resolve_asset(store, descriptor)
    except AssetIntegrityError as error:
        raise ContractValidationError(f"prior sprite bytes are gone from the CAS: {error}") from error
    projection = store.session_root / descriptor["path"]
    projection.parent.mkdir(parents=True, exist_ok=True)
    projection.write_bytes(resolved.data)

    pointer = store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision,
    )
    _project_geometry(session_id, updated)
    return GeometryResult(
        content_revision=pointer.content_revision,
        operational_revision=pointer.operational_revision,
        no_op=False,
        snapshot=updated,
    )
