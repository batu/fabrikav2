"""One revisioned, lossless owner for FTD current authoring sessions."""

from __future__ import annotations

import fcntl
import hashlib
import os
import re
import threading
import uuid
import weakref
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..fs import AtomicBundleStore, PublishedBundle, atomic_write_bytes
from ..settings import WorkspacePaths
from .dogs import DogBundlePayload, set_active_variant
from .gallery import GallerySession, gallery_metadata, update_gallery_metadata
from .model import AuthoringSession


class ReservationRejected(RuntimeError):
    """Raised instead of racing a second publication for the same dog."""


class SessionNotFound(FileNotFoundError):
    pass


class SessionAlreadyExists(FileExistsError):
    pass


class SessionRevisionConflict(RuntimeError):
    def __init__(self, current: "SessionSnapshot") -> None:
        super().__init__(f"session revision is stale; current revision is {current.revision}")
        self.current = current


@dataclass(frozen=True, slots=True)
class SessionProvenance:
    source: str
    session_sha256: str
    file_count: int


@dataclass(frozen=True, slots=True)
class SessionSnapshot:
    session_id: str
    revision: str
    session: AuthoringSession
    provenance: SessionProvenance


@dataclass(frozen=True, slots=True)
class DogBundlePublication:
    session_id: str
    dog_key: str
    variant_index: int
    bundle_id: str
    path: Path


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")


