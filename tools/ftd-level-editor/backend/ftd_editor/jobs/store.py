"""Restart-safe SQLite ledger for FTD durable jobs and linked attempts."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import (
    ACTIVE_STATUSES,
    ArtifactRecord,
    ExecutionSpec,
    JobEvent,
    JobRecord,
    JobStatus,
    VALID_STATUSES,
    is_terminal_status,
)


class JobNotFound(KeyError):
    pass


class RequestIdentityConflict(RuntimeError):
    """Same Request ID reused with a different Input Hash."""

    def __init__(self, existing: JobRecord, submitted_hash: str) -> None:
        super().__init__(
            f"request {existing.request_id!r} was already bound to different inputs"
        )
        self.existing = existing
        self.submitted_hash = submitted_hash


class TerminalJobImmutable(RuntimeError):
    """A terminal attempt can never be transitioned or requeued."""

    def __init__(self, job: JobRecord, attempted_status: str) -> None:
        super().__init__(
            f"job {job.id!r} is terminal ({job.status}); rejected {attempted_status!r}"
        )
        self.job = job
        self.attempted_status = attempted_status


class AttemptNotAllowed(RuntimeError):
    pass


class OwnershipLost(RuntimeError):
    """A fenced write was attempted by a worker that no longer owns the job."""

    def __init__(self, job: JobRecord, owner: str) -> None:
        super().__init__(
            f"worker {owner!r} no longer owns job {job.id!r} "
            f"(owner={job.worker_owner!r}, status={job.status})"
        )
        self.job = job
        self.owner = owner


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dump(value: dict[str, Any] | None) -> str:
    return json.dumps(value or {}, sort_keys=True, separators=(",", ":"))


def _json_load(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else {}


def _row_to_job(row: sqlite3.Row) -> JobRecord:
    return JobRecord(
        id=str(row["id"]),
        kind=str(row["kind"]),
        session_id=str(row["session_id"]),
        request_id=row["request_id"],
        input_hash=str(row["input_hash"]),
        execution_spec=_json_load(row["execution_spec_json"]),
        status=row["status"],
        stage=str(row["stage"]),
        retryable=bool(row["retryable"]),
        error_code=row["error_code"],
        error_message=row["error_message"],
        result=_json_load(row["result_json"]),
        metadata=_json_load(row["metadata_json"]),
        previous_attempt_id=row["previous_attempt_id"],
        attempt_reason=str(row["attempt_reason"]),
        superseded_by=row["superseded_by"],
        worker_owner=row["worker_owner"],
        heartbeat_at=row["heartbeat_at"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        completed_at=row["completed_at"],
    )


def _row_to_event(row: sqlite3.Row) -> JobEvent:
    return JobEvent(
        id=int(row["id"]),
        job_id=str(row["job_id"]),
        event_type=str(row["event_type"]),
        message=row["message"],
        data=_json_load(row["data_json"]),
        created_at=str(row["created_at"]),
    )


def _row_to_artifact(row: sqlite3.Row) -> ArtifactRecord:
    return ArtifactRecord(
        artifact_id=str(row["artifact_id"]),
        job_id=str(row["job_id"]),
        display_name=str(row["display_name"]),
        media_type=str(row["media_type"]),
        checksum=str(row["checksum"]),
        size=int(row["size"]),
        relative_path=str(row["relative_path"]),
        created_at=str(row["created_at"]),
    )


_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    session_id TEXT NOT NULL,
    request_id TEXT,
    input_hash TEXT NOT NULL,
    execution_spec_json TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    retryable INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    result_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    previous_attempt_id TEXT REFERENCES jobs(id),
    attempt_reason TEXT NOT NULL DEFAULT 'initial',
    superseded_by TEXT REFERENCES jobs(id),
    worker_owner TEXT,
    heartbeat_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_request_identity
    ON jobs(kind, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_reuse ON jobs(kind, input_hash, status);

CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    event_type TEXT NOT NULL,
    message TEXT,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_job_id_id ON job_events(job_id, id);

CREATE TABLE IF NOT EXISTS job_artifacts (
    artifact_id TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    display_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    checksum TEXT NOT NULL,
    size INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (artifact_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_job_artifacts_job ON job_artifacts(job_id);

CREATE TABLE IF NOT EXISTS approval_grants (
    grant_id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action_kind TEXT NOT NULL,
    request_binding TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    acknowledgement TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    minted_at TEXT NOT NULL,
    consumed_at TEXT,
    consumed_by_job TEXT
);
"""


