from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from levelbuilder.api.job_store import JobStore, sanitize_error_message


def make_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs.sqlite")


def test_create_job_persists_and_reloads_with_created_event(tmp_path: Path) -> None:
    store = make_store(tmp_path)

    job = store.create_job(
        kind="upscale_background",
        session_id="session_01",
        idempotency_key="upscale:session_01:bg0:fal-ai/esrgan:3840",
        input_hash="hash-1",
        metadata={"model": "fal-ai/esrgan"},
    )

    reloaded = make_store(tmp_path).get_job(job.id)
    assert reloaded is not None
    assert reloaded.status == "queued"
    assert reloaded.stage == "queued"
    assert reloaded.kind == "upscale_background"
    assert reloaded.session_id == "session_01"
    assert reloaded.metadata == {"model": "fal-ai/esrgan"}

    events = store.list_events(job.id)
    assert [(event.event_type, event.job_id) for event in events] == [("job.created", job.id)]


def test_create_job_reuses_existing_idempotency_key(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    first = store.create_job(
        kind="upscale_background",
        session_id="session_01",
        idempotency_key="provider-input-key",
    )

    second = store.create_job(
        kind="upscale_background",
        session_id="session_01",
        idempotency_key="provider-input-key",
    )

    assert second.id == first.id
    assert store.get_job_by_idempotency_key(kind="upscale_background", idempotency_key="provider-input-key").id == first.id  # type: ignore[union-attr]
    assert len(store.list_events(first.id)) == 1


def test_child_jobs_are_linked_to_parent_and_queryable(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    parent = store.create_job(kind="crop_inpaint", session_id="session_01")
    first_child = store.create_job(
        kind="crop_inpaint_unit",
        session_id="session_01",
        parent_job_id=parent.id,
        idempotency_key=f"{parent.id}:dog:0",
        metadata={"dogIndex": 0},
    )
    second_child = store.create_job(
        kind="crop_inpaint_unit",
        session_id="session_01",
        parent_job_id=parent.id,
        idempotency_key=f"{parent.id}:dog:1",
        metadata={"dogIndex": 1},
    )

    reloaded = make_store(tmp_path).list_child_jobs(parent.id)

    assert [job.id for job in reloaded] == [first_child.id, second_child.id]
    assert [job.parent_job_id for job in reloaded] == [parent.id, parent.id]
    assert [job.metadata["dogIndex"] for job in reloaded] == [0, 1]
    assert store.list_child_jobs(parent.id, kind="crop_inpaint_unit", statuses=("queued",)) == reloaded


def test_existing_job_databases_gain_parent_column(tmp_path: Path) -> None:
    db_path = tmp_path / "jobs.sqlite"
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE jobs (
                id TEXT PRIMARY KEY,
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
            """
        )

    migrated = JobStore(db_path)
    job = migrated.create_job(kind="background_generation", session_id="session_01")

    assert job.parent_job_id is None
    with migrated.connect() as conn:
        columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}
    assert "parent_job_id" in columns


def test_job_events_are_replayable_by_cursor(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    job = store.create_job(kind="upscale_background", session_id="session_01")
    first = store.append_event(job.id, "provider.submitted", data={"provider": "fal"})
    second = store.append_event(job.id, "artifact.partial_written", data={"path": "bg_01.tmp"})

    replayed = store.list_events(job.id, after_id=first.id)

    assert [event.id for event in replayed] == [second.id]
    assert replayed[0].data == {"path": "bg_01.tmp"}


def test_transition_job_persists_terminal_result_and_sanitized_error(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    job = store.create_job(kind="upscale_background", session_id="session_01")

    updated = store.transition_job(
        job.id,
        status="failed_retryable",
        stage="provider_submit",
        retryable=True,
        error_code="provider_timeout",
        error_message="timeout downloading https://signed.example.com/output.png?token=secret",
        result={"attempt": 1},
    )

    assert updated.status == "failed_retryable"
    assert updated.retryable is True
    assert updated.completed_at is not None
    assert updated.result == {"attempt": 1}
    assert updated.error_message == "timeout downloading <redacted-url>"
    assert "secret" not in updated.error_message

    events = store.list_events(job.id)
    assert events[-1].event_type == "job.failed_retryable"
    assert events[-1].message == "timeout downloading <redacted-url>"


def test_invalid_transition_status_is_rejected(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    job = store.create_job(kind="upscale_background", session_id="session_01")

    with pytest.raises(ValueError):
        store.transition_job(job.id, status="not_real")  # type: ignore[arg-type]


def test_record_artifact_persists_safe_relative_output(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    job = store.create_job(kind="upscale_background", session_id="session_01")

    artifact = store.record_artifact(
        job.id,
        artifact_type="upscaled_background",
        path="bg_01.png",
        checksum="sha256:abc",
        content_type="image/png",
        metadata={"width": 2560, "height": 3840},
    )

    assert artifact.path == "bg_01.png"
    assert artifact.metadata == {"width": 2560, "height": 3840}
    assert make_store(tmp_path).list_artifacts(job.id)[0].checksum == "sha256:abc"
    assert store.list_events(job.id)[-1].event_type == "artifact.recorded"


def test_claim_next_queued_job_is_atomic_across_threads(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    job = store.create_job(kind="upscale_background", session_id="session_01")

    def claim(owner: str) -> str | None:
        claimed = make_store(tmp_path).claim_next_queued_job(owner=owner)
        return claimed.id if claimed else None

    with ThreadPoolExecutor(max_workers=4) as executor:
        claimed_ids = list(executor.map(claim, ["worker-a", "worker-b", "worker-c", "worker-d"]))

    assert claimed_ids.count(job.id) == 1
    assert claimed_ids.count(None) == 3
    reloaded = store.get_job(job.id)
    assert reloaded is not None
    assert reloaded.status == "running"
    assert reloaded.worker_owner in {"worker-a", "worker-b", "worker-c", "worker-d"}


def test_requeue_clears_attempt_scoped_provider_state(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    job = store.create_job(
        kind="upscale_background",
        session_id="session_01",
        metadata={
            "bgIndex": 0,
            "providerSubmissionStarted": True,
            "providerJobId": "provider-old",
            "safeToRequeue": False,
        },
    )
    store.transition_job(
        job.id,
        status="failed_retryable",
        retryable=True,
        error_code="upscale_failed",
        error_message="temporary failure",
        result={"providerJobId": "provider-old", "background": {"index": 2}},
    )

    requeued = store.requeue_job(job.id, reason="retry requested")

    assert requeued.status == "queued"
    assert requeued.result == {}
    assert requeued.metadata == {"bgIndex": 0, "providerSubmissionStarted": False, "safeToRequeue": True}
    assert requeued.error_code is None
    assert requeued.error_message is None
    assert requeued.completed_at is None


def test_requeue_clears_attempt_scoped_provider_state_on_child_job(tmp_path: Path) -> None:
    """045 gap: requeue clearing of result_json + provider checkpoint was only
    asserted on top-level jobs. A CHILD unit (per-dog / per-option) carries the
    same paid-provider checkpoint, so requeuing it must clear result + the
    attempt-scoped metadata too — otherwise a per-unit retry could re-bill or
    replay stale provider state (R3). requeue_job is parent/child-agnostic; pin
    that for a child explicitly, and confirm parent_job_id survives the requeue."""
    store = make_store(tmp_path)
    parent = store.create_job(kind="crop_inpaint_retry", session_id="session_01")
    child = store.create_job(
        kind="crop_inpaint_unit",
        session_id="session_01",
        parent_job_id=parent.id,
        metadata={
            "dogIndex": 3,
            "providerSubmissionStarted": True,
            "providerJobId": "provider-child-old",
            "safeToRequeue": False,
        },
    )
    store.transition_job(
        child.id,
        status="failed_retryable",
        retryable=True,
        error_code="inpaint_failed",
        error_message="temporary failure",
        result={"providerJobId": "provider-child-old", "dogIndex": 3},
    )

    requeued = store.requeue_job(child.id, reason="per-dog retry requested")

    assert requeued.status == "queued"
    assert requeued.result == {}  # stale per-unit result cleared
    assert requeued.metadata == {"dogIndex": 3, "providerSubmissionStarted": False, "safeToRequeue": True}
    assert "providerJobId" not in requeued.metadata  # paid checkpoint cleared
    assert requeued.parent_job_id == parent.id  # parentage preserved across requeue
    assert requeued.error_code is None


def test_sanitize_error_message_redacts_urls() -> None:
    sanitized = sanitize_error_message("provider returned https://signed.example.test/file.png?token=abc")

    assert sanitized == "provider returned <redacted-url>"


def test_fresh_db_has_parent_cascade_fk_but_migrated_db_does_not(tmp_path: Path) -> None:
    """Todo 043 (decision a): document the known FK divergence as a pinned
    characterization. A FRESH jobs table carries the
    `parent_job_id REFERENCES jobs(id) ON DELETE CASCADE` foreign key; a DB
    MIGRATED via ALTER TABLE ADD COLUMN gets the column with NO foreign key
    (SQLite cannot add a column-level FK via ALTER). No code path relies on the
    cascade (no `DELETE FROM jobs` exists), so this divergence is intentional.
    If a future change rebuilds the table to unify them (option b), update this
    test."""

    def parent_fk_count(db_path: Path) -> int:
        conn = sqlite3.connect(db_path)
        try:
            fks = conn.execute("PRAGMA foreign_key_list(jobs)").fetchall()
            # PRAGMA foreign_key_list columns: (id, seq, table, from, to, ...).
            # Index 3 is "from" (the local column); count FKs on parent_job_id.
            return sum(1 for fk in fks if fk[3] == "parent_job_id")
        finally:
            conn.close()

    # Fresh DB built by JobStore.initialize -> has the parent cascade FK.
    fresh_path = tmp_path / "fresh.sqlite"
    JobStore(fresh_path)
    assert parent_fk_count(fresh_path) == 1

    # Simulate a legacy DB: a jobs table WITHOUT parent_job_id, then let
    # JobStore migrate it (ALTER TABLE ADD COLUMN) -> no FK.
    migrated_path = tmp_path / "migrated.sqlite"
    legacy = sqlite3.connect(migrated_path)
    # Full original jobs schema MINUS parent_job_id — the realistic "pre-parent
    # column" DB that initialize() then migrates via ALTER TABLE ADD COLUMN.
    legacy.executescript(
        """
        CREATE TABLE jobs (
            id TEXT PRIMARY KEY,
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
        """
    )
    legacy.commit()
    legacy.close()
    JobStore(migrated_path)  # runs _ensure_jobs_parent_column -> ALTER ADD COLUMN
    assert parent_fk_count(migrated_path) == 0  # documented divergence


def test_sanitize_error_message_scrubs_credentials_and_paths() -> None:
    # Ledger 054 #16: sanitize_error_message is the transition_job CHOKEPOINT —
    # JobWorker's catch-all persists str(exc) through it, so it must scrub the
    # same credential/path shapes as inpaint._sanitized_error, not just URLs.
    from levelbuilder.api.job_store import sanitize_error_message

    msg = (
        "httpx.HTTPStatusError: 401 for https://api.layer.ai/v1/x?api-key=SECRET123 "
        "Authorization: Bearer abc.def.ghi x-api-key: k-12345 "
        "key sk-ant-abcdefghijklmnop and sk-0123456789abcdef "
        "while reading /home/batu/Desktop/utolye/fabrika/games/find_the_dog/x.png"
    )
    out = sanitize_error_message(msg)
    assert out is not None
    for leak in ("SECRET123", "abc.def.ghi", "k-12345", "sk-ant-abcdefghijklmnop",
                 "sk-0123456789abcdef", "/home/batu"):
        assert leak not in out, f"leaked: {leak} in {out!r}"
    assert sanitize_error_message(None) is None


def test_generation_status_includes_queued_background_jobs(tmp_path, monkeypatch) -> None:
    # Ledger 054 #15: _active_generations only tracks RUNNING handlers, so a
    # queued durable background job was invisible to /generation-status — and
    # the BatchPage poll's "generating_bg but not in the active set => failed"
    # heuristic then misclassified genuinely queued cards for any batch >= 2.
    from levelbuilder.api import inpaint
    from levelbuilder.api.job_store import JobStore

    store = JobStore(tmp_path / "jobs.sqlite")
    monkeypatch.setattr(inpaint, "JOB_STORE", store)
    queued = store.create_job(kind="background_generation", session_id="queued_sess")

    payload = inpaint._generation_status_payload()
    sessions = payload["backgrounds"]["sessions"]
    assert "queued_sess" in sessions
    assert sessions["queued_sess"]["queued"] is True
    assert sessions["queued_sess"]["jobId"] == queued.id

    # A RUNNING handler entry takes precedence (richer data) over the job row.
    inpaint._set_active_generation("queued_sess", {
        "kind": "background",
        "startedAt": 1.0,
        "nOptions": 4,
        "total": 4,
    })
    try:
        payload = inpaint._generation_status_payload()
        running = payload["backgrounds"]["sessions"]["queued_sess"]
        assert "queued" not in running
        assert "nOptions" not in running
        assert running["total"] == 4
    finally:
        inpaint._set_active_generation("queued_sess", None)
