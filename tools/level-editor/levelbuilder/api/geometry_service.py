"""P1.6 — the one geometry mutation service.

Every writer that changes canonical geometry goes through mutate_geometry:
one CAS commit, typed errors, review invalidation scoped to what changed,
no-op saves preserve approvals (P2e.3 / policy #11), and machine lanes refuse
human-origin geometry without itemized consent (R7). Identity changes are
legal only through the add/delete operations (CL-3): a raw hitbox save can
never mint or drop a bird.

Writer census (who must call this for VALID_CURRENT sessions):
- routes.save_hitboxes (human move)                      -> move
- routes.auto_hitboxes (wizard auto-placement)           -> replace_set
- inpaint.place_hitboxes_vlm                             -> replace_set
- inpaint.recenter_hitboxes_local_diff                   -> move (machine)
- inpaint magenta finalize/reconcile hitbox writes       -> move (machine)
- inpaint crop-job start hitbox persistence              -> move (machine)
- corpus_migration / import lanes                        -> repair (stamped)
Legacy sessions (MIGRATION_REQUIRED) keep their sidecar writers; every other
state fails closed (A3).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from .canonical_bird_contract import (
    CanonicalReadState,
    ContractValidationError,
    RevisionConflictError,
    invalidate_reviews,
)

OPERATIONS = ("move", "add", "delete", "clear", "scale", "replace_set", "repair")


class HumanAuthorityError(Exception):
    """A machine lane attempted to modify human-origin geometry without
    itemized consent (R7)."""


@dataclass(frozen=True)
class GeometryResult:
    content_revision: str
    operational_revision: str
    no_op: bool
    snapshot: dict[str, Any] | None = None  # the committed (or current) snapshot


def _require_hitbox(value: dict[str, Any]) -> dict[str, int]:
    try:
        return {"x": int(value["x"]), "y": int(value["y"]), "r": int(value["r"])}
    except (KeyError, TypeError, ValueError) as error:
        raise ContractValidationError(f"invalid hitbox payload: {value!r}") from error


def _current(session_id: str):
    from . import session as S

    store = S.canonical_session_store(session_id)
    current = store.read()
    if current.state is not CanonicalReadState.VALID_CURRENT or current.snapshot is None:
        raise ContractValidationError(
            f"canonical session is not writable: {current.state.value}: {current.detail or ''}".rstrip()
        )
    return store, current


def _retired_slots(snapshot: dict[str, Any]) -> set[str]:
    retired = (snapshot.get("operational") or {}).get("retiredSlots") or []
    return {slot for slot in retired if isinstance(slot, str)}


def _retire_slot(snapshot: dict[str, Any], slot: str) -> None:
    """CR-1 finding 6: a deleted bird's slot is never reused — the on-disk
    dogs/<slot>/ directory may still hold the old sprite, and a new identity
    must not inherit it."""
    operational = snapshot.setdefault("operational", {})
    retired = operational.setdefault("retiredSlots", [])
    if slot not in retired:
        retired.append(slot)


def _next_slot_excluding(snapshot: dict[str, Any], extra_birds: list[dict[str, Any]] | None = None) -> str:
    used = {bird["compatibilitySlot"] for bird in snapshot.get("birds", [])}
    used |= {bird["compatibilitySlot"] for bird in (extra_birds or [])}
    used |= _retired_slots(snapshot)
    index = 0
    while f"dog_{index:02d}" in used:
        index += 1
    return f"dog_{index:02d}"


def _result(pointer, *, no_op: bool, snapshot: dict[str, Any] | None = None) -> GeometryResult:
    return GeometryResult(
        content_revision=pointer.content_revision,
        operational_revision=pointer.operational_revision,
        no_op=no_op,
        snapshot=snapshot,
    )


def mutate_geometry(
    session_id: str,
    operation: str,
    *,
    expected_content_revision: str | None,
    actor: str,
    hitboxes: list[dict[str, Any]] | None = None,
    bird_ids: list[str] | None = None,
    factor: float | None = None,
    override_human: list[str] | None = None,
) -> GeometryResult:
    if operation not in OPERATIONS:
        raise ContractValidationError(f"unknown geometry operation: {operation!r}")
    store, current = _current(session_id)
    actual = current.pointer.content_revision if current.pointer else None
    if expected_content_revision is None or expected_content_revision != actual:
        raise RevisionConflictError(expected_content_revision, actual)

    snapshot = current.snapshot
    is_machine = not actor.startswith("human:")
    consent = set(override_human or [])

    def _guard_human(bird: dict[str, Any]) -> None:
        origin = bird.get("geometryOrigin")
        if is_machine and isinstance(origin, str) and origin.startswith("human:") \
                and bird["birdId"] not in consent:
            raise HumanAuthorityError(
                f"{bird['birdId']} geometry is human-placed ({origin}); "
                f"machine actor {actor!r} needs itemized override_human consent"
            )

    if operation in ("move", "replace_set"):
        if hitboxes is None:
            raise ContractValidationError(f"{operation} requires hitboxes")
        if operation == "move":
            incoming: dict[str, dict[str, int]] = {}
            for hitbox in hitboxes:
                bird_id = hitbox.get("id") if isinstance(hitbox, dict) else None
                if not isinstance(bird_id, str) or bird_id in incoming:
                    raise ContractValidationError("canonical hitboxes require unique birdId values")
                incoming[bird_id] = _require_hitbox(hitbox)
            ids = {bird["birdId"] for bird in snapshot["birds"]}
            if set(incoming) != ids:
                raise ContractValidationError(
                    "canonical hitbox identity set does not match the current revision; "
                    "use add/delete for lifecycle changes"
                )
            if all(bird["hitbox"] == incoming[bird["birdId"]] for bird in snapshot["birds"]):
                # Byte-identical geometry: no commit, approvals intact.
                return _result(current.pointer, no_op=True, snapshot=snapshot)
            updated = invalidate_reviews(snapshot, changed_artifacts={"hitboxes"})
            for bird in updated["birds"]:
                if bird["hitbox"] != incoming[bird["birdId"]]:
                    _guard_human(bird)
                    bird["hitbox"] = incoming[bird["birdId"]]
                    bird["geometryOrigin"] = actor
        else:
            # replace_set is id-aware (CR-1 findings 1/3): id-carrying entries
            # move their birds, birds absent from the set are deleted, id-less
            # entries are added. A PURE positional set is legal only against a
            # fresh placement (no sprites, no human geometry) — identities are
            # never rebound by position.
            by_id = {b["birdId"]: b for b in snapshot["birds"]}
            carried = [h for h in hitboxes if isinstance(h, dict) and isinstance(h.get("id"), str)]
            anonymous = [h for h in hitboxes if not (isinstance(h, dict) and isinstance(h.get("id"), str))]
            if not carried and by_id:
                fresh = all(
                    not (b.get("sprite") or {}).get("asset")
                    and not str(b.get("geometryOrigin", "")).startswith("human:")
                    for b in snapshot["birds"]
                )
                if not fresh:
                    raise ContractValidationError(
                        "positional replace_set would rebind bird identity; "
                        "send ids or use add/delete lifecycle operations"
                    )
            # Client-minted ids (canvas add gesture, CR-t1 P0-4) become real
            # bird adds adopting the client uuid; the contract validates the
            # id shape at commit. Known ids move; absent ids prune.
            unknown = {h["id"] for h in carried} - set(by_id)
            # No-op BEFORE any authority guard (CR-1 finding 2).
            if not anonymous and len(carried) == len(by_id) and all(
                h["id"] in by_id and by_id[h["id"]]["hitbox"] == _require_hitbox(h)
                for h in carried
            ):
                return _result(current.pointer, no_op=True, snapshot=snapshot)
            updated = invalidate_reviews(snapshot, changed_artifacts={"birdSet", "hitboxes"})
            live_by_id = {b["birdId"]: b for b in updated["birds"]}
            kept_ids = {h["id"] for h in carried}
            birds = []
            order_base = max((b.get("presentationOrder", 0) for b in updated["birds"]), default=-1)
            for entry in carried:
                if entry["id"] in unknown:
                    order_base += 1
                    birds.append({
                        "birdId": entry["id"],
                        "compatibilitySlot": _next_slot_excluding(updated, birds),
                        "presentationOrder": order_base,
                        "hitbox": _require_hitbox(entry),
                        "geometryOrigin": actor,
                    })
                    continue
                bird = live_by_id[entry["id"]]
                incoming_box = _require_hitbox(entry)
                if bird["hitbox"] != incoming_box:
                    _guard_human(bird)
                    bird["hitbox"] = incoming_box
                    bird["geometryOrigin"] = actor
                birds.append(bird)
            for bird in updated["birds"]:
                if bird["birdId"] not in kept_ids:
                    _guard_human(bird)  # pruning human geometry needs consent too
                    _retire_slot(updated, bird["compatibilitySlot"])
            for hitbox in anonymous:
                birds.append({
                    "birdId": str(uuid.uuid4()),
                    "compatibilitySlot": _next_slot_excluding(updated, birds),
                    "presentationOrder": 0,
                    "hitbox": _require_hitbox(hitbox),
                    "geometryOrigin": actor,
                })
            for order, bird in enumerate(birds):
                bird["presentationOrder"] = order
            updated["birds"] = birds
            _strip_empty_generation(updated)
    elif operation == "add":
        if not hitboxes:
            raise ContractValidationError("add requires at least one hitbox")
        updated = invalidate_reviews(snapshot, changed_artifacts={"birdSet", "hitboxes"})
        order = max((b.get("presentationOrder", 0) for b in updated["birds"]), default=-1)
        for hitbox in hitboxes:
            order += 1
            updated["birds"].append({
                "birdId": str(uuid.uuid4()),
                "compatibilitySlot": _next_slot_excluding(updated),
                "presentationOrder": order,
                "hitbox": _require_hitbox(hitbox),
                "geometryOrigin": actor,
                "activeGeneration": None,
            })
        _strip_empty_generation(updated)
    elif operation == "delete":
        if not bird_ids:
            raise ContractValidationError("delete requires bird_ids")
        missing = set(bird_ids) - {b["birdId"] for b in snapshot["birds"]}
        if missing:
            raise ContractValidationError(f"delete targets unknown birds: {sorted(missing)}")
        updated = invalidate_reviews(snapshot, changed_artifacts={"birdSet", "hitboxes"})
        for bird in updated["birds"]:
            if bird["birdId"] in set(bird_ids):
                _guard_human(bird)
                _retire_slot(updated, bird["compatibilitySlot"])
        tombstones = updated.setdefault("operational", {}).setdefault("deletedBirdIds", [])
        for bird_id in bird_ids:
            if bird_id not in tombstones:
                tombstones.append(bird_id)
        tombstones.sort()
        updated["birds"] = [b for b in updated["birds"] if b["birdId"] not in set(bird_ids)]
    elif operation == "clear":
        if not snapshot["birds"]:
            return _result(current.pointer, no_op=True, snapshot=snapshot)
        updated = invalidate_reviews(snapshot, changed_artifacts={"birdSet", "hitboxes"})
        for bird in updated["birds"]:
            _guard_human(bird)
        updated["birds"] = []
    elif operation == "scale":
        if factor is None or factor <= 0:
            raise ContractValidationError("scale requires a positive factor")
        updated = invalidate_reviews(snapshot, changed_artifacts={"hitboxes"})
        changed = False
        for bird in updated["birds"]:
            scaled = max(1, int(round(bird["hitbox"]["r"] * factor)))
            if scaled != bird["hitbox"]["r"]:
                _guard_human(bird)
                bird["hitbox"] = {**bird["hitbox"], "r": scaled}
                bird["geometryOrigin"] = actor
                changed = True
        if not changed:
            return _result(current.pointer, no_op=True, snapshot=snapshot)
    else:  # repair — migration/import lanes; stamped, never silent
        raise ContractValidationError("repair operations must supply hitboxes via move semantics")

    pointer = store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision if current.pointer else None,
    )
    _project_geometry(session_id, updated)
    return _result(pointer, no_op=False, snapshot=updated)


def _project_geometry(session_id: str, snapshot: dict[str, Any]) -> None:
    """Mirror committed geometry into the legacy read surfaces: hitboxes.json,
    each sprited bird's sidecar, AND legacy deletion state (merge-review F2:
    session.json dogs[] entries and dogs/<slot>/ dirs of birds no longer in
    the snapshot are removed/renamed so a rollback cannot resurrect ghosts)."""
    import json as _json
    import time as _time

    from . import session as S

    sdir = S.session_dir(session_id)
    live_ids = {b["birdId"] for b in snapshot["birds"]}
    live_slots = {b["compatibilitySlot"] for b in snapshot["birds"]}
    raw = S.load_session_raw(session_id)
    if isinstance(raw, dict) and isinstance(raw.get("dogs"), list):
        kept, removed_indices = [], []
        for dog in raw["dogs"]:
            dog_id = dog.get("id") if isinstance(dog, dict) else None
            slot_live = isinstance(dog, dict) and f"dog_{dog.get('index', -1):02d}" in live_slots
            if (dog_id and dog_id in live_ids) or (dog_id is None and slot_live):
                kept.append(dog)
            else:
                if isinstance(dog, dict) and isinstance(dog.get("index"), int):
                    removed_indices.append(dog["index"])
        if removed_indices:
            raw["dogs"] = kept
            deleted = raw.setdefault("deleted_dog_indices", [])
            for index in removed_indices:
                if index not in deleted:
                    deleted.append(index)
            S.save_session(session_id, raw)
            for index in removed_indices:
                slot_dir = sdir / "dogs" / f"dog_{index:02d}"
                if slot_dir.is_dir():
                    slot_dir.rename(slot_dir.with_name(f".deleted-dog_{index:02d}-{int(_time.time())}"))
    birds = sorted(snapshot["birds"], key=lambda b: b.get("presentationOrder", 0))
    mirror = [
        {"id": b["birdId"], "x": b["hitbox"]["x"], "y": b["hitbox"]["y"], "r": b["hitbox"]["r"]}
        for b in birds
    ]
    tmp = sdir / ".hitboxes.json.tmp"
    tmp.write_text(_json.dumps(mirror, indent=2) + "\n")
    tmp.replace(sdir / "hitboxes.json")
    for bird in birds:
        if (bird.get("sprite") or {}).get("asset"):
            S.project_canonical_bird_compatibility(session_id, snapshot, bird["birdId"])


def _strip_empty_generation(snapshot: dict[str, Any]) -> None:
    for bird in snapshot["birds"]:
        if bird.get("activeGeneration") is None:
            bird.pop("activeGeneration", None)
        if not (bird.get("sprite") or {}).get("asset"):
            bird.pop("sprite", None)
            bird.pop("cleanup", None)
