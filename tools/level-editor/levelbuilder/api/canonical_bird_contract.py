"""Canonical Find the Bird authoring identity and revision primitives.

This module deliberately knows nothing about public packages.  Its store is
rooted at an authoring session directory supplied by the caller; projections
must enter through an explicit migration in a later pipeline stage.
"""

from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
BIRD_ID_RE = re.compile(
    r"^(?:bird_[A-Za-z0-9][A-Za-z0-9._-]*|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$"
)
SLOT_RE = re.compile(r"^dog_\d{2,}$")

_REVIEW_INVALIDATION: dict[str, frozenset[str]] = {
    "scene": frozenset({"hitboxes", "finalCutouts"}),
    "restore": frozenset({"hitboxes", "finalCutouts"}),
    "birdSet": frozenset({"hitboxes", "finalCutouts"}),
    "hitboxes": frozenset({"hitboxes", "finalCutouts"}),
    "activeGeneration": frozenset({"finalCutouts"}),
    "spritePixels": frozenset({"finalCutouts"}),
    "spritePlacement": frozenset({"finalCutouts"}),
    "spriteFlip": frozenset({"finalCutouts"}),
    "cleanup": frozenset({"finalCutouts"}),
    "archive": frozenset(),
    "lineup": frozenset(),
    "jobState": frozenset(),
}


class ContractValidationError(ValueError):
    pass


class RevisionConflictError(RuntimeError):
    def __init__(self, expected: str | None, actual: str | None):
        self.expected = expected
        self.actual = actual
        super().__init__(f"content revision conflict: expected {expected!r}, actual {actual!r}")


class CanonicalReadState(str, Enum):
    VALID_CURRENT = "valid_current"
    MIGRATION_REQUIRED = "migration_required"
    QUARANTINED_INTEGRITY = "quarantined_integrity"
    ORPHANED_STAGE = "orphaned_stage"


@dataclass(frozen=True)
class SnapshotRevisions:
    content_revision: str
    operational_revision: str


@dataclass(frozen=True)
class RevisionPointer:
    revision_file: str
    content_revision: str
    operational_revision: str


@dataclass(frozen=True)
class CanonicalReadResult:
    state: CanonicalReadState
    snapshot: dict[str, Any] | None = None
    pointer: RevisionPointer | None = None
    detail: str | None = None


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractValidationError(message)


def _validate_asset(asset: Any, label: str) -> None:
    _require(isinstance(asset, dict), f"{label} must be an asset descriptor")
    _require(isinstance(asset.get("path"), str) and bool(asset["path"]), f"{label}.path is required")
    _require(isinstance(asset.get("sha256"), str) and bool(SHA256_RE.fullmatch(asset["sha256"])), f"{label}.sha256 is invalid")
    _require(isinstance(asset.get("bytes"), int) and asset["bytes"] >= 0, f"{label}.bytes is invalid")


def _content_projection(snapshot: dict[str, Any]) -> dict[str, Any]:
    birds = []
    for source in snapshot["birds"]:
        bird = {key: copy.deepcopy(value) for key, value in source.items() if key != "presentationOrder"}
        birds.append(bird)
    birds.sort(key=lambda item: item["birdId"])
    return {
        "schemaVersion": snapshot["schemaVersion"],
        "sessionId": snapshot["sessionId"],
        "assets": copy.deepcopy(snapshot["assets"]),
        "restore": copy.deepcopy(snapshot["restore"]),
        "birds": birds,
    }


def _operational_projection(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": snapshot["schemaVersion"],
        "sessionId": snapshot["sessionId"],
        "presentationOrder": {
            bird["birdId"]: bird.get("presentationOrder") for bird in snapshot["birds"]
        },
        "operational": copy.deepcopy(snapshot.get("operational", {})),
        "reviews": copy.deepcopy(snapshot.get("reviews", {})),
    }


def snapshot_revisions(snapshot: dict[str, Any]) -> SnapshotRevisions:
    validate_snapshot(snapshot, validate_reviews=False)
    return SnapshotRevisions(
        content_revision=_hash(_content_projection(snapshot)),
        operational_revision=_hash(_operational_projection(snapshot)),
    )


def review_scope_revision(snapshot: dict[str, Any], review_kind: str) -> str:
    """Hash only the artifacts governed by one human review stage."""
    _require(review_kind in {"hitboxes", "finalCutouts"}, "unknown review assertion")
    if review_kind == "finalCutouts":
        return _hash(_content_projection(snapshot))
    return _hash({
        "scene": copy.deepcopy(snapshot["assets"]["scene"]),
        "cleanBackground": copy.deepcopy(snapshot["assets"]["cleanBackground"]),
        "restore": copy.deepcopy(snapshot["restore"]),
        "birds": sorted(
            ({"birdId": bird["birdId"], "hitbox": copy.deepcopy(bird["hitbox"])} for bird in snapshot["birds"]),
            key=lambda bird: bird["birdId"],
        ),
    })


