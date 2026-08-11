"""Canonical Find the Bird authoring-content revision contract.

This module is intentionally independent from legacy session hydration and
public packages.  It gives migrations and mutation routes one fail-closed
authority to build on; it does not infer identity from folders, geometry, or
array positions.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


def semantic_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class AssetDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size: int = Field(ge=0)

    @model_validator(mode="after")
    def _path_is_relative(self) -> Self:
        path = Path(self.path)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("asset path must stay inside the authoring revision")
        return self


class HitboxGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    x: int
    y: int
    r: int = Field(ge=1)


class SpriteBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    image: AssetDescriptor
    spriteBox: tuple[int, int, int, int]
    cleanupBox: tuple[int, int, int, int]
    anchorX: float = Field(ge=0.0, le=1.0)
    anchorY: float = Field(ge=0.0, le=1.0)
    flipX: bool = False
    flipY: bool = False

    @model_validator(mode="after")
    def _valid_boxes(self) -> Self:
        for name, box in (("spriteBox", self.spriteBox), ("cleanupBox", self.cleanupBox)):
            if box[2] <= box[0] or box[3] <= box[1]:
                raise ValueError(f"{name} must have positive area")
        target_x = self.spriteBox[0] + self.anchorX * (self.spriteBox[2] - self.spriteBox[0])
        target_y = self.spriteBox[1] + self.anchorY * (self.spriteBox[3] - self.spriteBox[1])
        if not (
            self.cleanupBox[0] <= target_x <= self.cleanupBox[2]
            and self.cleanupBox[1] <= target_y <= self.cleanupBox[3]
        ):
            raise ValueError("cleanupBox must contain the placed sprite anchor")
        return self


class BirdArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    birdId: str = Field(min_length=1)
    compatibilitySlot: str = Field(pattern=r"^dog_\d{2,}$")
    hitbox: HitboxGeometry
    sprite: SpriteBinding


class RestoreBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    image: AssetDescriptor
    sourceSceneSha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    sourceHitboxesSha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ContentManifest(BaseModel):
    """Immutable reviewed content; gallery/lineup/job state never belongs here."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schemaVersion: Literal[1]
    sessionId: str = Field(min_length=1)
    scene: AssetDescriptor
    restore: RestoreBinding
    birds: tuple[BirdArtifact, ...] = Field(min_length=1)
    presentationOrder: tuple[str, ...]

    @model_validator(mode="after")
    def _identity_sets_are_complete(self) -> Self:
        bird_ids = [bird.birdId for bird in self.birds]
        slots = [bird.compatibilitySlot for bird in self.birds]
        if len(set(bird_ids)) != len(bird_ids):
            raise ValueError("birdId values must be unique")
        if len(set(slots)) != len(slots):
            raise ValueError("compatibilitySlot values must be unique")
        if len(set(self.presentationOrder)) != len(self.presentationOrder):
            raise ValueError("presentationOrder values must be unique")
        if set(self.presentationOrder) != set(bird_ids):
            raise ValueError("presentationOrder must contain every birdId exactly once")
        if self.restore.sourceSceneSha256 != self.scene.sha256:
            raise ValueError("restore provenance must reference the selected scene")
        return self

    @property
    def content_revision(self) -> str:
        # Gallery ordering is operational presentation state.  The tuple order
        # of birds is the identity-bearing compatibility/runtime slot order.
        return semantic_sha256(self.model_dump(mode="json", exclude={"presentationOrder"}))


class ArtifactRevisionConflict(RuntimeError):
    def __init__(self, expected_revision: str | None, actual_revision: str | None) -> None:
        self.expected_revision = expected_revision
        self.actual_revision = actual_revision
        super().__init__(
            f"content revision conflict: expected {expected_revision!r}, actual {actual_revision!r}"
        )


class RevisionRead(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["current", "migration_required", "quarantined_integrity"]
    content_revision: str | None = None
    manifest: ContentManifest | None = None
    reason: str | None = None


class RevisionCommit(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    content_revision: str
    manifest_path: str


class ArtifactRevisionStore:
    """Filesystem revision store with cross-process compare-and-set commits."""

    def __init__(self, session_dir: Path) -> None:
        self.session_dir = session_dir
        self.revisions_dir = session_dir / ".artifact-revisions"
        self.pointer_path = self.revisions_dir / "current.json"
        self.lock_path = session_dir / ".artifact-revisions.lock"

    @contextmanager
    def _locked(self):
        self.session_dir.mkdir(parents=True, exist_ok=True)
        with open(self.lock_path, "a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def read(self) -> RevisionRead:
        if not self.pointer_path.exists():
            return RevisionRead(status="migration_required", reason="current revision pointer is absent")
        try:
            pointer = json.loads(self.pointer_path.read_text())
            revision = pointer["contentRevision"]
            if not isinstance(revision, str) or len(revision) != 64:
                raise ValueError("invalid contentRevision")
            manifest_path = self.revisions_dir / revision / "manifest.json"
            manifest = ContentManifest.model_validate_json(manifest_path.read_bytes())
            if manifest.content_revision != revision:
                raise ValueError("manifest hash does not match current pointer")
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            return RevisionRead(status="quarantined_integrity", reason=str(error))
        return RevisionRead(status="current", content_revision=revision, manifest=manifest)

    @staticmethod
    def _fsync_dir(path: Path) -> None:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def commit(
        self,
        manifest: ContentManifest,
        *,
        expected_revision: str | None,
    ) -> RevisionCommit:
        if manifest.sessionId != self.session_dir.name:
            raise ValueError("manifest sessionId must match the authoring directory")
        with self._locked():
            current = self.read()
            actual = current.content_revision if current.status == "current" else None
            if current.status == "quarantined_integrity":
                raise ValueError(f"cannot commit over quarantined revision state: {current.reason}")
            if actual != expected_revision:
                raise ArtifactRevisionConflict(expected_revision, actual)

            revision = manifest.content_revision
            self.revisions_dir.mkdir(parents=True, exist_ok=True)
            target = self.revisions_dir / revision
            if not target.exists():
                stage = self.revisions_dir / f".stage-{os.getpid()}-{uuid.uuid4().hex[:8]}"
                stage.mkdir()
                try:
                    manifest_path = stage / "manifest.json"
                    with open(manifest_path, "wb") as handle:
                        handle.write(manifest.model_dump_json(indent=2).encode("utf-8"))
                        handle.flush()
                        os.fsync(handle.fileno())
                    self._fsync_dir(stage)
                    os.replace(stage, target)
                    self._fsync_dir(self.revisions_dir)
                finally:
                    if stage.exists():
                        shutil.rmtree(stage)

            pointer_tmp = self.pointer_path.with_name(
                f".current-{os.getpid()}-{uuid.uuid4().hex[:8]}.json"
            )
            with open(pointer_tmp, "w") as handle:
                json.dump({"schemaVersion": 1, "contentRevision": revision}, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(pointer_tmp, self.pointer_path)
            self._fsync_dir(self.revisions_dir)
            return RevisionCommit(
                content_revision=revision,
                manifest_path=str((target / "manifest.json").relative_to(self.session_dir)),
            )
