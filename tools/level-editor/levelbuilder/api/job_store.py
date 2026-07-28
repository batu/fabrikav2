"""Durable job ledger for levelbuilder background work.

This module is intentionally small: it owns persistence for job status,
events, and artifact summaries, but not provider execution. The worker layer
will orchestrate provider calls and session/artifact helpers on top of this
store.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal, Sequence

JobStatus = Literal[
    "queued",
    "running",
    "submitted",
    "polling",
    "downloading",
    "finalizing",
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "orphaned_unknown",
    "cancel_requested",
    "cancelled",
]

TERMINAL_STATUSES: set[str] = {
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "orphaned_unknown",
    "cancelled",
}

FAILED_TERMINAL_STATUSES: set[str] = {
    "failed_retryable",
    "failed_terminal",
    "orphaned_unknown",
    "cancelled",
}

VALID_STATUSES: set[str] = {
    "queued",
    "running",
    "submitted",
    "polling",
    "downloading",
    "finalizing",
    *TERMINAL_STATUSES,
    "cancel_requested",
}

ATTEMPT_SCOPED_METADATA_KEYS: set[str] = {
    "providerSubmissionStarted",
    "providerJobId",
}

_URL_RE = re.compile(r"https?://[^\s)>'\"]+")
# Credential/path scrub patterns mirroring inpaint._sanitized_error (widened
# 030). This function is the transition_job CHOKEPOINT, so every job error
# writer is covered — including JobWorker's catch-all, which used to persist
# raw str(exc) with only URL scrubbing and could leak Authorization headers,
# sk- keys, or backend paths to clients via the job error field (ledger 054
# #16). Full detail still reaches server logs before sanitization.
_SCRUB_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)\b(bearer)\s+\S+"), r"\1 <redacted>"),
    (re.compile(r"(?i)(authorization|x-[a-z-]*api[_-]?key|x-[a-z-]*key|api[_-]?key)\s*[:=]\s*\S+"), r"\1: <redacted>"),
    (re.compile(r"(?i)([?&])(api[_-]?key|key|token)=[^&\s\"]+"), r"\1\2=<redacted>"),
    (re.compile(r"sk-ant-[A-Za-z0-9_\-]{10,}"), "<redacted-key>"),
    (re.compile(r"sk-[A-Za-z0-9_\-]{10,}"), "<redacted-key>"),
    (re.compile(r"/home/[A-Za-z0-9_\-./]+"), "<redacted-path>"),
    (re.compile(r"/Users/[A-Za-z0-9_\-./]+"), "<redacted-path>"),
]

JOBS_DB_PATH = (
    Path(
        os.environ.get("LEVELBUILDER_WORKSPACE")
        or Path(__file__).resolve().parent.parent
    )
    / "state"
    / "jobs.sqlite"
)
_SCHEMA_LOCK = threading.Lock()


@dataclass(frozen=True)
class JobRecord:
    id: str
    parent_job_id: str | None
    kind: str
    session_id: str
    idempotency_key: str | None
    input_hash: str | None
    status: JobStatus
    stage: str | None
    retryable: bool
    error_code: str | None
    error_message: str | None
    metadata: dict[str, Any]
    result: dict[str, Any]
    worker_owner: str | None
    heartbeat_at: str | None
    created_at: str
    updated_at: str
    completed_at: str | None


@dataclass(frozen=True)
class JobEvent:
    id: int
    job_id: str
    event_type: str
    message: str | None
    data: dict[str, Any]
    created_at: str


@dataclass(frozen=True)
class JobArtifact:
    id: int
    job_id: str
    artifact_type: str
    path: str
    checksum: str | None
    content_type: str | None
    metadata: dict[str, Any]
    created_at: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_error_message(message: str | None) -> str | None:
    if message is None:
        return None
    scrubbed = _URL_RE.sub("<redacted-url>", message)
    for pattern, repl in _SCRUB_PATTERNS:
        scrubbed = pattern.sub(repl, scrubbed)
    return scrubbed


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
        parent_job_id=row["parent_job_id"],
        kind=str(row["kind"]),
        session_id=str(row["session_id"]),
        idempotency_key=row["idempotency_key"],
        input_hash=row["input_hash"],
        status=row["status"],
        stage=row["stage"],
        retryable=bool(row["retryable"]),
        error_code=row["error_code"],
        error_message=row["error_message"],
        metadata=_json_load(row["metadata_json"]),
        result=_json_load(row["result_json"]),
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


def _row_to_artifact(row: sqlite3.Row) -> JobArtifact:
    return JobArtifact(
        id=int(row["id"]),
        job_id=str(row["job_id"]),
        artifact_type=str(row["artifact_type"]),
        path=str(row["path"]),
        checksum=row["checksum"],
        content_type=row["content_type"],
        metadata=_json_load(row["metadata_json"]),
        created_at=str(row["created_at"]),
    )


def is_terminal_status(status: str) -> bool:
    return status in TERMINAL_STATUSES


def is_failed_terminal_status(status: str) -> bool:
    return status in FAILED_TERMINAL_STATUSES


def clear_attempt_scoped_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in metadata.items() if key not in ATTEMPT_SCOPED_METADATA_KEYS}


class JobStore:
    def __init__(self, db_path: Path = JOBS_DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

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

    def initialize(self) -> None:
        with _SCHEMA_LOCK:
            with self.connect() as conn:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS jobs (
                        id TEXT PRIMARY KEY,
                        parent_job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
                        kind TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        idempotency_key TEXT,
                        input_hash TEXT,
                        status TEXT NOT NULL,
                        stage TEXT,
                        retryable INTEGER NOT NULL DEFAULT 0,
                        error_code TEXT,
                        error_message TEXT,
                        metadata_json TEXT NOT NULL DEFAULT '{}',
                        result_json TEXT NOT NULL DEFAULT '{}',
                        worker_owner TEXT,
                        heartbeat_at TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        completed_at TEXT
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency
                        ON jobs(kind, idempotency_key)
                        WHERE idempotency_key IS NOT NULL;
                    CREATE INDEX IF NOT EXISTS idx_jobs_status_created
                        ON jobs(status, created_at);
                    CREATE INDEX IF NOT EXISTS idx_jobs_session
                        ON jobs(session_id);

                    CREATE TABLE IF NOT EXISTS job_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                        event_type TEXT NOT NULL,
                        message TEXT,
                        data_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_job_events_job_id_id
                        ON job_events(job_id, id);

                    CREATE TABLE IF NOT EXISTS job_artifacts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                        artifact_type TEXT NOT NULL,
                        path TEXT NOT NULL,
                        checksum TEXT,
                        content_type TEXT,
                        metadata_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_job_artifacts_job_id
                        ON job_artifacts(job_id);
                    """
                )
                self._ensure_jobs_parent_column(conn)

    def _ensure_jobs_parent_column(self, conn: sqlite3.Connection) -> None:
        # KNOWN, DOCUMENTED DIVERGENCE (todo 043): a freshly-created `jobs` table
        # declares `parent_job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE`, but
        # SQLite cannot add a column-level foreign key via ALTER TABLE ADD COLUMN.
        # So a DB that predates the parent_job_id column gets the column with NO
        # foreign key and NO cascade — `PRAGMA foreign_key_list(jobs)` returns the
        # cascade FK on a fresh table and an empty list on a migrated one.
        #
        # This is intentionally NOT fixed with a table-rebuild migration because
        # child cleanup is APPLICATION-LEVEL, not FK-cascade: nothing in this
        # codebase issues `DELETE FROM jobs` (verified), so no code path relies on
        # the cascade on either a fresh or a migrated DB. If a job-row deletion
        # path is ever introduced, it MUST delete children explicitly (or sweep
        # orphans in application code) rather than assume ON DELETE CASCADE fires —
        # on migrated DBs it will not. At that point, revisit with a
        # CREATE jobs_new / INSERT SELECT / DROP / RENAME rebuild so fresh and
        # migrated DBs enforce identical integrity (todo 043 option b).
        columns = {
            str(row["name"])
            for row in conn.execute("PRAGMA table_info(jobs)").fetchall()
        }
        if "parent_job_id" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN parent_job_id TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_jobs_parent ON jobs(parent_job_id, created_at)"
        )

    def create_job(
        self,
        *,
        kind: str,
        session_id: str,
        parent_job_id: str | None = None,
        idempotency_key: str | None = None,
        input_hash: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> JobRecord:
        now = utc_now_iso()
        job_id = uuid.uuid4().hex
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if idempotency_key is not None:
                existing = conn.execute(
                    "SELECT * FROM jobs WHERE kind = ? AND idempotency_key = ?",
                    (kind, idempotency_key),
                ).fetchone()
                if existing is not None:
                    conn.execute("COMMIT")
                    return _row_to_job(existing)
            conn.execute(
                """
                INSERT INTO jobs (
                    id, parent_job_id, kind, session_id, idempotency_key, input_hash,
                    status, stage, retryable, metadata_json, result_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 'queued', 0, ?, '{}', ?, ?)
                """,
                (
                    job_id,
                    parent_job_id,
                    kind,
                    session_id,
                    idempotency_key,
                    input_hash,
                    _json_dump(metadata),
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO job_events (job_id, event_type, message, data_json, created_at)
                VALUES (?, 'job.created', NULL, '{}', ?)
                """,
                (job_id, now),
            )
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            conn.execute("COMMIT")
        return _row_to_job(row)

    def get_job(self, job_id: str) -> JobRecord | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return _row_to_job(row) if row is not None else None

    def get_job_by_idempotency_key(self, *, kind: str, idempotency_key: str) -> JobRecord | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE kind = ? AND idempotency_key = ?",
                (kind, idempotency_key),
            ).fetchone()
        return _row_to_job(row) if row is not None else None

    def transition_job(
        self,
        job_id: str,
        *,
        status: JobStatus,
        stage: str | None = None,
        retryable: bool | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        result: dict[str, Any] | None = None,
        worker_owner: str | None = None,
        heartbeat_at: str | None = None,
    ) -> JobRecord:
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid job status: {status}")
        now = utc_now_iso()
        completed_at = now if status in TERMINAL_STATUSES else None
        safe_error = sanitize_error_message(error_message)
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if existing is None:
                conn.execute("ROLLBACK")
                raise KeyError(job_id)
            next_retryable = int(bool(retryable)) if retryable is not None else int(existing["retryable"])
            next_result = _json_dump(result) if result is not None else existing["result_json"]
            conn.execute(
                """
                UPDATE jobs
                SET status = ?, stage = ?, retryable = ?, error_code = ?, error_message = ?,
                    result_json = ?, worker_owner = ?, heartbeat_at = ?, updated_at = ?, completed_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    stage if stage is not None else status,
                    next_retryable,
                    error_code,
                    safe_error,
                    next_result,
                    worker_owner,
                    heartbeat_at,
                    now,
                    completed_at,
                    job_id,
                ),
            )
            conn.execute(
                """
                INSERT INTO job_events (job_id, event_type, message, data_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    f"job.{status}",
                    safe_error,
                    _json_dump({"stage": stage if stage is not None else status}),
                    now,
                ),
            )
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            conn.execute("COMMIT")
        return _row_to_job(row)

    def append_event(
        self,
        job_id: str,
        event_type: str,
        *,
        message: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> JobEvent:
        now = utc_now_iso()
        safe_message = sanitize_error_message(message)
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO job_events (job_id, event_type, message, data_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (job_id, event_type, safe_message, _json_dump(data), now),
            )
            row = conn.execute("SELECT * FROM job_events WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _row_to_event(row)

    def list_events(self, job_id: str, *, after_id: int = 0) -> list[JobEvent]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM job_events
                WHERE job_id = ? AND id > ?
                ORDER BY id ASC
                """,
                (job_id, after_id),
            ).fetchall()
        return [_row_to_event(row) for row in rows]

    def record_artifact(
        self,
        job_id: str,
        *,
        artifact_type: str,
        path: str,
        checksum: str | None = None,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> JobArtifact:
        now = utc_now_iso()
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO job_artifacts (
                    job_id, artifact_type, path, checksum, content_type, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (job_id, artifact_type, path, checksum, content_type, _json_dump(metadata), now),
            )
            conn.execute(
                """
                INSERT INTO job_events (job_id, event_type, message, data_json, created_at)
                VALUES (?, 'artifact.recorded', NULL, ?, ?)
                """,
                (job_id, _json_dump({"artifactType": artifact_type, "path": path}), now),
            )
            row = conn.execute("SELECT * FROM job_artifacts WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _row_to_artifact(row)

    def list_artifacts(self, job_id: str) -> list[JobArtifact]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM job_artifacts WHERE job_id = ? ORDER BY id ASC",
                (job_id,),
            ).fetchall()
        return [_row_to_artifact(row) for row in rows]

    def claim_next_queued_job(self, *, owner: str, kinds: Sequence[str] | None = None) -> JobRecord | None:
        now = utc_now_iso()
        kind_filter = ""
        params: list[Any] = []
        if kinds is not None:
            concrete_kinds = tuple(kinds)
            if len(concrete_kinds) == 0:
                return None
            kind_filter = f"AND kind IN ({','.join('?' for _ in concrete_kinds)})"
            params.extend(concrete_kinds)
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"""
                SELECT * FROM jobs
                WHERE status = 'queued'
                {kind_filter}
                ORDER BY created_at ASC
                LIMIT 1
                """,
                params,
            ).fetchone()
            if row is None:
                conn.execute("COMMIT")
                return None
            conn.execute(
                """
                UPDATE jobs
                SET status = 'running', stage = 'running', worker_owner = ?, heartbeat_at = ?, updated_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (owner, now, now, row["id"]),
            )
            conn.execute(
                """
                INSERT INTO job_events (job_id, event_type, message, data_json, created_at)
                VALUES (?, 'job.running', NULL, ?, ?)
                """,
                (row["id"], _json_dump({"owner": owner}), now),
            )
            claimed = conn.execute("SELECT * FROM jobs WHERE id = ?", (row["id"],)).fetchone()
            conn.execute("COMMIT")
        return _row_to_job(claimed)

    def list_jobs(
        self,
        *,
        session_id: str | None = None,
        kind: str | None = None,
        statuses: Sequence[str] | None = None,
        parent_job_id: str | None = None,
        include_children: bool = True,
    ) -> list[JobRecord]:
        clauses: list[str] = []
        params: list[Any] = []
        if session_id is not None:
            clauses.append("session_id = ?")
            params.append(session_id)
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)
        if parent_job_id is not None:
            clauses.append("parent_job_id = ?")
            params.append(parent_job_id)
        elif not include_children:
            clauses.append("parent_job_id IS NULL")
        if statuses is not None:
            concrete_statuses = tuple(statuses)
            if len(concrete_statuses) == 0:
                return []
            clauses.append(f"status IN ({','.join('?' for _ in concrete_statuses)})")
            params.extend(concrete_statuses)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM jobs
                {where_sql}
                ORDER BY created_at ASC
                """,
                params,
            ).fetchall()
        return [_row_to_job(row) for row in rows]

    def list_jobs_by_status(self, statuses: Sequence[str]) -> list[JobRecord]:
        return self.list_jobs(statuses=statuses)

    def list_child_jobs(
        self,
        parent_job_id: str,
        *,
        kind: str | None = None,
        statuses: Sequence[str] | None = None,
    ) -> list[JobRecord]:
        return self.list_jobs(parent_job_id=parent_job_id, kind=kind, statuses=statuses)

    def requeue_job(self, job_id: str, *, reason: str) -> JobRecord:
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                conn.execute("ROLLBACK")
                raise KeyError(job_id)
            metadata = clear_attempt_scoped_metadata(_json_load(row["metadata_json"]))
            metadata["safeToRequeue"] = True
            metadata["providerSubmissionStarted"] = False
            conn.execute(
                """
                UPDATE jobs
                SET status = 'queued', stage = 'queued', retryable = 0,
                    error_code = NULL, error_message = NULL, metadata_json = ?, result_json = '{}',
                    worker_owner = NULL, heartbeat_at = NULL, updated_at = ?, completed_at = NULL
                WHERE id = ?
                """,
                (_json_dump(metadata), now, job_id),
            )
            conn.execute(
                """
                INSERT INTO job_events (job_id, event_type, message, data_json, created_at)
                VALUES (?, 'job.requeued', ?, ?, ?)
                """,
                (job_id, reason, _json_dump({"reason": reason}), now),
            )
            updated = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            conn.execute("COMMIT")
        return _row_to_job(updated)

    def update_metadata(self, job_id: str, patch: dict[str, Any]) -> JobRecord:
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if existing is None:
                conn.execute("ROLLBACK")
                raise KeyError(job_id)
            metadata = _json_load(existing["metadata_json"])
            metadata.update(patch)
            conn.execute(
                "UPDATE jobs SET metadata_json = ?, updated_at = ? WHERE id = ?",
                (_json_dump(metadata), now, job_id),
            )
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            conn.execute("COMMIT")
        return _row_to_job(row)

    def update_result(self, job_id: str, patch: dict[str, Any]) -> JobRecord:
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if existing is None:
                conn.execute("ROLLBACK")
                raise KeyError(job_id)
            result = _json_load(existing["result_json"])
            result.update(patch)
            conn.execute(
                "UPDATE jobs SET result_json = ?, updated_at = ? WHERE id = ?",
                (_json_dump(result), now, job_id),
            )
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            conn.execute("COMMIT")
        return _row_to_job(row)

    def update_heartbeat(self, job_id: str, *, owner: str) -> JobRecord:
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if existing is None:
                conn.execute("ROLLBACK")
                raise KeyError(job_id)
            conn.execute(
                """
                UPDATE jobs
                SET worker_owner = ?, heartbeat_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (owner, now, now, job_id),
            )
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            conn.execute("COMMIT")
        return _row_to_job(row)

    def mark_orphaned_unknown(self, job_id: str, *, reason: str) -> JobRecord:
        return self.transition_job(
            job_id,
            status="orphaned_unknown",
            stage="orphaned_unknown",
            retryable=False,
            error_code="orphaned_unknown",
            error_message=reason,
        )