def bless_snapshot(
    snapshot: dict[str, Any],
    *,
    review_kind: str,
    reviewer: str,
    reviewed_at: str,
) -> dict[str, Any]:
    """Create a human assertion over the exact current content revision."""
    _require(review_kind in {"hitboxes", "finalCutouts"}, "unknown review assertion")
    _require(reviewer.startswith("human:"), "review requires an attributable human")
    _require(bool(reviewed_at), "reviewedAt is required")
    result = validate_snapshot(snapshot)
    revision = snapshot_revisions(result).content_revision
    result.setdefault("reviews", {})[review_kind] = {
        "contentRevision": revision,
        "scopeRevision": review_scope_revision(result, review_kind),
        "reviewer": reviewer,
        "reviewedAt": reviewed_at,
    }
    return validate_snapshot(result)


def invalidate_reviews(
    snapshot: dict[str, Any],
    *,
    changed_artifacts: set[str] | frozenset[str],
) -> dict[str, Any]:
    """Invalidate dependent assertions while retaining their audit history."""
    unknown = set(changed_artifacts) - _REVIEW_INVALIDATION.keys()
    _require(not unknown, f"unknown changed artifact classes: {sorted(unknown)}")
    result = validate_snapshot(snapshot)
    invalidated = set().union(*(_REVIEW_INVALIDATION[name] for name in changed_artifacts))
    reviews = result.setdefault("reviews", {})
    history = result.setdefault("operational", {}).setdefault("reviewHistory", [])
    for kind in sorted(invalidated):
        review = reviews.pop(kind, None)
        if review is not None:
            history.append({"kind": kind, "assertion": review, "invalidatedBy": sorted(changed_artifacts)})
    return validate_snapshot(result)


