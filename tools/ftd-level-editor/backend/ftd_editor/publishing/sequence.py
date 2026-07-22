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
from ..fs import (
    atomic_write_bytes,
    atomic_write_json,
    ensure_durable_directory,
    exclusive_file_lock,
)
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


class DefiniteRemoteRejection(RuntimeError):
    """The publisher proved that it did not accept the requested mutation."""


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
    request_id: str
    action: Literal["publish", "rollback"]
    candidate_id: str
    digest: str
    actor: str
    changelog: str
    source_revision: str
    base_revision: str
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
    selected_remote_revision: str | None


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
            raise DefiniteRemoteRejection("remote publication rejected: stale remote base")
        outcome = self.outcomes.pop(0) if self.outcomes else "success"
        if outcome == "timeout":
            raise AmbiguousRemoteOutcome("remote response timed out")
        if outcome == "reject":
            raise DefiniteRemoteRejection("remote publication rejected")
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


def _selected_candidate_payload(
    candidate: Candidate, *, remote_revision: str | None
) -> dict:
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
        "remoteRevision": remote_revision,
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
        self.lock_path = state_root / ".publishing.lock"
        self.selected_path = public_root / "levels" / "active-sequence.json"
        ensure_durable_directory(self.candidates_root)
        ensure_durable_directory(self.sagas_root)

    def _catalog(self) -> CatalogManifest:
        catalog_path = self.public_root / "levels" / "catalog-manifest.json"
        try:
            return validate_catalog(json.loads(catalog_path.read_text()))
        except FileNotFoundError as error:
            raise ValueError("validated catalog manifest is unavailable") from error

    def candidate_path(self, candidate_id: str) -> Path:
        return self.candidates_root / f"{_safe_id(candidate_id, 'candidate id')}.json"

    def _validate_sequence(self, payload: dict) -> None:
        catalog = self._catalog()
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

    def _validate_candidate_for_action(
        self, candidate: Candidate, action: Literal["publish", "rollback"]
    ) -> None:
        payload = _candidate_payload(
            sequence_version=candidate.sequence_version,
            level_ids=candidate.level_ids,
            catalog_revision=candidate.catalog_revision,
            changelog=candidate.changelog,
            actor=candidate.actor,
            source_revision=candidate.source_revision,
        )
        if action == "publish":
            self._validate_sequence(payload)
            return
        catalog = self._catalog()
        starters = tuple(
            level.level_id for level in catalog.levels if level.bundled_in_app
        )
        validate_sequence(
            {
                "sequenceVersion": candidate.sequence_version,
                "catalogRevision": catalog.catalog_revision,
                "levelIds": candidate.level_ids,
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

    def _consume(
        self, candidate: Candidate, grant_id: str, action: str, *, base_revision: str
    ) -> None:
        self.approvals.consume(
            grant_id=grant_id,
            actor=candidate.actor,
            action_kind=action,
            request_binding=candidate.digest,
            source_revision=base_revision,
        )

    def _selected_value(self) -> dict | None:
        if not self.selected_path.exists():
            return None
        return json.loads(self.selected_path.read_text())

    def _selected_remote_revision(self) -> str | None:
        value = self._selected_value()
        if value is None:
            return None
        revision = value.get("remoteRevision")
        return revision if isinstance(revision, str) and revision else None

    def _base_revision(
        self,
        candidate: Candidate,
        *,
        action: Literal["publish", "rollback"],
        remote: bool,
    ) -> str:
        if remote and action == "rollback":
            current = self._selected_remote_revision()
            if current is None:
                raise ValueError("remote rollback requires a confirmed selected remote revision")
            return current
        return candidate.source_revision

    def mint_approval(
        self,
        candidate_id: str,
        *,
        action: Literal["publish", "rollback"],
        remote: bool,
        acknowledgement: str,
    ):
        candidate = self._load_candidate(candidate_id)
        action_kind = "publish_sequence" if action == "publish" else "rollback_sequence"
        base_revision = self._base_revision(candidate, action=action, remote=remote)
        return self.approvals.mint(
            actor=candidate.actor,
            action_kind=action_kind,
            request_binding=candidate.digest,
            source_revision=base_revision,
            acknowledgement=acknowledgement,
        )

    def _new_saga(
        self,
        candidate: Candidate,
        *,
        request_id: str,
        action: Literal["publish", "rollback"],
        remote: bool,
        base_revision: str,
    ) -> PublishSaga:
        saga = PublishSaga(
            saga_id=f"publish-{uuid.uuid4().hex}",
            request_id=_safe_id(request_id, "request id"),
            action=action,
            candidate_id=candidate.candidate_id,
            digest=candidate.digest,
            actor=candidate.actor,
            changelog=candidate.changelog,
            source_revision=candidate.source_revision,
            base_revision=base_revision,
            status="pending_remote" if remote else "finalizing",
            remote=remote,
        )
        self._save_saga(saga)
        return saga

    def _finalize(
        self,
        saga: PublishSaga,
        candidate: Candidate,
        *,
        remote_revision: str | None,
    ) -> PublishSaga:
        if self.before_finalize is not None:
            self.before_finalize()
        finalizing = replace(saga, status="finalizing", error=None)
        self._save_saga(finalizing)
        atomic_write_json(
            self.selected_path,
            _selected_candidate_payload(candidate, remote_revision=remote_revision),
        )
        succeeded = replace(finalizing, status="succeeded")
        self._save_saga(succeeded)
        return succeeded

    def _start(
        self,
        candidate_id: str,
        grant_id: str,
        request_id: str,
        *,
        action: Literal["publish", "rollback"],
        remote: bool,
    ) -> PublishSaga:
        candidate = self._load_candidate(candidate_id)
        if remote and (self.publisher is None or not self.publisher.authenticated):
            raise RemotePublicationDisabled(
                "remote publication requires explicit authenticated publisher configuration"
            )
        self._validate_candidate_for_action(candidate, action)
        request_id = _safe_id(request_id, "request id")
        with exclusive_file_lock(self.lock_path):
            sagas = self._load_sagas()
            prior = next((item for item in sagas if item.request_id == request_id), None)
            if prior is not None:
                if (
                    prior.action != action
                    or prior.candidate_id != candidate_id
                    or prior.remote != remote
                ):
                    raise ValueError("request id is already bound to another publication")
                return prior
            base_revision = self._base_revision(
                candidate, action=action, remote=remote
            )
            unfinished = next(
                (saga for saga in sagas if saga.status in UNFINISHED_SAGA_STATUSES),
                None,
            )
            if unfinished is not None:
                raise ValueError(
                    f"publication saga {unfinished.saga_id} requires reconciliation"
                )
            if action == "rollback":
                eligible = self._rollback_eligible_ids(sagas)
                selected = self.snapshot().selected
                if candidate_id not in eligible or (
                    selected is not None and selected.candidate_id == candidate_id
                ):
                    raise ValueError(
                        "rollback requires a catalog-retained prior selected candidate"
                    )
            grant_action = (
                "publish_sequence" if action == "publish" else "rollback_sequence"
            )
            self._consume(
                candidate, grant_id, grant_action, base_revision=base_revision
            )
            saga = self._new_saga(
                candidate,
                request_id=request_id,
                action=action,
                remote=remote,
                base_revision=base_revision,
            )
        if not remote:
            return self._finalize(
                saga,
                candidate,
                remote_revision=self._selected_remote_revision(),
            )
        attempt = replace(candidate, source_revision=base_revision)
        try:
            record = self.publisher.publish(attempt)  # type: ignore[union-attr]
        except DefiniteRemoteRejection:
            failed = replace(saga, status="failed", error="remote publication rejected")
            self._save_saga(failed)
            raise RuntimeError("remote publication rejected") from None
        except Exception:
            reconciling = replace(
                saga,
                status="reconciling",
                error="remote outcome requires exact readback",
            )
            self._save_saga(reconciling)
            return reconciling
        if not self._record_matches(record, candidate, base_revision=base_revision):
            reconciling = replace(
                saga,
                status="reconciling",
                error="remote response identity requires exact readback",
            )
            self._save_saga(reconciling)
            return reconciling
        committed = replace(saga, status="remote_committed")
        self._save_saga(committed)
        return self._finalize(
            committed,
            candidate,
            remote_revision=record.remote_revision,
        )

    def activate(
        self, candidate_id: str, grant_id: str, request_id: str, *, remote: bool
    ) -> PublishSaga:
        return self._start(
            candidate_id,
            grant_id,
            request_id,
            action="publish",
            remote=remote,
        )

    def rollback(
        self, candidate_id: str, grant_id: str, request_id: str, *, remote: bool
    ) -> PublishSaga:
        return self._start(
            candidate_id,
            grant_id,
            request_id,
            action="rollback",
            remote=remote,
        )

    @staticmethod
    def _record_matches(
        record: RemoteRecord, candidate: Candidate, *, base_revision: str
    ) -> bool:
        return (
            record.digest == candidate.digest
            and record.sequence_version == candidate.sequence_version
            and record.base_revision == base_revision
        )

    def reconcile(self, saga_id: str) -> PublishSaga:
        with exclusive_file_lock(self.lock_path):
            saga = self._load_saga(saga_id)
            if saga.status == "succeeded":
                return saga
            if saga.status not in UNFINISHED_SAGA_STATUSES:
                raise ValueError(
                    f"saga {saga_id} is not reconcilable from {saga.status}"
                )
            candidate = self._load_candidate(saga.candidate_id)
            if not saga.remote:
                return self._finalize(
                    saga,
                    candidate,
                    remote_revision=self._selected_remote_revision(),
                )
            if self.publisher is None or not self.publisher.authenticated:
                raise RemotePublicationDisabled(
                    "reconciliation requires configured readback"
                )
            record = self.publisher.readback()
            if record is None or not self._record_matches(
                record, candidate, base_revision=saga.base_revision
            ):
                pending = replace(
                    saga,
                    status="reconciling",
                    error="remote outcome requires exact readback",
                )
                if pending != saga:
                    self._save_saga(pending)
                return pending
            committed = replace(saga, status="remote_committed", error=None)
            self._save_saga(committed)
            return self._finalize(
                committed,
                candidate,
                remote_revision=record.remote_revision,
            )

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
            selected_remote_revision=self._selected_remote_revision(),
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
        catalog_levels = {level.level_id: level for level in self._catalog().levels}
        eligible: list[str] = []
        for saga in records:
            if saga.status != "succeeded":
                continue
            candidate = self._load_candidate(saga.candidate_id)
            if all(level_id in catalog_levels for level_id in candidate.level_ids) and all(
                candidate.sequence_version
                in catalog_levels[level_id].retention.rollback_eligible_sequence_versions
                for level_id in candidate.level_ids
            ):
                eligible.append(saga.candidate_id)
        return tuple(dict.fromkeys(eligible))
