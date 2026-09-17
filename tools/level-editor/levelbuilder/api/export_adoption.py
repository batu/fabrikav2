"""Adopt a public export back into its canonical session (the editor's second direction).

Operator ask 2026-09-17: "the level editor needs to be a two-way street." Scripts and reviews
edit `public/levels/<id>` (stickers, placements, cleanups, restoration, added/removed birds);
this operation makes the canonical session equal to that package as a new revision, so the
editor shows and edits what the game runs, and a canonical export reproduces the package
byte-for-byte on the governed assets.

Rules:
- birds are matched by id (canonical exports use birdIds); export dogs unknown to the
  session are ADDED (hand-added birds), session birds missing from the export are DELETED
  (tombstoned, slot retired) — the same operational bookkeeping as geometry_service;
- sprite PNGs, the restoration (bg_00.png) and, when it differs, the scene (color.png) are
  copied into the session and re-hashed; cleanup provenance and generation provenance are
  re-pointed so validate_snapshot holds;
- reviews are invalidated for exactly the changed artifact classes, then re-blessed with the
  caller's actor (the operator reviewed the export, that is the assertion being recorded).
"""
from __future__ import annotations

import copy
import hashlib
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from .canonical_bird_contract import invalidate_reviews


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _asset(sdir: Path, rel: str) -> dict[str, Any]:
    p = sdir / rel
    return {"path": rel, "sha256": _sha(p), "bytes": p.stat().st_size}


