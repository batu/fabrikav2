"""Durable-job layer failure modes the fork actually hit live: stale results
surviving a requeue, jobs stranded non-terminal by a killed worker, error
messages carrying secrets, and two actors racing one job."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from levelbuilder.api.job_store import (
    JobStore,
    TERMINAL_STATUSES,
    sanitize_error_message,
)


@pytest.fixture()
def store(tmp_path: Path) -> JobStore:
    return JobStore(db_path=tmp_path / "jobs.sqlite")


def _submitted_job(store: JobStore):
    job = store.create_job(kind="crop_inpaint", session_id="sess_a")
    store.update_metadata(job.id, {"providerSubmissionStarted": True, "providerJobId": "prov-123"})
    return store.transition_job(
        job.id,
        status="succeeded",
        result={"succeeded": 20, "failed": 0},
        error_code=None,
    )


def test_requeue_clears_stale_result_and_provider_checkpoints(store: JobStore) -> None:
    job = _submitted_job(store)
    assert job.result["succeeded"] == 20

    requeued = store.requeue_job(job.id, reason="test requeue")
    assert requeued.status == "queued"
    assert requeued.result == {}
    assert requeued.error_code is None and requeued.error_message is None
    assert requeued.metadata.get("providerSubmissionStarted") is False
    assert "providerJobId" not in requeued.metadata
    assert requeued.completed_at is None
    assert requeued.worker_owner is None


def test_killed_worker_job_matches_doctor_census_query(store: JobStore, tmp_path: Path) -> None:
    """A SIGKILLed worker leaves status='running'; the doctor census must see it.
    This asserts against the EXACT query cmd_doctor runs, not a lookalike."""
    import sqlite3

    job = store.create_job(kind="background_generation", session_id="sess_b")
    claimed = store.claim_next_queued_job(owner="worker-1")
    assert claimed is not None and claimed.id == job.id
    #

    conn = sqlite3.connect(store.db_path)
    try:
        rows = conn.execute(
            "SELECT id, kind, status, updated_at FROM jobs "
            "WHERE status NOT IN ('succeeded','failed_retryable','failed_terminal','orphaned_unknown','cancelled')"
        ).fetchall()
    finally:
        conn.close()
    assert [r[0] for r in rows] == [job.id]
    assert rows[0][2] == "running"


@pytest.mark.parametrize(
    ("dirty", "must_not_contain", "must_contain"),
    [
        ("failed with Authorization: Bearer sk-live-abcdef123456", "sk-live", "<redacted>"),
        ("key sk-ant-abcdefghij1234567890 rejected", "sk-ant-abcdefghij", "<redacted-key>"),
        # The URL scrubber swallows the whole URL (stricter than key-masking).
        ("GET https://api.x.com/v1?api_key=supersecret123 failed", "supersecret123", "<redacted-url>"),
        ("bad param api_key=supersecret456 outside a url", "supersecret456", "api_key: <redacted>"),
        ("open /Users/base/dev/appletolye/secret/path.png failed", "/Users/base", "<redacted-path>"),
    ],
)
def test_error_sanitizer_scrubs_secrets(dirty: str, must_not_contain: str, must_contain: str) -> None:
    clean = sanitize_error_message(dirty)
    assert must_not_contain not in clean
    assert must_contain in clean


def test_transition_persists_sanitized_error(store: JobStore) -> None:
    job = store.create_job(kind="crop_inpaint", session_id="sess_c")
    updated = store.transition_job(
        job.id,
        status="failed_terminal",
        error_code="provider_error",
        error_message="Bearer sk-live-zzzzzzzzzzzz refused at /Users/base/dev/x",
    )
    assert "sk-live" not in (updated.error_message or "")
    assert "/Users/base" not in (updated.error_message or "")


def test_concurrent_transitions_do_not_corrupt_the_row(store: JobStore) -> None:
    job = store.create_job(kind="crop_inpaint", session_id="sess_d")

    def flip(status: str):
        return store.transition_job(job.id, status=status)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(flip, "succeeded"), pool.submit(flip, "failed_terminal")]
        results = [f.result() for f in futures]

    final = store.get_job(job.id)
    assert final is not None
    assert final.status in TERMINAL_STATUSES
    # Both writers completed without exception and the row reflects exactly
    # one of them (last-write-wins under BEGIN IMMEDIATE serialization).
    assert final.status in {r.status for r in results}
    assert final.completed_at is not None


def test_two_workers_cannot_claim_the_same_job(store: JobStore) -> None:
    job = store.create_job(kind="crop_inpaint", session_id="sess_e")

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(store.claim_next_queued_job, owner="worker-a"),
            pool.submit(store.claim_next_queued_job, owner="worker-b"),
        ]
        claims = [f.result() for f in futures]

    claimed = [c for c in claims if c is not None]
    assert len(claimed) == 1
    assert claimed[0].id == job.id
    assert claimed[0].status == "running"


def test_idempotency_key_returns_existing_job(store: JobStore) -> None:
    first = store.create_job(kind="crop_inpaint", session_id="sess_f", idempotency_key="req-1")
    second = store.create_job(kind="crop_inpaint", session_id="sess_f", idempotency_key="req-1")
    assert first.id == second.id


def test_worker_start_retries_until_lock_frees(tmp_path):
    """Seam #2 incident (2026-08-14): uvicorn graceful shutdown drains
    in-flight requests while holding the worker flock, so a restarting
    backend's single acquire attempt lost and the new process ran WORKERLESS
    — every author then timed out at 'still queued after 900s'. start must
    keep retrying in the background until the old owner exits."""
    import time
    from levelbuilder.api.job_worker import JobWorker, WorkerOwnershipLock

    lock_path = tmp_path / "jobs.worker.lock"
    old_owner = WorkerOwnershipLock(lock_path)
    assert old_owner.acquire()

    worker = JobWorker(handlers={}, lock_path=lock_path)
    try:
        assert worker.start(retry_interval=0.05) is False  # not yet — but armed
        time.sleep(0.2)
        assert worker.is_running() is False, "claimed while the old owner still held the flock"
        old_owner.release()
        deadline = time.time() + 5
        while time.time() < deadline and not worker.is_running():
            time.sleep(0.05)
        assert worker.is_running() is True, "never claimed after the old owner released"
    finally:
        worker.stop()