class SessionStore:
    """Owns current-session load, compare-and-swap mutation, and reservations."""

    _registry_guard = threading.Lock()
    _process_locks: weakref.WeakValueDictionary[str, threading.Lock] = (
        weakref.WeakValueDictionary()
    )

    def __init__(self, paths: WorkspacePaths):
        self.paths = paths
        self.paths.approve_filesystems()
        self.bundles = AtomicBundleStore(paths.authoring / ".ftd-session-bundles")
        self.bundles.recover()

    def names(self) -> tuple[str, ...]:
        return ("sessions",)

    @property
    def sessions(self) -> "SessionStore":
        return self

    @staticmethod
    def _validate_identifier(value: str, label: str) -> str:
        if not _IDENTIFIER.fullmatch(value):
            raise ValueError(f"invalid {label}: {value!r}")
        return value

    def _session_dir(self, session_id: str) -> Path:
        return self.paths.authoring / self._validate_identifier(session_id, "session id")

    @classmethod
    def _process_lock(cls, path: Path) -> threading.Lock:
        key = str(path)
        with cls._registry_guard:
            return cls._process_locks.setdefault(key, threading.Lock())

    @contextmanager
    def _exclusive(self, key: str, *, wait: bool = True) -> Iterator[None]:
        self.paths.locks.mkdir(parents=True, exist_ok=True)
        lock_name = hashlib.sha256(key.encode("utf-8")).hexdigest() + ".session.lock"
        lock_path = self.paths.locks / lock_name
        process_lock = self._process_lock(lock_path)
        if not process_lock.acquire(blocking=wait):
            raise ReservationRejected(f"{key!r} is already reserved")
        descriptor: int | None = None
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            operation = fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB)
            try:
                fcntl.flock(descriptor, operation)
            except BlockingIOError as error:
                raise ReservationRejected(f"{key!r} is already reserved") from error
            yield
        finally:
            if descriptor is not None:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)
            process_lock.release()

    @contextmanager
    def reserve_dog(
        self,
        session_id: str,
        dog_key: str,
        *,
        wait: bool = False,
    ) -> Iterator[None]:
        session = self._validate_identifier(session_id, "session id")
        dog = self._validate_identifier(dog_key, "dog key")
        with self._exclusive(f"dog:{session}:{dog}", wait=wait):
            yield

    @staticmethod
    def _tree_revision(session_dir: Path) -> tuple[str, int]:
        digest = hashlib.sha256()
        file_count = 0
        for path in sorted(session_dir.rglob("*")):
            relative = path.relative_to(session_dir).as_posix()
            if path.is_symlink():
                digest.update(
                    b"symlink\0"
                    + relative.encode()
                    + b"\0"
                    + os.readlink(path).encode()
                )
                file_count += 1
            elif path.is_file():
                digest.update(b"file\0" + relative.encode() + b"\0")
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                file_count += 1
        return f"sha256:{digest.hexdigest()}", file_count

    def load(self, session_id: str) -> SessionSnapshot:
        session_dir = self._session_dir(session_id)
        session_path = session_dir / "session.json"
        if not session_path.is_file() or session_path.is_symlink():
            raise SessionNotFound(session_id)
        for _attempt in range(2):
            revision_before, _ = self._tree_revision(session_dir)
            raw = session_path.read_bytes()
            revision, file_count = self._tree_revision(session_dir)
            if revision == revision_before:
                break
        else:
            raise RuntimeError(f"session {session_id!r} changed continuously while reading")
        session = AuthoringSession.from_bytes(raw)
        if session.id != session_id:
            raise ValueError(
                f"session id mismatch: directory={session_id!r}, payload={session.id!r}"
            )
        return SessionSnapshot(
            session_id=session_id,
            revision=revision,
            session=session,
            provenance=SessionProvenance(
                source="current-session",
                session_sha256=f"sha256:{hashlib.sha256(raw).hexdigest()}",
                file_count=file_count,
            ),
        )

    def create(self, value: AuthoringSession | Mapping[str, Any]) -> SessionSnapshot:
        session = (
            value
            if isinstance(value, AuthoringSession)
            else AuthoringSession.from_mapping(dict(value))
        )
        session_id = self._validate_identifier(session.id, "session id")
        session_dir = self._session_dir(session_id)
        with self._exclusive(f"session:{session_id}"):
            try:
                session_dir.mkdir()
            except FileExistsError as error:
                raise SessionAlreadyExists(session_id) from error
            try:
                atomic_write_bytes(
                    session_dir / "session.json",
                    session.to_bytes(),
                    staging_dir=self.paths.state / "session-write-staging",
                )
            except BaseException:
                if session_dir.exists() and not any(session_dir.iterdir()):
                    session_dir.rmdir()
                raise
            return self.load(session_id)

    def _save_locked(
        self,
        session_id: str,
        session: AuthoringSession,
        *,
        expected_revision: str,
    ) -> SessionSnapshot:
        current = self.load(session_id)
        if current.revision != expected_revision:
            raise SessionRevisionConflict(current)
        return self._commit_locked(current, session)

    def _commit_locked(
        self,
        current: SessionSnapshot,
        session: AuthoringSession,
    ) -> SessionSnapshot:
        session_id = current.session_id
        if session.id != session_id:
            raise ValueError("session mutation cannot change session id")
        if session is current.session or session.to_mapping() == current.session.to_mapping():
            return current

        def reject_late_drift() -> None:
            observed_revision, _ = self._tree_revision(self._session_dir(session_id))
            if observed_revision != current.revision:
                raise SessionRevisionConflict(self.load(session_id))

        atomic_write_bytes(
            self._session_dir(session_id) / "session.json",
            session.to_bytes(),
            staging_dir=self.paths.state / "session-write-staging",
            before_replace=reject_late_drift,
        )
        return self.load(session_id)

    def save(
        self,
        session_id: str,
        session: AuthoringSession,
        *,
        expected_revision: str,
    ) -> SessionSnapshot:
        with self._exclusive(f"session:{session_id}"):
            return self._save_locked(session_id, session, expected_revision=expected_revision)

    def mutate(
        self,
        session_id: str,
        *,
        expected_revision: str,
        mutation: Callable[[AuthoringSession], AuthoringSession],
    ) -> SessionSnapshot:
        with self._exclusive(f"session:{session_id}"):
            current = self.load(session_id)
            if current.revision != expected_revision:
                raise SessionRevisionConflict(current)
            return self._commit_locked(current, mutation(current.session))

    def set_dog_active_variant(
        self,
        session_id: str,
        dog_id: str,
        active_variant: int | None,
        *,
        expected_revision: str,
    ) -> SessionSnapshot:
        return self.mutate(
            session_id,
            expected_revision=expected_revision,
            mutation=lambda session: set_active_variant(session, dog_id, active_variant),
        )

    def set_gallery_metadata(
        self,
        session_id: str,
        *,
        expected_revision: str,
        tags: list[str] | None,
        archived: bool | None,
    ) -> SessionSnapshot:
        return self.mutate(
            session_id,
            expected_revision=expected_revision,
            mutation=lambda session: update_gallery_metadata(
                session, tags=tags, archived=archived
            ),
        )

    def list_gallery(self) -> list[GallerySession]:
        if not self.paths.authoring.exists():
            return []
        results: list[GallerySession] = []
        for path in sorted(self.paths.authoring.iterdir()):
            if path.name.startswith(".") or not path.is_dir() or path.is_symlink():
                continue
            try:
                snapshot = self.load(path.name)
            except (SessionNotFound, ValueError):
                continue
            tags, archived = gallery_metadata(snapshot.session)
            results.append(
                GallerySession(
                    session_id=snapshot.session_id,
                    revision=snapshot.revision,
                    dog_count=len(snapshot.session.dogs),
                    tags=tags,
                    archived=archived,
                )
            )
        return results

    def _next_variant_index(self, session_id: str, dog_key: str) -> int:
        selection = f"sessions/{session_id}/dogs/{dog_key}/current"
        try:
            manifest = self.bundles.resolve_manifest(selection)
        except FileNotFoundError:
            return 0
        metadata = manifest.get("metadata")
        if not isinstance(metadata, dict):
            raise ValueError("selected dog bundle has no allocation metadata")
        index = metadata.get("variantIndex")
        if not isinstance(index, int) or index < 0:
            raise ValueError("selected dog bundle has an invalid variant index")
        return index + 1

    def publish_dog_bundle(
        self,
        session_id: str,
        dog_key: str,
        build: Callable[[int], DogBundlePayload],
        *,
        wait_for_reservation: bool = False,
    ) -> DogBundlePublication:
        with self.reserve_dog(session_id, dog_key, wait=wait_for_reservation):
            session = session_id
            dog = dog_key
            variant_index = self._next_variant_index(session, dog)
            payload = build(variant_index)
            if not isinstance(payload, DogBundlePayload):
                raise TypeError("dog bundle builder must return DogBundlePayload")
            raw_bundle = payload.as_bundle(
                session_id=session,
                dog_key=dog,
                variant_index=variant_index,
            )
            bundle_id = (
                f"{session}-{dog}-variant-{variant_index:03d}-{uuid.uuid4().hex[:12]}"
            )
            published: PublishedBundle = self.bundles.publish(
                f"sessions/{session}/dogs/{dog}/current",
                raw_bundle,
                bundle_id=bundle_id,
            )
            return DogBundlePublication(
                session_id=session,
                dog_key=dog,
                variant_index=variant_index,
                bundle_id=published.bundle_id,
                path=published.path,
            )

    def recover(self) -> None:
        self.bundles.recover()