def adopt_export(session_id: str, *, actor: str, stamp: str) -> dict[str, Any]:
    from . import session as S
    from .geometry_service import _next_slot_excluding, _project_geometry, _retire_slot

    current = S.read_canonical_session(session_id)
    if current.state.value != "valid_current" or current.snapshot is None or current.pointer is None:
        raise ValueError(f"{session_id}: canonical session is {current.state.value}")
    sdir = S.session_dir(session_id)
    pub = S.GAME_PUBLIC_LEVELS / session_id
    level = json.loads((pub / "level.json").read_text())
    original = current.snapshot
    snap = copy.deepcopy(original)
    changed: set[str] = set()
    report: dict[str, Any] = {"sessionId": session_id, "added": [], "deleted": [], "updated": 0}

    # scene (patched levels): copy and re-point every generation's provenance
    if (pub / "color.png").exists() and _sha(pub / "color.png") != snap["assets"]["scene"]["sha256"]:
        shutil.copy2(pub / "color.png", sdir / "color.png")
        snap["assets"]["scene"] = _asset(sdir, "color.png")
        changed.add("scene")
    scene_sha = snap["assets"]["scene"]["sha256"]

    # restoration: the export's bg_00.png becomes the restore asset
    if (pub / "bg_00.png").exists():
        rel = f"bg_adopted_{stamp}.png"
        shutil.copy2(pub / "bg_00.png", sdir / rel)
        new = _asset(sdir, rel)
        old_restore = (snap.get("restore") or {}).get("asset", {})
        if new["sha256"] != old_restore.get("sha256") or not (sdir / old_restore.get("path", "")).is_file():
            snap["restore"] = {"asset": new, "sourceSceneSha256": scene_sha}
            changed.add("restore")
        elif old_restore.get("path") != rel:
            (sdir / rel).unlink()
    snap["restore"]["sourceSceneSha256"] = scene_sha

    # legacy exports (the shipped 44) carry dog_NN ids, canonical exports carry birdIds:
    # match by id when it is a birdId, else by the hitbox point within its radius.
    by_id = {b["birdId"]: b for b in snap["birds"]}
    def _match(dog: dict[str, Any]) -> dict[str, Any] | None:
        if dog["id"] in by_id:
            return by_id[dog["id"]]
        best = None
        for b in snap["birds"]:
            d = ((b["hitbox"]["x"] - dog["x"]) ** 2 + (b["hitbox"]["y"] - dog["y"]) ** 2) ** 0.5
            if d <= max(8, int(dog.get("r", b["hitbox"]["r"]))) and (best is None or d < best[0]):
                best = (d, b)
        return best[1] if best else None
    matched = {}
    for dog in level["dogs"]:
        bird = _match(dog)
        if bird is not None and bird["birdId"] not in matched.values():
            matched[dog["id"]] = bird["birdId"]
    export_ids = list(matched.values())
    # deletions
    for bird in list(snap["birds"]):
        if bird["birdId"] not in export_ids:
            _retire_slot(snap, bird["compatibilitySlot"])
            tomb = snap.setdefault("operational", {}).setdefault("deletedBirdIds", [])
            if bird["birdId"] not in tomb:
                tomb.append(bird["birdId"])
            snap["birds"].remove(bird)
            report["deleted"].append(bird["compatibilitySlot"])
            changed |= {"birdSet", "hitboxes"}
    # updates + additions
    for order, dog in enumerate(level["dogs"]):
        sp = dog.get("sprite")
        bird = by_id.get(matched.get(dog["id"], ""))
        if bird is None:
            bird = {
                "birdId": str(uuid.uuid4()),
                "compatibilitySlot": _next_slot_excluding(snap),
                "presentationOrder": order,
                "hitbox": {"x": int(dog["x"]), "y": int(dog["y"]), "r": int(dog["r"])},
                "geometryOrigin": actor,
                "activeGeneration": None,
            }
            snap["birds"].append(bird)
            report["added"].append(bird["compatibilitySlot"])
            changed |= {"birdSet", "hitboxes"}
        else:
            hb = {"x": int(dog["x"]), "y": int(dog["y"]), "r": int(dog["r"])}
            if hb != bird["hitbox"]:
                bird["hitbox"] = hb
                bird["geometryOrigin"] = actor
                changed.add("hitboxes")
            if bird.get("presentationOrder") != order:
                bird["presentationOrder"] = order
        if not sp or not sp.get("image"):
            continue
        slot = bird["compatibilitySlot"]
        src = pub / sp["image"].split(f"levels/{session_id}/", 1)[1]
        dst_rel = f"dogs/{slot}/sprite_000.png"
        (sdir / "dogs" / slot).mkdir(parents=True, exist_ok=True)
        src_sha = _sha(src)
        old_sprite = bird.get("sprite") or {}
        target = sdir / dst_rel
        if src_sha != (old_sprite.get("asset") or {}).get("sha256") or not target.is_file() or _sha(target) != src_sha:
            shutil.copy2(src, target)
            if src_sha != (old_sprite.get("asset") or {}).get("sha256"):
                changed.add("spritePixels")
        placement = {k: int(round(float(sp[k]))) for k in ("x", "y", "width", "height")}
        if placement != old_sprite.get("placement") or round(float(sp.get("anchorX", 0.5)), 4) != old_sprite.get("anchorX") or round(float(sp.get("anchorY", 0.5)), 4) != old_sprite.get("anchorY"):
            changed.add("spritePlacement")
        bird["sprite"] = {
            "asset": _asset(sdir, dst_rel),
            "placement": placement,
            # anchors must sit inside the sprite (contract); a refit/regen box that does not
            # contain the hitbox is kept as placed, the anchor is clamped for the flyout
            "anchorX": min(1.0, max(0.0, round(float(sp.get("anchorX", 0.5)), 4))),
            "anchorY": min(1.0, max(0.0, round(float(sp.get("anchorY", 0.5)), 4))),
            "flipX": bool(sp.get("flipX", False)),
            "flipY": bool(sp.get("flipY", False)),
        }
        c = sp["cleanup"]
        cleanup = {k: int(round(float(c[k]))) for k in ("x", "y", "width", "height")}
        if {k: (bird.get("cleanup") or {}).get(k) for k in cleanup} != cleanup:
            changed.add("cleanup")
        bird["cleanup"] = {**cleanup, "sourceSpriteSha256": bird["sprite"]["asset"]["sha256"]}
        gen = bird.get("activeGeneration") or {"generationId": f"adopt-{stamp}", "inputRevision": current.pointer.content_revision}
        gen["inputSceneSha256"] = scene_sha
        bird["activeGeneration"] = gen
        report["updated"] += 1
    def _rebless() -> None:
        cur = S.read_canonical_session(session_id)
        loc = ((cur.snapshot or {}).get("operational") or {}).get("hitboxLocalization") or {}
        if loc.get("sceneSha256") != (cur.snapshot or {})["assets"]["scene"]["sha256"]:
            S.stamp_hitbox_localization(session_id, method=f"adopt-export:{actor}")
            cur = S.read_canonical_session(session_id)
        rev = cur.pointer.content_revision
        reviews = (cur.snapshot or {}).get("reviews", {})
        if (reviews.get("hitboxes") or {}).get("contentRevision") != rev:
            S.set_canonical_hitbox_review_if_present(session_id, True, expected_content_revision=rev, reviewer=actor)
            cur = S.read_canonical_session(session_id)
            rev = cur.pointer.content_revision
        if ((cur.snapshot or {}).get("reviews", {}).get("finalCutouts") or {}).get("contentRevision") != rev:
            S.set_canonical_final_review_if_present(session_id, True, expected_content_revision=rev, reviewer=actor)

    def _heal_assets(snapshot: dict[str, Any]) -> list[str]:
        healed = []
        for bird in snapshot["birds"]:
            asset = (bird.get("sprite") or {}).get("asset")
            if not asset:
                continue
            target = sdir / asset["path"]
            if target.is_file() and _sha(target) == asset["sha256"]:
                continue
            dog = next((d for d in level["dogs"] if matched.get(d["id"]) == bird["birdId"] or d["id"] == bird["birdId"]), None)
            if dog is None or not (dog.get("sprite") or {}).get("image"):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(pub / dog["sprite"]["image"].split(f"levels/{session_id}/", 1)[1], target)
            healed.append(bird["compatibilitySlot"])
        return healed

    if not changed:
        report["noOp"] = True
        report["healed"] = _heal_assets(snap)
        _rebless()
        return report
    # reviews must be invalidated on the still-valid original, then the edits carried over
    base = invalidate_reviews(copy.deepcopy(original), changed_artifacts=changed)
    for key in ("assets", "restore", "birds", "operational"):
        base[key] = snap[key]
    store = S.canonical_session_store(session_id)
    pointer = store.commit(
        base,
        expected_content_revision=current.pointer.content_revision,
        expected_operational_revision=current.pointer.operational_revision,
    )
    _project_geometry(session_id, base)
    if changed & {"scene", "birdSet", "hitboxes"}:
        # the operator reviewed these hitboxes on the device against this paint: discharge the relocalize obligation
        S.stamp_hitbox_localization(session_id, method=f"adopt-export:{actor}")
    report["healed"] = _heal_assets(base)   # the legacy projection can clobber a slot file; re-copy from the export
    _rebless()
    report["changed"] = sorted(changed)
    report["contentRevision"] = pointer.content_revision
    return report
