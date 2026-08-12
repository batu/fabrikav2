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


def _next_slot(birds: list[dict[str, Any]]) -> str:
    used = {bird["compatibilitySlot"] for bird in birds}
    index = 0
    while f"dog_{index:02d}" in used:
        index += 1
    return f"dog_{index:02d}"


def _result(pointer, *, no_op: bool) -> GeometryResult:
    return GeometryResult(
        content_revision=pointer.content_revision,
        operational_revision=pointer.operational_revision,
        no_op=no_op,
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
                return _result(current.pointer, no_op=True)
            updated = invalidate_reviews(snapshot, changed_artifacts={"hitboxes"})
            for bird in updated["birds"]:
                if bird["hitbox"] != incoming[bird["birdId"]]:
                    _guard_human(bird)
                    bird["hitbox"] = incoming[bird["birdId"]]
                    bird["geometryOrigin"] = actor
        else:  # replace_set: machine proposes a complete positional set
            updated = invalidate_reviews(snapshot, changed_artifacts={"birdSet", "hitboxes"})
            existing = list(updated["birds"])
            for bird in existing:
                _guard_human(bird)
            proposed = [_require_hitbox(h) for h in hitboxes]
            birds: list[dict[str, Any]] = []
            for index, hitbox in enumerate(proposed):
                if index < len(existing):
                    bird = existing[index]
                    bird["hitbox"] = hitbox
                    bird["geometryOrigin"] = actor
                    birds.append(bird)
                else:
                    slot = _next_slot(birds + existing)
                    birds.append({
                        "birdId": str(uuid.uuid4()),
                        "compatibilitySlot": slot,
                        "presentationOrder": index,
                        "hitbox": hitbox,
                        "geometryOrigin": actor,
                        "activeGeneration": None,
                    })
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
                "compatibilitySlot": _next_slot(updated["birds"]),
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
        updated["birds"] = [b for b in updated["birds"] if b["birdId"] not in set(bird_ids)]
    elif operation == "clear":
        if not snapshot["birds"]:
            return _result(current.pointer, no_op=True)
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
            return _result(current.pointer, no_op=True)
    else:  # repair — migration/import lanes; stamped, never silent
        raise ContractValidationError("repair operations must supply hitboxes via move semantics")

    pointer = store.commit(
        updated,
        expected_content_revision=expected_content_revision,
        expected_operational_revision=current.pointer.operational_revision if current.pointer else None,
    )
    _project_geometry(session_id, updated)
    return _result(pointer, no_op=False)


def _project_geometry(session_id: str, snapshot: dict[str, Any]) -> None:
    """Mirror committed geometry into the legacy read surfaces: hitboxes.json
    (stamped with its source revision, FF-2) and each sprited bird's sidecar."""
    import json as _json

    from . import session as S

    sdir = S.session_dir(session_id)
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
