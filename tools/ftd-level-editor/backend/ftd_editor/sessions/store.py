"""One revisioned, lossless owner for FTD current authoring sessions."""

from __future__ import annotations

import copy
import errno
import fcntl
import hashlib
import io
import os
import re
import shutil
import stat
import threading
import uuid
import weakref
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..fs import (
    AtomicBundleStore,
    PublishedBundle,
    atomic_write_bytes,
    encode_json,
    ensure_durable_directory,
)
from ..settings import WorkspacePaths
from .dogs import DogBundlePayload, require_stable_dog, set_active_variant
from .gallery import (
    CaptureVariant,
    GallerySession,
    capture_source_candidates,
    gallery_metadata,
    update_gallery_metadata,
)
from .model import AuthoringSession


class ReservationRejected(RuntimeError):
    """Raised instead of racing a second publication for the same dog."""


class SessionNotFound(FileNotFoundError):
    pass


class SessionReadError(RuntimeError):
    pass


class SessionCommitIndeterminate(RuntimeError):
    def __init__(self, session_id: str) -> None:
        super().__init__(
            f"session {session_id!r} was published but its durability is indeterminate"
        )
        self.session_id = session_id


class SessionAlreadyExists(FileExistsError):
    pass


class SessionImageNotFound(FileNotFoundError):
    pass


class _TransientTreeChange(SessionReadError):
    pass


class _SessionReplaceIndeterminate(RuntimeError):
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
class SessionImageCapture:
    session_id: str
    revision: str
    source: str
    sha256: str
    media_type: str
    content: bytes


@dataclass(frozen=True, slots=True)
class DogBundlePublication:
    session_id: str
    dog_key: str
    variant_index: int
    bundle_id: str
    path: Path


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
_MISSING_SESSION_ERRNOS = {errno.ENOENT, errno.ENOTDIR, errno.ELOOP}


def _is_missing_session_error(error: OSError) -> bool:
    return isinstance(error, SessionNotFound) or error.errno in _MISSING_SESSION_ERRNOS