class JobStore:
    """Owns durable job attempts, events, artifacts, and approval rows."""

    _schema_lock = threading.Lock()

    def __init__(
        self,
        state_root: Path,
        *,
        sanitize: Callable[[str], str] = lambda text: text,
        now: Callable[[], str] = utc_now_iso,
    ) -> None:
        self.db_path = state_root / "jobs.sqlite"
        self._sanitize = sanitize
        self._now = now
        from ..fs import ensure_durable_directory

        ensure_durable_directory(state_root)
        with self._schema_lock, self.connect() as conn:
            conn.executescript(_SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=5.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")

    def _sanitized(self, message: str | None) -> str | None:
        return None if message is None else self._sanitize(message)

    # -- creation and request identity -------------------------------------

    def _insert_job(
        self,
        conn: sqlite3.Connection,
        *,
        spec: ExecutionSpec,
        request_id: str | None,
        previous_attempt_id: str | None = None,
        attempt_reason: str = "initial",
        metadata: dict[str, Any] | None = None,
    ) -> JobRecord:
        now = self._now()
        job_id = uuid.uuid4().hex
        conn.execute(
            """
            INSERT INTO jobs (
                id, kind, session_id, request_id, input_hash, execution_spec_json,
                status, stage, retryable, result_json, metadata_json,
                previous_attempt_id, attempt_reason, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 'queued', 0, '{}', ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                spec.kind,
                spec.session_id,
                request_id,
                spec.input_hash(),
                spec.to_bytes().decode("utf-8"),
                _json_dump(metadata),
                previous_attempt_id,
                attempt_reason,
                now,
                now,
            ),
        )
        self._append_event_locked(
            conn, job_id, "job.created", data={"attemptReason": attempt_reason}
        )
        return self._get_locked(conn, job_id)

    def _get_locked(self, conn: sqlite3.Connection, job_id: str) -> JobRecord:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise JobNotFound(job_id)
        return _row_to_job(row)

    def _newest_attempt_locked(self, conn: sqlite3.Connection, job: JobRecord) -> JobRecord:
        current = job
        seen = {current.id}
        while current.superseded_by is not None and current.superseded_by not in seen:
            seen.add(current.superseded_by)
            current = self._get_locked(conn, current.superseded_by)
        return current

    def start_job(
        self,
        spec: ExecutionSpec,
        *,
        request_id: str,
        metadata: dict[str, Any] | None = None,
        reuse: bool = False,
    ) -> tuple[JobRecord, bool]:
        """Persist request identity, Execution Spec, and Input Hash before side effects.

        Returns (job, created). Replay with the same hash returns the newest
        linked attempt; a different hash raises RequestIdentityConflict.

        With reuse=True, a prior succeeded job with the same Input Hash
        completes the new job in the same transaction, so a queued row that
        could reach the paid handler is never visible to any worker.
        """

        submitted_hash = spec.input_hash()
        with self.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE kind = ? AND request_id = ?",
                (spec.kind, request_id),
            ).fetchone()
            if row is not None:
                existing = _row_to_job(row)
                if existing.input_hash != submitted_hash:
                    raise RequestIdentityConflict(existing, submitted_hash)
                return self._newest_attempt_locked(conn, existing), False
            job = self._insert_job(conn, spec=spec, request_id=request_id, metadata=metadata)
            if reuse:
                reusable = self._find_reusable_locked(conn, spec.kind, submitted_hash, job.id)
                if reusable is not None:
                    job = self._apply_reuse_locked(conn, job, reusable)
            return job, True

    def _find_reusable_locked(
        self, conn: sqlite3.Connection, kind: str, input_hash: str, exclude_id: str
    ) -> JobRecord | None:
        row = conn.execute(
            """
            SELECT * FROM jobs
            WHERE kind = ? AND input_hash = ? AND status = 'succeeded' AND id != ?
            ORDER BY created_at DESC LIMIT 1
            """,
            (kind, input_hash, exclude_id),
        ).fetchone()
        return _row_to_job(row) if row is not None else None

    def _apply_reuse_locked(
        self, conn: sqlite3.Connection, job: JobRecord, reusable: JobRecord
    ) -> JobRecord:
        self._append_event_locked(
            conn, job.id, "job.artifact_reuse", data={"reusedFromJobId": reusable.id}
        )
        self._link_artifacts_locked(conn, from_job_id=reusable.id, to_job_id=job.id)
        result = dict(reusable.result)
        result["application"] = "reused"
        result["reusedFromJobId"] = reusable.id
        return self._transition_locked(
            conn, job, status="succeeded", stage="reused", result=result
        )

    def find_by_request_id(self, kind: str, request_id: str) -> JobRecord | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE kind = ? AND request_id = ?",
                (kind, request_id),
            ).fetchone()
            if row is None:
                return None
            return self._newest_attempt_locked(conn, _row_to_job(row))

    def find_reusable(self, kind: str, input_hash: str) -> JobRecord | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM jobs
                WHERE kind = ? AND input_hash = ? AND status = 'succeeded'
                ORDER BY created_at DESC LIMIT 1
                """,
                (kind, input_hash),
            ).fetchone()
        return _row_to_job(row) if row is not None else None

    # -- linked attempts ----------------------------------------------------

    def retry(self, job_id: str) -> JobRecord:
        """Create a linked retry attempt for one definitively retryable failure."""

        with self.transaction() as conn:
            job = self._get_locked(conn, job_id)
            if job.superseded_by is not None:
                raise AttemptNotAllowed(f"job {job_id!r} is already superseded")
            if job.status != "failed_retryable":
                raise AttemptNotAllowed(
                    f"retry requires a definitive retryable failure, not {job.status!r}"
                )
            if job.metadata.get("providerSubmissionStarted") and not job.metadata.get(
                "providerJobId"
            ):
                raise AttemptNotAllowed(
                    f"job {job_id!r} has ambiguous submission intent; "
                    "force-new authority is required before any resubmission"
                )
            attempt = self._insert_job(
                conn,
                spec=ExecutionSpec.from_mapping(job.execution_spec),
                request_id=None,
                previous_attempt_id=job.id,
                attempt_reason="retry",
                metadata={"rootRequestId": job.request_id},
            )
            conn.execute(
                "UPDATE jobs SET superseded_by = ?, updated_at = ? WHERE id = ?",
                (attempt.id, self._now(), job.id),
            )
            self._append_event_locked(
                conn, job.id, "job.superseded", data={"by": attempt.id, "reason": "retry"}
            )
            return attempt

    def force_new(
        self,
        job_id: str,
        spec: ExecutionSpec,
        *,
        new_request_id: str,
        consume_grant: Callable[[sqlite3.Connection], dict[str, Any]],
    ) -> JobRecord:
        """Create an acknowledged force-new attempt; the grant burns atomically."""

        with self.transaction() as conn:
            job = self._get_locked(conn, job_id)
            bound = conn.execute(
                "SELECT * FROM jobs WHERE kind = ? AND request_id = ?",
                (spec.kind, new_request_id),
            ).fetchone()
            if bound is not None:
                existing = _row_to_job(bound)
                if (
                    existing.input_hash == spec.input_hash()
                    and existing.previous_attempt_id == job.id
                ):
                    return self._newest_attempt_locked(conn, existing)
                raise RequestIdentityConflict(existing, spec.input_hash())
            if job.superseded_by is not None:
                raise AttemptNotAllowed(f"job {job_id!r} is already superseded")
            grant_data = consume_grant(conn)
            attempt = self._insert_job(
                conn,
                spec=spec,
                request_id=new_request_id,
                previous_attempt_id=job.id,
                attempt_reason="force_new",
                metadata={"grantId": grant_data.get("grantId")},
            )
            conn.execute(
                "UPDATE jobs SET superseded_by = ?, updated_at = ? WHERE id = ?",
                (attempt.id, self._now(), job.id),
            )
            self._append_event_locked(
                conn,
                job.id,
                "job.superseded",
                data={"by": attempt.id, "reason": "force_new"},
            )
            if not is_terminal_status(job.status):
                self._transition_locked(
                    conn,
                    job,
                    status="cancelled",
                    stage="superseded",
                    error_code="superseded_by_force_new",
                    error_message=f"superseded by force-new attempt {attempt.id}",
                )
            return attempt

    # -- status transitions -------------------------------------------------

    def _transition_locked(
        self,
        conn: sqlite3.Connection,
        job: JobRecord,
        *,
        status: JobStatus,
        stage: str | None = None,
        retryable: bool | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        result: dict[str, Any] | None = None,
        worker_owner: str | None = ...,  # type: ignore[assignment]
        heartbeat_at: str | None = ...,  # type: ignore[assignment]
        expect_owner: str | None = None,
    ) -> JobRecord:
        if status not in VALID_STATUSES:
            raise ValueError(f"invalid job status: {status}")
        if is_terminal_status(job.status):
            raise TerminalJobImmutable(job, status)
        if expect_owner is not None and (
            job.worker_owner != expect_owner or job.status == "queued"
        ):
            raise OwnershipLost(job, expect_owner)
        now = self._now()
        safe_error = self._sanitized(error_message)
        conn.execute(
            """
            UPDATE jobs
            SET status = ?, stage = ?, retryable = ?, error_code = ?, error_message = ?,
                result_json = ?, worker_owner = ?, heartbeat_at = ?, updated_at = ?,
                completed_at = ?
            WHERE id = ?
            """,
            (
                status,
                stage if stage is not None else status,
                int(bool(retryable)) if retryable is not None else int(job.retryable),
                error_code,
                safe_error,
                self._sanitize(_json_dump(result))
                if result is not None
                else _json_dump(job.result),
                job.worker_owner if worker_owner is ... else worker_owner,
                job.heartbeat_at if heartbeat_at is ... else heartbeat_at,
                now,
                now if is_terminal_status(status) else None,
                job.id,
            ),
        )
        self._append_event_locked(
            conn,
            job.id,
            f"job.{status}",
            message=safe_error,
            data={"stage": stage if stage is not None else status},
        )
        return self._get_locked(conn, job.id)

    def transition_job(self, job_id: str, **kwargs: Any) -> JobRecord:
        with self.transaction() as conn:
            return self._transition_locked(conn, self._get_locked(conn, job_id), **kwargs)

    def complete_success(
        self, job_id: str, *, result: dict[str, Any] | None, owner: str
    ) -> JobRecord | None:
        """Atomically land one attempt's successful output, honoring a late cancel.

        The status read and the terminal write share one transaction, so a
        cancel that lands mid-completion can never be overwritten to
        succeeded/applied. Returns None when the job was already terminal
        (output retained, not applied).
        """

        with self.transaction() as conn:
            job = self._get_locked(conn, job_id)
            if is_terminal_status(job.status):
                self._append_event_locked(
                    conn,
                    job.id,
                    "job.late_output_retained",
                    message="work finished after a terminal transition; "
                    "output retained, not applied",
                )
                return None
            if job.worker_owner != owner or job.status == "queued":
                raise OwnershipLost(job, owner)
            payload = dict(result or {})
            if job.status == "cancel_requested":
                payload.setdefault("application", "withheld")
                payload["lateOutput"] = "retained"
                return self._transition_locked(
                    conn, job, status="cancelled", stage="cancelled", result=payload
                )
            payload.setdefault("application", "applied")
            return self._transition_locked(conn, job, status="succeeded", result=payload)

    def get_job(self, job_id: str) -> JobRecord:
        with self.connect() as conn:
            return self._get_locked(conn, job_id)

    def list_jobs(
        self,
        *,
        session_id: str | None = None,
        statuses: Sequence[str] | None = None,
    ) -> list[JobRecord]:
        clauses: list[str] = []
        params: list[Any] = []
        if session_id is not None:
            clauses.append("session_id = ?")
            params.append(session_id)
        if statuses is not None:
            statuses = tuple(statuses)
            if not statuses:
                return []
            clauses.append(f"status IN ({','.join('?' for _ in statuses)})")
            params.extend(statuses)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM jobs {where_sql} ORDER BY created_at ASC, id ASC", params
            ).fetchall()
        return [_row_to_job(row) for row in rows]

    def list_active_jobs(self) -> list[JobRecord]:
        return self.list_jobs(statuses=tuple(ACTIVE_STATUSES))

    # -- worker ownership and checkpoints ------------------------------------

    def claim_next_queued(self, *, owner: str, kinds: Sequence[str]) -> JobRecord | None:
        kinds = tuple(kinds)
        if not kinds:
            return None
        with self.transaction() as conn:
            row = conn.execute(
                f"""
                SELECT * FROM jobs WHERE status = 'queued'
                AND kind IN ({','.join('?' for _ in kinds)})
                ORDER BY created_at ASC, id ASC LIMIT 1
                """,
                kinds,
            ).fetchone()
            if row is None:
                return None
            return self._transition_locked(
                conn,
                _row_to_job(row),
                status="running",
                stage="running",
                worker_owner=owner,
                heartbeat_at=self._now(),
            )

    def heartbeat(self, job_id: str, *, owner: str) -> JobRecord:
        with self.transaction() as conn:
            job = self._get_locked(conn, job_id)
            if is_terminal_status(job.status):
                raise TerminalJobImmutable(job, job.status)
            now = self._now()
            conn.execute(
                "UPDATE jobs SET worker_owner = ?, heartbeat_at = ?, updated_at = ? WHERE id = ?",
                (owner, now, now, job_id),
            )
            return self._get_locked(conn, job_id)

    def record_submission_intent(self, job_id: str, *, owner: str | None = None) -> JobRecord:
        return self._patch_metadata(job_id, {"providerSubmissionStarted": True}, owner=owner)

    def record_provider_job_id(
        self, job_id: str, provider_job_id: str, *, owner: str | None = None
    ) -> JobRecord:
        return self._patch_metadata(job_id, {"providerJobId": provider_job_id}, owner=owner)

    def _patch_metadata(
        self, job_id: str, patch: dict[str, Any], *, owner: str | None = None
    ) -> JobRecord:
        with self.transaction() as conn:
            job = self._get_locked(conn, job_id)
            if owner is not None and (job.worker_owner != owner or job.status == "queued"):
                raise OwnershipLost(job, owner)
            metadata = dict(job.metadata)
            metadata.update(patch)
            conn.execute(
                "UPDATE jobs SET metadata_json = ?, updated_at = ? WHERE id = ?",
                (_json_dump(metadata), self._now(), job_id),
            )
            self._append_event_locked(conn, job_id, "job.checkpoint", data=patch)
            return self._get_locked(conn, job_id)

    def requeue_pre_side_effect(self, job_id: str, *, reason: str) -> JobRecord:
        """Requeue one attempt that provably never reached submission intent."""

        with self.transaction() as conn:
            job = self._get_locked(conn, job_id)
            if is_terminal_status(job.status):
                raise TerminalJobImmutable(job, "queued")
            if job.metadata.get("providerSubmissionStarted"):
                raise AttemptNotAllowed(
                    f"job {job_id!r} has submission intent; requeue would risk duplicate spend"
                )
            now = self._now()
            conn.execute(
                """
                UPDATE jobs SET status = 'queued', stage = 'queued', worker_owner = NULL,
                    heartbeat_at = NULL, updated_at = ? WHERE id = ?
                """,
                (now, job_id),
            )
            self._append_event_locked(conn, job_id, "job.requeued", message=self._sanitized(reason))
            return self._get_locked(conn, job_id)

    # -- cancellation --------------------------------------------------------

    def request_cancel(self, job_id: str) -> JobRecord:
        with self.transaction() as conn:
            job = self._get_locked(conn, job_id)
            if is_terminal_status(job.status):
                return job
            if job.status == "queued":
                return self._transition_locked(
                    conn, job, status="cancelled", stage="cancelled_before_start"
                )
            if job.status == "cancel_requested":
                return job
            return self._transition_locked(conn, job, status="cancel_requested")

    # -- events and artifacts ------------------------------------------------

    def _append_event_locked(
        self,
        conn: sqlite3.Connection,
        job_id: str,
        event_type: str,
        *,
        message: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        conn.execute(
            """
            INSERT INTO job_events (job_id, event_type, message, data_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                job_id,
                event_type,
                self._sanitized(message),
                self._sanitize(_json_dump(data)),
                self._now(),
            ),
        )

    def append_event(
        self,
        job_id: str,
        event_type: str,
        *,
        message: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        with self.transaction() as conn:
            self._get_locked(conn, job_id)
            self._append_event_locked(conn, job_id, event_type, message=message, data=data)

    def list_events(self, job_id: str, *, after_id: int = 0) -> list[JobEvent]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM job_events WHERE job_id = ? AND id > ? ORDER BY id ASC",
                (job_id, after_id),
            ).fetchall()
        return [_row_to_event(row) for row in rows]

    def record_artifact(self, record: ArtifactRecord) -> None:
        with self.transaction() as conn:
            self._get_locked(conn, record.job_id)
            conn.execute(
                """
                INSERT INTO job_artifacts (
                    artifact_id, job_id, display_name, media_type, checksum, size,
                    relative_path, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.artifact_id,
                    record.job_id,
                    record.display_name,
                    record.media_type,
                    record.checksum,
                    record.size,
                    record.relative_path,
                    self._now(),
                ),
            )
            self._append_event_locked(
                conn,
                record.job_id,
                "artifact.recorded",
                data={"artifactId": record.artifact_id, "displayName": record.display_name},
            )

    def link_artifacts(self, *, from_job_id: str, to_job_id: str) -> list[ArtifactRecord]:
        """Attach one terminal job's artifacts to a provider-free reuse job."""

        with self.transaction() as conn:
            self._get_locked(conn, to_job_id)
            return self._link_artifacts_locked(conn, from_job_id=from_job_id, to_job_id=to_job_id)

    def _link_artifacts_locked(
        self, conn: sqlite3.Connection, *, from_job_id: str, to_job_id: str
    ) -> list[ArtifactRecord]:
        rows = conn.execute(
            "SELECT * FROM job_artifacts WHERE job_id = ? ORDER BY created_at ASC",
            (from_job_id,),
        ).fetchall()
        linked: list[ArtifactRecord] = []
        for row in rows:
            conn.execute(
                """
                INSERT OR IGNORE INTO job_artifacts (
                    artifact_id, job_id, display_name, media_type, checksum, size,
                    relative_path, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["artifact_id"],
                    to_job_id,
                    row["display_name"],
                    row["media_type"],
                    row["checksum"],
                    row["size"],
                    row["relative_path"],
                    self._now(),
                ),
            )
            linked.append(
                _row_to_artifact(
                    conn.execute(
                        "SELECT * FROM job_artifacts WHERE artifact_id = ? AND job_id = ?",
                        (row["artifact_id"], to_job_id),
                    ).fetchone()
                )
            )
        return linked

    def list_artifacts(self, job_id: str) -> list[ArtifactRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM job_artifacts WHERE job_id = ? ORDER BY created_at ASC",
                (job_id,),
            ).fetchall()
        return [_row_to_artifact(row) for row in rows]

    def get_artifact_for_job(self, job_id: str, artifact_id: str) -> ArtifactRecord | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM job_artifacts WHERE job_id = ? AND artifact_id = ?",
                (job_id, artifact_id),
            ).fetchone()
        return _row_to_artifact(row) if row is not None else None