def validate_snapshot(snapshot: Any, *, validate_reviews: bool = True) -> dict[str, Any]:
    _require(isinstance(snapshot, dict), "snapshot must be an object")
    _require(snapshot.get("schemaVersion") == 1, "schemaVersion must be 1")
    _require(isinstance(snapshot.get("sessionId"), str) and bool(snapshot["sessionId"]), "sessionId is required")
    assets = snapshot.get("assets")
    _require(isinstance(assets, dict), "assets is required")
    _validate_asset(assets.get("scene"), "assets.scene")
    _validate_asset(assets.get("cleanBackground"), "assets.cleanBackground")
    restore = snapshot.get("restore")
    _require(isinstance(restore, dict), "restore provenance is required")
    _validate_asset(restore.get("asset"), "restore.asset")
    _require(restore.get("sourceSceneSha256") == assets["scene"]["sha256"], "restore scene provenance mismatch")

    birds = snapshot.get("birds")
    _require(isinstance(birds, list), "birds must be a list")
    ids: set[str] = set()
    slots: set[str] = set()
    for index, bird in enumerate(birds):
        label = f"birds[{index}]"
        _require(isinstance(bird, dict), f"{label} must be an object")
        bird_id = bird.get("birdId")
        slot = bird.get("compatibilitySlot")
        _require(
            isinstance(bird_id, str)
            and bool(BIRD_ID_RE.fullmatch(bird_id))
            and not bool(SLOT_RE.fullmatch(bird_id)),
            f"{label}.birdId is invalid",
        )
        _require(bird_id not in ids, f"duplicate birdId: {bird_id}")
        ids.add(bird_id)
        _require(isinstance(slot, str) and bool(SLOT_RE.fullmatch(slot)), f"{label}.compatibilitySlot is invalid")
        _require(slot not in slots, f"duplicate compatibilitySlot: {slot}")
        slots.add(slot)
        _require(isinstance(bird.get("presentationOrder"), int) and bird["presentationOrder"] >= 0, f"{label}.presentationOrder is invalid")
        hitbox = bird.get("hitbox")
        _require(isinstance(hitbox, dict) and all(isinstance(hitbox.get(k), int) for k in ("x", "y", "r")) and hitbox["r"] > 0, f"{label}.hitbox is invalid")
        # CL-3: a bird may exist pre-extraction — hitbox only, no generation,
        # no sprite, no cleanup (the DAG reports the pending extract
        # obligation). When present, each block is validated strictly.
        generation = bird.get("activeGeneration")
        sprite = bird.get("sprite")
        cleanup = bird.get("cleanup")
        if generation is not None:
            _require(isinstance(generation, dict) and isinstance(generation.get("generationId"), str) and bool(generation["generationId"]), f"{label}.activeGeneration is invalid")
            _require(generation.get("inputSceneSha256") == assets["scene"]["sha256"], f"{label} generation provenance mismatch")
        if sprite is not None:
            _require(generation is not None, f"{label}.sprite requires activeGeneration provenance")
            _require(isinstance(sprite, dict), f"{label}.sprite is required")
            _validate_asset(sprite.get("asset"), f"{label}.sprite.asset")
            placement = sprite.get("placement")
            _require(isinstance(placement, dict) and all(isinstance(placement.get(k), int) for k in ("x", "y", "width", "height")) and placement["width"] > 0 and placement["height"] > 0, f"{label}.sprite.placement is invalid")
            _require(isinstance(sprite.get("anchorX"), (int, float)) and 0 <= sprite["anchorX"] <= 1, f"{label}.sprite.anchorX is invalid")
            _require(isinstance(sprite.get("anchorY"), (int, float)) and 0 <= sprite["anchorY"] <= 1, f"{label}.sprite.anchorY is invalid")
            _require(isinstance(sprite.get("flipX"), bool) and isinstance(sprite.get("flipY"), bool), f"{label}.sprite flips are invalid")
            _require(isinstance(cleanup, dict) and all(isinstance(cleanup.get(k), int) for k in ("x", "y", "width", "height")) and cleanup["width"] > 0 and cleanup["height"] > 0, f"{label}.cleanup is invalid")
            _require(cleanup.get("sourceSpriteSha256") == sprite["asset"]["sha256"], f"{label} cleanup provenance mismatch")
        else:
            _require(cleanup is None, f"{label}.cleanup requires a sprite")

    _require(isinstance(snapshot.get("operational", {}), dict), "operational must be an object")
    reviews = snapshot.get("reviews", {})
    _require(isinstance(reviews, dict), "reviews must be an object")
    if validate_reviews:
        content_revision = snapshot_revisions(snapshot).content_revision
        for kind, review in reviews.items():
            _require(kind in {"hitboxes", "finalCutouts"}, f"unknown review assertion: {kind}")
            _require(isinstance(review, dict), f"{kind} review must be an object")
            scope_revision = review.get("scopeRevision")
            if scope_revision is None:
                _require(review.get("contentRevision") == content_revision, f"{kind} review contentRevision is stale")
            else:
                _require(scope_revision == review_scope_revision(snapshot, kind), f"{kind} review scopeRevision is stale")
            _require(isinstance(review.get("reviewer"), str) and review["reviewer"].startswith("human:"), f"{kind} review requires an attributable human")
            _require(isinstance(review.get("reviewedAt"), str) and bool(review["reviewedAt"]), f"{kind} review reviewedAt is required")
    return copy.deepcopy(snapshot)


