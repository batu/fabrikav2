"""One same-dog exclusion boundary around allocation and bundle publication."""

from __future__ import annotations

import fcntl
import hashlib
import os
import re
import threading
import uuid
import weakref
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from ..fs import AtomicBundleStore, PublishedBundle
from ..settings import WorkspacePaths
from .dogs import DogBundlePayload


class ReservationRejected(RuntimeError):
    """Raised instead of racing a second publication for the same dog."""


@dataclass(frozen=True, slots=True)
class DogBundlePublication:
    session_id: str
    dog_key: str
    variant_index: int
    bundle_id: str
    path: Path


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")


class SessionStore:
    """U2's raw store shell; typed load/save and revisions intentionally wait for U3."""

    _registry_guard = threading.Lock()
    _process_locks: weakref.WeakValueDictionary[str, threading.Lock] = (
        weakref.WeakValueDictionary()
    )

    def __init__(self, paths: WorkspacePaths):
        self.paths = paths
        self.bundles = AtomicBundleStore(paths.authoring / ".ftd-session-bundles")
        self.bundles.recover()

    @staticmethod
    def _validate_identifier(value: str, label: str) -> str:
        if not _IDENTIFIER.fullmatch(value):
            raise ValueError(f"invalid {label}: {value!r}")
        return value

    def _reservation_key(self, session_id: str, dog_key: str) -> str:
        session = self._validate_identifier(session_id, "session id")
        dog = self._validate_identifier(dog_key, "dog key")
        return f"{session}:{dog}"

    @classmethod
    def _process_lock(cls, path: Path) -> threading.Lock:
        key = str(path)
        with cls._registry_guard:
            return cls._process_locks.setdefault(key, threading.Lock())

    @contextmanager
    def reserve_dog(
        self,
        session_id: str,
        dog_key: str,
        *,
        wait: bool = False,
    ) -> Iterator[None]:
        """Hold one reservation from index scan through committed selector update."""

        key = self._reservation_key(session_id, dog_key)
        self.paths.locks.mkdir(parents=True, exist_ok=True)
        lock_name = hashlib.sha256(key.encode("utf-8")).hexdigest() + ".dog.lock"
        lock_path = self.paths.locks / lock_name
        process_lock = self._process_lock(lock_path)
        if not process_lock.acquire(blocking=wait):
            raise ReservationRejected(f"dog {dog_key!r} in session {session_id!r} is already reserved")
        descriptor: int | None = None
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            operation = fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB)
            try:
                fcntl.flock(descriptor, operation)
            except BlockingIOError as error:
                raise ReservationRejected(
                    f"dog {dog_key!r} in session {session_id!r} is already reserved"
                ) from error
            yield
        finally:
            if descriptor is not None:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)
            process_lock.release()

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
