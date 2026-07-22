"""Validated sequence contracts and a restart-safe FTD publication saga."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..approvals import ApprovalStore
from ..fs import atomic_write_bytes, atomic_write_json, ensure_durable_directory
from .catalog import CatalogManifest, validate_catalog


class SequencePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence_version: str = Field(alias="sequenceVersion", min_length=1)
    catalog_revision: str = Field(alias="catalogRevision", min_length=1)
    level_ids: tuple[str, ...] = Field(alias="levelIds", min_length=1)

    @model_validator(mode="after")
    def unique_levels(self):
        if len(self.level_ids) != len(set(self.level_ids)):
            raise ValueError("sequence contains duplicate levels")
        return self


def validate_sequence(
    value: dict,
    *,
    catalog: CatalogManifest,
    bundled_starter_ids: Iterable[str],
) -> SequencePayload:
    sequence = SequencePayload.model_validate(value)
    if sequence.catalog_revision != catalog.catalog_revision:
        raise ValueError("sequence catalog revision does not match the validated catalog")
    catalog_levels = {level.level_id: level for level in catalog.levels}
    for level_id in sequence.level_ids:
        level = catalog_levels.get(level_id)
        if level is None:
            raise ValueError(f"sequence references missing level {level_id}")
        if level.tombstoned_at is not None or not level.listable:
            raise ValueError(f"sequence references unavailable level {level_id}")
    starters = tuple(bundled_starter_ids)
    if sequence.level_ids[: len(starters)] != starters:
        raise ValueError("sequence starter prefix does not match bundled starters")
    for starter in starters:
        level = catalog_levels.get(starter)
        if level is None or not level.bundled_in_app:
            raise ValueError(f"starter level {starter} is not bundled")
    return sequence


class AmbiguousRemoteOutcome(RuntimeError):
    """The publisher may have accepted the payload but no response was observed."""


class RemotePublicationDisabled(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Candidate:
    candidate_id: str
    sequence_version: str
    level_ids: tuple[str, ...]
    catalog_revision: str
    changelog: str
    actor: str
    source_revision: str
    digest: str


@dataclass(frozen=True, slots=True)
class RemoteRecord:
    digest: str
    sequence_version: str
    base_revision: str
    remote_revision: str


SagaStatus = Literal[
    "pending_remote",
    "reconciling",
    "remote_committed",
    "finalizing",
    "succeeded",
    "failed",
]

UNFINISHED_SAGA_STATUSES = frozenset(
    {"pending_remote", "reconciling", "remote_committed", "finalizing"}
)


@dataclass(frozen=True, slots=True)
class PublishSaga:
    saga_id: str
    action: Literal["publish", "rollback"]
    candidate_id: str
    digest: str
    actor: str
    changelog: str
    source_revision: str
    status: SagaStatus
    remote: bool
    error: str | None = None


@dataclass(frozen=True, slots=True)
class PublishingSnapshot:
    selected: Candidate | None
    candidates: tuple[Candidate, ...]
    sagas: tuple[PublishSaga, ...]
    rollback_eligible_candidate_ids: tuple[str, ...]
    remote_enabled: bool


class Publisher(Protocol):
    authenticated: bool

    def publish(self, candidate: Candidate) -> RemoteRecord: ...

    def readback(self) -> RemoteRecord | None: ...


class ScriptedPublisher:
    """Provider-free deterministic fixture; never performs network I/O."""

    authenticated = True

    def __init__(
        self,
        *,
        outcomes: list[str] | None = None,
        readbacks: list[RemoteRecord | None] | None = None,
        remote_revision: str | None = None,
    ) -> None:
        self.outcomes = list(outcomes or ["success"])
        self.readbacks = list(readbacks or [])
        self.remote_revision = remote_revision
        self.latest: RemoteRecord | None = None
        self.publish_calls = 0

    def record_for(self, candidate: Candidate) -> RemoteRecord:
        return RemoteRecord(
            digest=candidate.digest,
            sequence_version=candidate.sequence_version,
            base_revision=candidate.source_revision,
            remote_revision=f"remote-{candidate.digest[:12]}",
        )

    def publish(self, candidate: Candidate) -> RemoteRecord:
        self.publish_calls += 1
        if self.remote_revision is not None and self.remote_revision != candidate.source_revision:
            raise RuntimeError("remote publication rejected: stale remote base")
        outcome = self.outcomes.pop(0) if self.outcomes else "success"
        if outcome == "timeout":
            raise AmbiguousRemoteOutcome("remote response timed out")
        if outcome == "reject":
            raise RuntimeError("remote publication rejected")
        if outcome.startswith("error:"):
            raise RuntimeError(outcome.removeprefix("error:"))
        self.latest = self.record_for(candidate)
        self.remote_revision = self.latest.remote_revision
        return self.latest

    def readback(self) -> RemoteRecord | None:
        if self.readbacks:
            return self.readbacks.pop(0)
        return self.latest


def _candidate_payload(
    *,
    sequence_version: str,
    level_ids: tuple[str, ...],
    catalog_revision: str,
    changelog: str,
    actor: str,
    source_revision: str,
) -> dict:
    if not sequence_version or not catalog_revision or not changelog.strip() or not actor:
        raise ValueError("version, catalog revision, changelog, and actor are required")
    if not level_ids or len(level_ids) != len(set(level_ids)):
        raise ValueError("candidate requires a non-empty unique level sequence")
    _safe_id(sequence_version, "sequence version")
    return {
        "actor": actor,
        "catalogRevision": catalog_revision,
        "changelog": changelog,
        "levelIds": list(level_ids),
        "sequenceVersion": sequence_version,
        "sourceRevision": source_revision,
    }


def _candidate_from_payload(candidate_id: str, digest: str, value: dict) -> Candidate:
    return Candidate(
        candidate_id=candidate_id,
        sequence_version=value["sequenceVersion"],
        level_ids=tuple(value["levelIds"]),
        catalog_revision=value["catalogRevision"],
        changelog=value["changelog"],
        actor=value["actor"],
        source_revision=value["sourceRevision"],
        digest=digest,
    )


def _selected_candidate_payload(candidate: Candidate) -> dict:
    return {
        "candidateId": candidate.candidate_id,
        **_candidate_payload(
            sequence_version=candidate.sequence_version,
            level_ids=candidate.level_ids,
            catalog_revision=candidate.catalog_revision,
            changelog=candidate.changelog,
            actor=candidate.actor,
            source_revision=candidate.source_revision,
        ),
        "digest": candidate.digest,
    }


def _candidate_from_selection(value: dict) -> Candidate:
    return _candidate_from_payload(value["candidateId"], value["digest"], value)


_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$")


def _safe_id(value: str, label: str) -> str:
    if not _SAFE_ID.fullmatch(value):
        raise ValueError(f"invalid {label}: {value!r}")
    return value


class PublishingService:
    """Own immutable previews, selected sequence, and restart reconciliation."""

    def __init__(
        self,
        *,
        public_root: Path,
        state_root: Path,
        approvals: ApprovalStore,
        publisher: Publisher | None = None,
        before_finalize: Callable[[], None] | None = None,
    ) -> None:
        self.public_root = public_root
        self.approvals = approvals
        self.publisher = publisher
        self.before_finalize = before_finalize
        self.candidates_root = state_root / "candidates"
        self.sagas_root = state_root / "sagas"
        self.selected_path = public_root / "levels" / "active-sequence.json"
        ensure_durable_directory(self.candidates_root)
        ensure_durable_directory(self.sagas_root)

    def candidate_path(self, candidate_id: str) -> Path:
        return self.candidates_root / f"{_safe_id(candidate_id, 'candidate id')}.json"

    def _validate_sequence(self, payload: dict) -> None:
        catalog_path = self.public_root / "levels" / "catalog-manifest.json"
        try:
            catalog = validate_catalog(json.loads(catalog_path.read_text()))
        except FileNotFoundError as error:
            raise ValueError("validated catalog manifest is unavailable") from error
        starters = tuple(
            level.level_id for level in catalog.levels if level.bundled_in_app
        )
        validate_sequence(
            {
                "sequenceVersion": payload["sequenceVersion"],
                "catalogRevision": payload["catalogRevision"],
                "levelIds": payload["levelIds"],
            },
            catalog=catalog,
            bundled_starter_ids=starters,
        )

    def _load_candidate(self, candidate_id: str) -> Candidate:
        path = self.candidate_path(candidate_id)
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        return _candidate_from_payload(candidate_id, digest, json.loads(content))

    def prepare(
        self,
        *,
        sequence_version: str,
        level_ids: tuple[str, ...],
        catalog_revision: str,
        changelog: str,
        actor: str,
        source_revision: str,
    ) -> Candidate:
        payload = _candidate_payload(
            sequence_version=sequence_version,
            level_ids=level_ids,
            catalog_revision=catalog_revision,
            changelog=changelog,
            actor=actor,
            source_revision=source_revision,
        )
        self._validate_sequence(payload)
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(encoded).hexdigest()
        candidate_id = f"{sequence_version}-{digest[:16]}"
        path = self.candidate_path(candidate_id)
        if path.exists() and path.read_bytes() != encoded:
            raise ValueError("immutable candidate identity collision")
        if not path.exists():
            atomic_write_bytes(path, encoded)
        return _candidate_from_payload(candidate_id, digest, payload)

    def _saga_path(self, saga_id: str) -> Path:
        return self.sagas_root / f"{_safe_id(saga_id, 'saga id')}.json"

    def _save_saga(self, saga: PublishSaga) -> None:
        atomic_write_json(self._saga_path(saga.saga_id), asdict(saga))

    def _load_saga(self, saga_id: str) -> PublishSaga:
        return PublishSaga(**json.loads(self._saga_path(saga_id).read_text()))

    def _consume(self, candidate: Candidate, grant_id: str, action: str) -> None:
        self.approvals.consume(
            grant_id=grant_id,
            actor=candidate.actor,
            action_kind=action,
            request_binding=candidate.digest,
            source_revision=candidate.source_revision,
        )

    def _new_saga(
        self, candidate: Candidate, *, action: Literal["publish", "rollback"], remote: bool
    ) -> PublishSaga:
        saga = PublishSaga(
            saga_id=f"publish-{uuid.uuid4().hex}",
            action=action,
            candidate_id=candidate.candidate_id,
            digest=candidate.digest,
            actor=candidate.actor,
            changelog=candidate.changelog,
            source_revision=candidate.source_revision,
            status="pending_remote" if remote else "finalizing",
            remote=remote,
        )
        self._save_saga(saga)
        return saga

    def _finalize(self, saga: PublishSaga, candidate: Candidate) -> PublishSaga:
        if self.before_finalize is not None:
            self.before_finalize()
        finalizing = replace(saga, status="finalizing", error=None)
        self._save_saga(finalizing)
        atomic_write_json(self.selected_path, _selected_candidate_payload(candidate))
        succeeded = replace(finalizing, status="succeeded")
        self._save_saga(succeeded)
        return succeeded

    def _start(
        self,
        candidate_id: str,
        grant_id: str,
        *,
        action: Literal["publish", "rollback"],
        remote: bool,
    ) -> PublishSaga:
        candidate = self._load_candidate(candidate_id)
        unfinished = next(
            (
                saga
                for saga in self._load_sagas()
                if saga.remote and saga.status in UNFINISHED_SAGA_STATUSES
            ),
            None,
        )
        if unfinished is not None:
            raise ValueError(
                f"publication saga {unfinished.saga_id} requires exact readback reconciliation"
            )
        if action == "rollback":
            eligible = self._rollback_eligible_ids()
            selected = self.snapshot().selected
            if candidate_id not in eligible or (
                selected is not None and selected.candidate_id == candidate_id
            ):
                raise ValueError("rollback requires a retained prior selected candidate")
        if remote and (self.publisher is None or not self.publisher.authenticated):
            raise RemotePublicationDisabled(
                "remote publication requires explicit authenticated publisher configuration"
            )
        grant_action = "publish_sequence" if action == "publish" else "rollback_sequence"
        self._consume(candidate, grant_id, grant_action)
        saga = self._new_saga(candidate, action=action, remote=remote)
        if not remote:
            return self._finalize(saga, candidate)
        try:
            record = self.publisher.publish(candidate)  # type: ignore[union-attr]
        except AmbiguousRemoteOutcome:
            reconciling = replace(saga, status="reconciling")
            self._save_saga(reconciling)
            return reconciling
        except Exception:
            failed = replace(saga, status="failed", error="remote publication rejected")
            self._save_saga(failed)
            raise RuntimeError("remote publication rejected") from None
        if not self._record_matches(record, candidate):
            failed = replace(saga, status="failed", error="remote readback hash mismatch")
            self._save_saga(failed)
            raise RuntimeError("remote publication returned mismatched identity")
        committed = replace(saga, status="remote_committed")
        self._save_saga(committed)
        return self._finalize(committed, candidate)

    def activate(self, candidate_id: str, grant_id: str, *, remote: bool) -> PublishSaga:
        return self._start(candidate_id, grant_id, action="publish", remote=remote)

    def rollback(self, candidate_id: str, grant_id: str, *, remote: bool) -> PublishSaga:
        return self._start(candidate_id, grant_id, action="rollback", remote=remote)

    @staticmethod
    def _record_matches(record: RemoteRecord, candidate: Candidate) -> bool:
        return (
            record.digest == candidate.digest
            and record.sequence_version == candidate.sequence_version
            and record.base_revision == candidate.source_revision
        )

    def reconcile(self, saga_id: str) -> PublishSaga:
        saga = self._load_saga(saga_id)
        if saga.status == "succeeded":
            return saga
        if saga.status not in ("reconciling", "remote_committed", "finalizing"):
            raise ValueError(f"saga {saga_id} is not reconcilable from {saga.status}")
        if self.publisher is None or not self.publisher.authenticated:
            raise RemotePublicationDisabled("reconciliation requires configured readback")
        candidate = self._load_candidate(saga.candidate_id)
        record = self.publisher.readback()
        if record is None or not self._record_matches(record, candidate):
            pending = replace(saga, status="reconciling", error=None)
            if pending != saga:
                self._save_saga(pending)
            return pending
        committed = replace(saga, status="remote_committed", error=None)
        self._save_saga(committed)
        return self._finalize(committed, candidate)

    def snapshot(self) -> PublishingSnapshot:
        candidates = tuple(
            self._load_candidate(path.stem)
            for path in sorted(
                self.candidates_root.glob("*.json"),
                key=lambda item: (item.stat().st_mtime_ns, item.name),
            )
        )
        sagas = self._load_sagas()
        selected = None
        if self.selected_path.exists():
            value = json.loads(self.selected_path.read_text())
            selected = _candidate_from_selection(value)
        return PublishingSnapshot(
            selected=selected,
            candidates=candidates,
            sagas=sagas,
            rollback_eligible_candidate_ids=self._rollback_eligible_ids(sagas),
            remote_enabled=self.publisher is not None and self.publisher.authenticated,
        )

    def _load_sagas(self) -> tuple[PublishSaga, ...]:
        return tuple(
            PublishSaga(**json.loads(path.read_text()))
            for path in sorted(
                self.sagas_root.glob("*.json"),
                key=lambda item: (item.stat().st_mtime_ns, item.name),
            )
        )

    def _rollback_eligible_ids(
        self, sagas: tuple[PublishSaga, ...] | None = None
    ) -> tuple[str, ...]:
        records = sagas
        if records is None:
            records = self._load_sagas()
        return tuple(
            dict.fromkeys(
                saga.candidate_id for saga in records if saga.status == "succeeded"
            )
        )