class CanonicalRevisionStore:
    def __init__(self, session_root: Path):
        self.session_root = Path(session_root)
        self.root = self.session_root / ".canonical"
        self.revisions_dir = self.root / "revisions"
        self.staging_dir = self.root / "staging"
        self.pointer_path = self.root / "current.json"
        self.quarantine_path = self.root / "quarantine.json"
        self.lock_path = self.root / "commit.lock"

    def read(self, *, inspect_quarantined_source: bool = False) -> CanonicalReadResult:
        """Read current authority; migration may explicitly inspect beneath quarantine."""
        if self.quarantine_path.exists() and not inspect_quarantined_source:
            try:
                quarantine = json.loads(self.quarantine_path.read_text())
                issues = quarantine.get("issues")
                detail = ", ".join(issues) if isinstance(issues, list) else "quarantine marker present"
            except (OSError, ValueError, json.JSONDecodeError):
                detail = "unreadable quarantine marker"
            return CanonicalReadResult(CanonicalReadState.QUARANTINED_INTEGRITY, detail=detail)
        if not self.pointer_path.exists():
            state = CanonicalReadState.ORPHANED_STAGE if self.staging_dir.exists() and any(self.staging_dir.iterdir()) else CanonicalReadState.MIGRATION_REQUIRED
            return CanonicalReadResult(state)
        try:
            pointer_raw = json.loads(self.pointer_path.read_text())
            if not isinstance(pointer_raw, dict):
                raise ValueError(f"pointer must be an object, got {type(pointer_raw).__name__}")
            if pointer_raw.get("schemaVersion") != 1:
                raise ValueError(f"unsupported pointer schemaVersion: {pointer_raw.get('schemaVersion')!r}")
            pointer = RevisionPointer(
                revision_file=pointer_raw["revisionFile"],
                content_revision=pointer_raw["contentRevision"],
                operational_revision=pointer_raw["operationalRevision"],
            )
            if Path(pointer.revision_file).name != pointer.revision_file:
                raise ValueError("unsafe revision filename")
            snapshot_path = self.revisions_dir / pointer.revision_file
            snapshot_bytes = snapshot_path.read_bytes()
            file_digest = hashlib.sha256(snapshot_bytes).hexdigest()
            if f"revision-{file_digest}.json" != pointer.revision_file:
                raise ValueError(
                    f"revision file bytes do not match its name: recomputed {file_digest[:12]}…"
                )  # detail contract: readers match on "match its name"
            snapshot = json.loads(snapshot_bytes)
            validated = validate_snapshot(snapshot)
            revisions = snapshot_revisions(validated)
            if revisions.content_revision != pointer.content_revision or revisions.operational_revision != pointer.operational_revision:
                raise ValueError("pointer revision mismatch")
            return CanonicalReadResult(CanonicalReadState.VALID_CURRENT, validated, pointer)
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, ContractValidationError) as exc:
            return CanonicalReadResult(CanonicalReadState.QUARANTINED_INTEGRITY, detail=str(exc))

    def snapshot_for_content_revision(self, content_revision: str) -> dict[str, Any] | None:
        """Return the immutable snapshot for an exact historical content revision."""
        if not self.revisions_dir.is_dir():
            return None
        match: dict[str, Any] | None = None
        for path in self.revisions_dir.glob("revision-*.json"):
            try:
                raw = path.read_bytes()
                if f"revision-{hashlib.sha256(raw).hexdigest()}.json" != path.name:
                    continue  # tampered/corrupt historical file is not evidence
                snapshot = validate_snapshot(json.loads(raw))
            except (OSError, ValueError, json.JSONDecodeError, ContractValidationError):
                continue
            if snapshot_revisions(snapshot).content_revision != content_revision:
                continue
            if match is not None and _content_projection(match) != _content_projection(snapshot):
                raise ContractValidationError("content revision resolves to conflicting snapshots")
            match = snapshot
        return copy.deepcopy(match)

    def _referenced_assets(self, snapshot: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        assets = [("assets.scene", snapshot["assets"]["scene"]),
                  ("assets.cleanBackground", snapshot["assets"]["cleanBackground"]),
                  ("restore.asset", snapshot["restore"]["asset"])]
        for index, bird in enumerate(snapshot.get("birds", [])):
            sprite_asset = (bird.get("sprite") or {}).get("asset")
            if isinstance(sprite_asset, dict):
                assets.append((f"birds[{index}].sprite.asset", sprite_asset))
            painted = (bird.get("activeGeneration") or {}).get("paintedAsset")
            if isinstance(painted, dict):
                assets.append((f"birds[{index}].activeGeneration.paintedAsset", painted))
        return assets

    def verify_and_store_assets(self, snapshot: dict[str, Any]) -> None:
        """FF-1: a snapshot may only commit if every referenced asset exists on disk
        with the exact declared bytes+sha256; verified bytes are mirrored into the
        immutable CAS at .canonical/objects/<sha256><ext> (deduplicated)."""
        objects_dir = self.root / "objects"
        for label, descriptor in self._referenced_assets(snapshot):
            relative = Path(descriptor["path"])
            if relative.is_absolute() or ".." in relative.parts:
                raise ContractValidationError(f"{label}.path escapes the session: {descriptor['path']!r}")
            source = self.session_root / relative
            data: bytes | None = None
            if source.is_file():
                candidate = source.read_bytes()
                if (
                    hashlib.sha256(candidate).hexdigest() == descriptor["sha256"]
                    and len(candidate) == descriptor["bytes"]
                ):
                    data = candidate
            if data is None:
                # Digest-addressed fallback: crash-safe writers (promote's scene
                # lane) stage new bytes under objects/ or staging/ before the
                # path projection is replaced post-commit. Truth is the digest,
                # the path file is a projection.
                suffix = source.suffix.lower()
                for candidate_path in (
                    objects_dir / f"{descriptor['sha256']}{suffix}",
                    self.staging_dir / f"scene-{descriptor['sha256']}{suffix}",
                ):
                    if candidate_path.is_file():
                        candidate = candidate_path.read_bytes()
                        if (
                            hashlib.sha256(candidate).hexdigest() == descriptor["sha256"]
                            and len(candidate) == descriptor["bytes"]
                        ):
                            data = candidate
                            break
            if data is None:
                found = "missing"
                if source.is_file():
                    on_disk = source.read_bytes()
                    found = f"{hashlib.sha256(on_disk).hexdigest()[:12]}…/{len(on_disk)}b"
                raise ContractValidationError(
                    f"{label} bytes match neither their path nor a digest-addressed "
                    f"object (declared {descriptor['sha256'][:12]}…/{descriptor['bytes']}b, "
                    f"path has {found}): {descriptor['path']}"
                )
            digest = descriptor["sha256"]
            objects_dir.mkdir(parents=True, exist_ok=True)
            target = objects_dir / f"{digest}{source.suffix.lower()}"
            target_valid = (
                target.exists()
                and hashlib.sha256(target.read_bytes()).hexdigest() == digest
            )
            if not target_valid:
                # Missing OR corrupt digest-named object: (re)write atomically —
                # a truncated object must never survive a successful commit.
                stage_fd, stage_name = tempfile.mkstemp(prefix="object-", dir=objects_dir)
                try:
                    with os.fdopen(stage_fd, "wb") as staged:
                        staged.write(data)
                        staged.flush()
                        os.fsync(staged.fileno())
                    os.replace(stage_name, target)
                finally:
                    Path(stage_name).unlink(missing_ok=True)

    def commit(
        self,
        snapshot: dict[str, Any],
        *,
        expected_content_revision: str | None,
        expected_operational_revision: str | None = None,
    ) -> RevisionPointer:
        validated = validate_snapshot(snapshot)
        revisions = snapshot_revisions(validated)
        # Cheap pre-check before touching asset bytes (perf: a stale commit
        # must not read/hash megabytes first). The authoritative check runs
        # again under the lock — this one only fails fast, never authorizes.
        pre = self.read()
        pre_actual = pre.pointer.content_revision if pre.state is CanonicalReadState.VALID_CURRENT and pre.pointer else None
        if pre_actual != expected_content_revision:
            raise RevisionConflictError(expected_content_revision, pre_actual)
        self.verify_and_store_assets(validated)
        self.root.mkdir(parents=True, exist_ok=True)
        self.revisions_dir.mkdir(exist_ok=True)
        self.staging_dir.mkdir(exist_ok=True)
        self.lock_path.touch(exist_ok=True)
        with self.lock_path.open("rb") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            current = self.read()
            actual = current.pointer.content_revision if current.state is CanonicalReadState.VALID_CURRENT and current.pointer else None
            if actual != expected_content_revision:
                raise RevisionConflictError(expected_content_revision, actual)
            actual_operational = (
                current.pointer.operational_revision
                if current.state is CanonicalReadState.VALID_CURRENT and current.pointer
                else None
            )
            if expected_operational_revision is not None and actual_operational != expected_operational_revision:
                raise RevisionConflictError(expected_operational_revision, actual_operational)

            encoded = (canonical_json(validated) + "\n").encode("utf-8")
            snapshot_digest = hashlib.sha256(encoded).hexdigest()
            revision_file = f"revision-{snapshot_digest}.json"
            stage_fd, stage_name = tempfile.mkstemp(prefix="revision-", suffix=".json", dir=self.staging_dir)
            try:
                with os.fdopen(stage_fd, "wb") as staged:
                    staged.write(encoded)
                    staged.flush()
                    os.fsync(staged.fileno())
                destination = self.revisions_dir / revision_file
                if destination.exists() and destination.read_bytes() == encoded:
                    Path(stage_name).unlink()
                else:
                    # Missing OR corrupt (bytes ≠ digest-named content): install
                    # the freshly staged bytes — reusing an unverified existing
                    # file would commit a pointer read() immediately quarantines.
                    os.replace(stage_name, destination)
                    self._fsync_dir(self.revisions_dir)
                pointer = RevisionPointer(revision_file, revisions.content_revision, revisions.operational_revision)
                self._atomic_pointer_write(pointer)
                return pointer
            finally:
                Path(stage_name).unlink(missing_ok=True)

    def _atomic_pointer_write(self, pointer: RevisionPointer) -> None:
        payload = {
            "schemaVersion": 1,
            "revisionFile": pointer.revision_file,
            "contentRevision": pointer.content_revision,
            "operationalRevision": pointer.operational_revision,
        }
        fd, name = tempfile.mkstemp(prefix="current-", suffix=".json", dir=self.root)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write((canonical_json(payload) + "\n").encode("utf-8"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, self.pointer_path)
            self._fsync_dir(self.root)
        finally:
            Path(name).unlink(missing_ok=True)

    @staticmethod
    def _fsync_dir(path: Path) -> None:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