def _same_json_value(left: Any, right: Any) -> bool:
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(
            _same_json_value(left[key], right[key]) for key in left
        )
    if isinstance(left, list):
        return len(left) == len(right) and all(
            _same_json_value(left_item, right_item)
            for left_item, right_item in zip(left, right, strict=True)
        )
    return left == right


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
        self._recover_session_creations()

    @staticmethod
    def _validate_identifier(value: str, label: str) -> str:
        if not _IDENTIFIER.fullmatch(value):
            raise ValueError(f"invalid {label}: {value!r}")
        return value

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
    def _digest_frame(digest: Any, *parts: str | bytes | int) -> None:
        for part in parts:
            if isinstance(part, bytes):
                encoded = part
            else:
                encoded = str(part).encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)

    @classmethod
    def _tree_revision_fd(
        cls,
        directory_fd: int,
        *,
        prefix: str = "",
    ) -> tuple[str, int]:
        digest = hashlib.sha256()
        file_count = 0

        def walk(active_fd: int, active_prefix: str) -> None:
            nonlocal file_count
            with os.scandir(active_fd) as iterator:
                entries = sorted(iterator, key=lambda entry: entry.name)
            for entry in entries:
                relative = f"{active_prefix}/{entry.name}" if active_prefix else entry.name
                metadata = entry.stat(follow_symlinks=False)
                mode = metadata.st_mode
                if stat.S_ISLNK(mode):
                    cls._digest_frame(
                        digest,
                        "symlink",
                        relative,
                        os.readlink(entry.name, dir_fd=active_fd),
                    )
                    file_count += 1
                elif stat.S_ISDIR(mode):
                    cls._digest_frame(digest, "directory", relative)
                    child_fd = os.open(entry.name, _DIRECTORY_FLAGS, dir_fd=active_fd)
                    try:
                        opened = os.fstat(child_fd)
                        if (opened.st_dev, opened.st_ino) != (
                            metadata.st_dev,
                            metadata.st_ino,
                        ):
                            raise _TransientTreeChange(
                                "session tree changed while opening directory"
                            )
                        walk(child_fd, relative)
                    finally:
                        os.close(child_fd)
                elif stat.S_ISREG(mode):
                    child_fd = os.open(entry.name, _FILE_FLAGS, dir_fd=active_fd)
                    try:
                        opened = os.fstat(child_fd)
                        if (opened.st_dev, opened.st_ino) != (
                            metadata.st_dev,
                            metadata.st_ino,
                        ):
                            raise _TransientTreeChange(
                                "session tree changed while opening file"
                            )
                        content_digest = hashlib.sha256()
                        size = 0
                        while chunk := os.read(child_fd, 1024 * 1024):
                            size += len(chunk)
                            content_digest.update(chunk)
                    finally:
                        os.close(child_fd)
                    cls._digest_frame(
                        digest,
                        "file",
                        relative,
                        size,
                        content_digest.digest(),
                    )
                    file_count += 1
                else:
                    cls._digest_frame(
                        digest,
                        "special",
                        relative,
                        stat.S_IFMT(mode),
                        metadata.st_rdev,
                        metadata.st_size,
                    )
                    file_count += 1

        walk(directory_fd, prefix)
        return f"sha256:{digest.hexdigest()}", file_count

    @classmethod
    def _tree_revision(cls, session_dir: Path) -> tuple[str, int]:
        descriptor = os.open(session_dir, _DIRECTORY_FLAGS)
        try:
            return cls._tree_revision_fd(descriptor)
        finally:
            os.close(descriptor)

    @contextmanager
    def _open_session_descriptors(
        self, session_id: str
    ) -> Iterator[tuple[int, int, os.stat_result]]:
        identifier = self._validate_identifier(session_id, "session id")
        try:
            authoring_fd = os.open(self.paths.authoring, _DIRECTORY_FLAGS)
        except OSError as error:
            if _is_missing_session_error(error):
                raise SessionNotFound(session_id) from error
            raise SessionReadError(f"could not open session {session_id!r}") from error
        session_fd: int | None = None
        try:
            before = os.stat(identifier, dir_fd=authoring_fd, follow_symlinks=False)
            if not stat.S_ISDIR(before.st_mode):
                raise SessionNotFound(session_id)
            session_fd = os.open(identifier, _DIRECTORY_FLAGS, dir_fd=authoring_fd)
            opened = os.fstat(session_fd)
            if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                raise SessionNotFound(session_id)
            yield authoring_fd, session_fd, opened
        except OSError as error:
            if isinstance(error, SessionNotFound):
                raise
            if _is_missing_session_error(error):
                raise SessionNotFound(session_id) from error
            raise SessionReadError(f"could not open session {session_id!r}") from error
        finally:
            if session_fd is not None:
                os.close(session_fd)
            os.close(authoring_fd)

    @staticmethod
    def _read_regular_file(directory_fd: int, filename: str) -> bytes:
        descriptor = os.open(filename, _FILE_FLAGS, dir_fd=directory_fd)
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise FileNotFoundError(filename)
            return io.FileIO(descriptor, "rb", closefd=False).readall()
        finally:
            os.close(descriptor)

    @staticmethod
    def _assert_session_link(
        authoring_fd: int,
        session_id: str,
        opened: os.stat_result,
    ) -> None:
        try:
            current = os.stat(session_id, dir_fd=authoring_fd, follow_symlinks=False)
        except OSError as error:
            if _is_missing_session_error(error):
                raise SessionNotFound(session_id) from error
            raise SessionReadError(
                f"could not verify session {session_id!r}"
            ) from error
        if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (
            opened.st_dev,
            opened.st_ino,
        ):
            raise SessionNotFound(session_id)

    def load(self, session_id: str) -> SessionSnapshot:
        for _attempt in range(2):
            try:
                with self._open_session_descriptors(session_id) as (
                    authoring_fd,
                    session_fd,
                    opened,
                ):
                    revision_before, _ = self._tree_revision_fd(session_fd)
                    raw = self._read_regular_file(session_fd, "session.json")
                    revision, file_count = self._tree_revision_fd(session_fd)
                    self._assert_session_link(
                        authoring_fd, session_id, opened
                    )
                    if revision == revision_before:
                        break
            except _TransientTreeChange as error:
                if _attempt:
                    raise SessionReadError(
                        f"session {session_id!r} changed continuously while reading"
                    ) from error
            except OSError as error:
                if not _is_missing_session_error(error):
                    raise SessionReadError(
                        f"could not read session {session_id!r}"
                    ) from error
                if _attempt:
                    raise SessionNotFound(session_id) from error
        else:
            raise SessionReadError(
                f"session {session_id!r} changed continuously while reading"
            )
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
        session_dir = self.paths.authoring / session_id
        stage_root = self.paths.authoring / ".ftd-session-create"
        with self._exclusive("session-create-staging"):
            ensure_durable_directory(stage_root)
            with self._exclusive(f"session:{session_id}"):
                if os.path.lexists(session_dir):
                    raise SessionAlreadyExists(session_id)
                stage = stage_root / uuid.uuid4().hex
                stage.mkdir()
                self._fsync_path(stage_root)
                published = False
                try:
                    atomic_write_bytes(
                        stage / "session.json",
                        session.to_bytes(),
                        staging_dir=self.paths.state / "session-write-staging",
                    )
                    os.rename(stage, session_dir)
                    published = True
                    self._fsync_path(self.paths.authoring)
                    return self.load(session_id)
                except BaseException as error:
                    if published:
                        raise SessionCommitIndeterminate(session_id) from error
                    if stage.exists() and not stage.is_symlink():
                        shutil.rmtree(stage)
                        self._fsync_path(stage_root)
                    raise

    @staticmethod
    def _fsync_path(path: Path) -> None:
        descriptor = os.open(path, _DIRECTORY_FLAGS)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _recover_session_creations(self) -> None:
        stage_root = self.paths.authoring / ".ftd-session-create"
        with self._exclusive("session-create-staging"):
            ensure_durable_directory(stage_root)
            changed = False
            for entry in stage_root.iterdir():
                if entry.is_symlink() or not entry.is_dir():
                    entry.unlink(missing_ok=True)
                else:
                    shutil.rmtree(entry)
                changed = True
            if changed:
                self._fsync_path(stage_root)

    def _atomic_write_session(
        self,
        directory_fd: int,
        content: bytes,
        *,
        before_replace: Callable[[], None],
    ) -> None:
        temporary = f".session.json.{uuid.uuid4().hex}.tmp"
        descriptor: int | None = None
        stage_fd: int | None = None
        replaced = False
        try:
            stage_root = ensure_durable_directory(
                self.paths.state / "session-write-staging"
            )
            stage_fd = os.open(stage_root, _DIRECTORY_FLAGS)
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=stage_fd,
            )
            view = memoryview(content)
            while view:
                written = os.write(descriptor, view)
                view = view[written:]
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = None
            before_replace()
            os.replace(
                temporary,
                "session.json",
                src_dir_fd=stage_fd,
                dst_dir_fd=directory_fd,
            )
            replaced = True
            os.fsync(directory_fd)
            os.fsync(stage_fd)
        except BaseException as error:
            if replaced:
                raise _SessionReplaceIndeterminate from error
            raise
        finally:
            if descriptor is not None:
                os.close(descriptor)
            if stage_fd is not None:
                try:
                    os.unlink(temporary, dir_fd=stage_fd)
                except FileNotFoundError:
                    pass
                os.close(stage_fd)

    def _commit_locked(
        self,
        current: SessionSnapshot,
        session: AuthoringSession,
        *,
        original_mapping: Mapping[str, Any],
    ) -> SessionSnapshot:
        session_id = current.session_id
        if session.id != session_id:
            raise ValueError("session mutation cannot change session id")
        if session.to_mapping() == original_mapping:
            return current

        with self._open_session_descriptors(session_id) as (
            authoring_fd,
            session_fd,
            opened,
        ):
            observed_revision, _ = self._tree_revision_fd(session_fd)
            if observed_revision != current.revision:
                raise SessionRevisionConflict(self.load(session_id))

            def reject_late_drift() -> None:
                self._assert_session_link(authoring_fd, session_id, opened)
                late_revision, _ = self._tree_revision_fd(session_fd)
                if late_revision != current.revision:
                    raise SessionRevisionConflict(self.load(session_id))

            try:
                self._atomic_write_session(
                    session_fd,
                    session.to_bytes(),
                    before_replace=reject_late_drift,
                )
            except _SessionReplaceIndeterminate as error:
                raise SessionCommitIndeterminate(session_id) from error
            try:
                self._assert_session_link(authoring_fd, session_id, opened)
            except Exception as error:
                raise SessionCommitIndeterminate(session_id) from error
        try:
            return self.load(session_id)
        except Exception as error:
            raise SessionCommitIndeterminate(session_id) from error

    def save(
        self,
        session_id: str,
        session: AuthoringSession,
        *,
        expected_revision: str,
    ) -> SessionSnapshot:
        return self.mutate(
            session_id,
            expected_revision=expected_revision,
            mutation=lambda _current: session,
        )

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
            original_mapping = current.session.to_mapping()
            changed = mutation(current.session)
            if not isinstance(changed, AuthoringSession):
                raise TypeError("session mutation must return AuthoringSession")
            return self._commit_locked(
                current,
                changed,
                original_mapping=original_mapping,
            )

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

    def capture_image(
        self,
        session_id: str,
        *,
        expected_revision: str,
        variant: CaptureVariant,
    ) -> SessionImageCapture:
        """Read one v1-compatible current image only at the named revision."""

        current = self.load(session_id)
        if current.revision != expected_revision:
            raise SessionRevisionConflict(current)
        candidates = capture_source_candidates(current.session, variant)
        source = None
        content = None
        try:
            with self._open_session_descriptors(session_id) as (
                authoring_fd,
                session_fd,
                opened,
            ):
                observed_revision, _ = self._tree_revision_fd(session_fd)
                if observed_revision != expected_revision:
                    raise SessionRevisionConflict(self.load(session_id))
                for candidate in candidates:
                    try:
                        metadata = os.stat(
                            candidate,
                            dir_fd=session_fd,
                            follow_symlinks=False,
                        )
                        if not stat.S_ISREG(metadata.st_mode):
                            continue
                        content = self._read_regular_file(session_fd, candidate)
                    except OSError as error:
                        if (
                            _is_missing_session_error(error)
                            or error.errno == errno.EMLINK
                        ):
                            continue
                        raise
                    source = candidate
                    break
                self._assert_session_link(authoring_fd, session_id, opened)
                final_revision, _ = self._tree_revision_fd(session_fd)
                if final_revision != expected_revision:
                    raise SessionRevisionConflict(self.load(session_id))
        except SessionRevisionConflict:
            raise
        except OSError as error:
            raise SessionReadError(
                f"could not capture image for session {session_id!r}"
            ) from error
        if source is None or content is None:
            raise SessionImageNotFound(session_id)
        return SessionImageCapture(
            session_id=session_id,
            revision=expected_revision,
            source=source,
            sha256=f"sha256:{hashlib.sha256(content).hexdigest()}",
            media_type="image/png",
            content=content,
        )

    def list_gallery(self) -> list[GallerySession]:
        authoring_fd: int | None = None
        try:
            authoring_fd = os.open(self.paths.authoring, _DIRECTORY_FLAGS)
            with os.scandir(authoring_fd) as iterator:
                entries = sorted(iterator, key=lambda entry: entry.name)
        except OSError as error:
            if _is_missing_session_error(error):
                return []
            raise SessionReadError("could not enumerate current sessions") from error
        finally:
            if authoring_fd is not None:
                os.close(authoring_fd)
        results: list[GallerySession] = []
        for entry in entries:
            try:
                if entry.name.startswith(".") or not entry.is_dir(
                    follow_symlinks=False
                ):
                    continue
            except OSError as error:
                if _is_missing_session_error(error):
                    continue
                raise SessionReadError("could not inspect current session") from error
            try:
                snapshot = self.load(entry.name)
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
        expected_revision: str,
        wait_for_reservation: bool = False,
    ) -> DogBundlePublication:
        source = self.load(session_id)
        if source.revision != expected_revision:
            raise SessionRevisionConflict(source)
        require_stable_dog(source.session, dog_key)
        with self.reserve_dog(session_id, dog_key, wait=wait_for_reservation):
            session = session_id
            dog = dog_key
            with self._exclusive(f"session:{session}"):
                current = self.load(session)
                if current.revision != expected_revision:
                    raise SessionRevisionConflict(current)
                require_stable_dog(current.session, dog)
            variant_index = self._next_variant_index(session, dog)
            payload = build(variant_index)
            if not isinstance(payload, DogBundlePayload):
                raise TypeError("dog bundle builder must return DogBundlePayload")
            payload_mapping = copy.deepcopy(dict(payload.session_json))
            payload_session_bytes = encode_json(payload_mapping)
            payload_session = AuthoringSession.from_bytes(payload_session_bytes)
            if payload_session.id != session:
                raise ValueError("dog bundle session payload has the wrong session id")
            payload_dog = require_stable_dog(payload_session, dog)
            selected_variant = payload_dog.get("activeVariant")
            if (
                not isinstance(selected_variant, int)
                or isinstance(selected_variant, bool)
                or selected_variant != variant_index
            ):
                raise ValueError(
                    "dog bundle session payload must select its allocated variant"
                )
            expected_mapping = set_active_variant(
                current.session,
                dog,
                variant_index,
            ).to_mapping()
            if not _same_json_value(payload_mapping, expected_mapping):
                raise ValueError(
                    "dog bundle session payload must preserve the source session "
                    "and only select its allocated variant"
                )
            raw_bundle = payload.as_bundle(
                session_id=session,
                dog_key=dog,
                variant_index=variant_index,
                session_json_bytes=payload_session_bytes,
            )
            bundle_id = (
                f"{session}-{dog}-variant-{variant_index:03d}-{uuid.uuid4().hex[:12]}"
            )
            with self._exclusive(f"session:{session}"):
                current = self.load(session)
                if current.revision != expected_revision:
                    raise SessionRevisionConflict(current)
                require_stable_dog(current.session, dog)
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
