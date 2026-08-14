"""Local durable-job worker for the levelbuilder.

The worker is deliberately single-process/local for now. It owns execution for
queued jobs with registered handlers and uses a process-level lock so dev
restarts do not accidentally run two paid-job workers against the same SQLite
ledger.
"""

from __future__ import annotations

import fcntl
import logging
import os
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Any, Self

from .job_store import JOBS_DB_PATH, JobRecord, JobStore, is_terminal_status

logger = logging.getLogger("levelbuilder.job_worker")

ACTIVE_RECOVERY_STATUSES = (
    "running",
    "submitted",
    "polling",
    "downloading",
    "finalizing",
    "cancel_requested",
)

JobHandler = Callable[[JobRecord, JobStore], dict[str, Any] | None]


class JobError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class RetryableJobError(JobError):
    pass


class TerminalJobError(JobError):
    pass


@dataclass(frozen=True)
class WorkerConfig:
    poll_interval_seconds: float = 0.25
    stale_after_seconds: float = 60.0
    shutdown_join_seconds: float = 5.0
    # Parallel job execution (operator order 2026-08-14, "3x"). Provider
    # rate limits stay enforced by the per-provider permits inside handlers.
    concurrency: int = 3


class WorkerOwnershipLock:
    """Non-blocking process lock that keeps one local worker owner alive."""

    def __init__(self, lock_path: Path) -> None:
        self.lock_path = lock_path
        self._fd: int | None = None

    def acquire(self) -> bool:
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return False
        os.ftruncate(fd, 0)
        os.write(fd, str(os.getpid()).encode())
        self._fd = fd
        return True

    def release(self) -> None:
        if self._fd is None:
            return
        fcntl.flock(self._fd, fcntl.LOCK_UN)
        os.close(self._fd)
        self._fd = None

    def __enter__(self) -> Self:
        if not self.acquire():
            raise RuntimeError(f"Could not acquire worker ownership lock: {self.lock_path}")
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.release()


class JobWorker:
    def __init__(
        self,
        *,
        store: JobStore | None = None,
        handlers: dict[str, JobHandler] | None = None,
        owner_id: str | None = None,
        lock_path: Path | None = None,
        config: WorkerConfig | None = None,
    ) -> None:
        self.store = store or JobStore()
        self.handlers = handlers or {}
        self.owner_id = owner_id or f"worker-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        self.lock_path = lock_path or (JOBS_DB_PATH.parent / "jobs.worker.lock")
        self.config = config or WorkerConfig()
        self._ownership_lock = WorkerOwnershipLock(self.lock_path)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._inflight: dict[str, threading.Thread] = {}
        self._inflight_lock = threading.Lock()

    def register_handler(self, kind: str, handler: JobHandler) -> None:
        self.handlers[kind] = handler

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, retry_interval: float | None = None) -> bool:
        """Claim ownership and run. With retry_interval, a lost claim arms a
        background retrier instead of giving up — a restarting sibling holds
        the flock while uvicorn drains in-flight requests, and a single
        attempt left the new process permanently workerless (seam #2
        incident, 2026-08-14)."""
        if self.is_running():
            return True
        if not self._ownership_lock.acquire():
            logger.warning("durable job worker not started; another owner holds %s", self.lock_path)
            if retry_interval is not None:
                self._stop_event.clear()
                self._retry_thread = threading.Thread(
                    target=self._retry_start, args=(retry_interval,),
                    name="ftd-job-worker-claim", daemon=True,
                )
                self._retry_thread.start()
            return False
        self.recover_stale_jobs()
        self._stop_event.clear()
        self._thread = threading.Thread(target=self.run_forever, name="ftd-job-worker", daemon=True)
        self._thread.start()
        return True

    def _retry_start(self, interval: float) -> None:
        while not self._stop_event.is_set():
            if self._ownership_lock.acquire():
                logger.info("durable job worker claimed %s after retry", self.lock_path)
                self.recover_stale_jobs()
                self._thread = threading.Thread(
                    target=self.run_forever, name="ftd-job-worker", daemon=True
                )
                self._thread.start()
                return
            self._stop_event.wait(interval)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=self.config.shutdown_join_seconds)
            if self._thread.is_alive():
                logger.warning(
                    "durable job worker is still running; keeping ownership lock held until process exit"
                )
                return
            self._thread = None
        self._ownership_lock.release()

    def run_forever(self) -> None:
        while not self._stop_event.is_set():
            try:
                did_work = self.run_once()
            except Exception:
                logger.exception("durable job worker iteration failed; worker will continue")
                did_work = False
            if not did_work:
                self._stop_event.wait(self.config.poll_interval_seconds)

    def run_once(self) -> bool:
        supported_kinds = tuple(self.handlers.keys())
        with self._inflight_lock:
            capacity = max(1, int(self.config.concurrency)) - len(self._inflight)
        claimed_any = False
        for _ in range(capacity):
            job = self.store.claim_next_queued_job(owner=self.owner_id, kinds=supported_kinds)
            if job is None:
                break
            claimed_any = True
            thread = threading.Thread(
                target=self._execute_and_untrack, args=(job,),
                name=f"ftd-job-{job.id[:8]}", daemon=True,
            )
            with self._inflight_lock:
                self._inflight[job.id] = thread
            thread.start()
        return claimed_any

    def _execute_and_untrack(self, job: JobRecord) -> None:
        try:
            self._execute_job(job)
        finally:
            with self._inflight_lock:
                self._inflight.pop(job.id, None)

    def recover_stale_jobs(self) -> list[JobRecord]:
        recovered: list[JobRecord] = []
        for job in self.store.list_jobs_by_status(ACTIVE_RECOVERY_STATUSES):
            if job.parent_job_id is not None:
                continue
            if not self._is_stale(job):
                continue
            recovered_job = self._recover_stale_job(job)
            self._recover_stale_child_jobs(parent_job_id=job.id, parent_status=recovered_job.status)
            recovered.append(recovered_job)
        recovered.extend(self._recover_orphaned_children_of_terminal_parents())
        return recovered

    def _recover_orphaned_children_of_terminal_parents(self) -> list[JobRecord]:
        """Reconcile active children whose parent is ALREADY terminal (todo 044).

        The loop above only reaches children through a stale ACTIVE parent. If a
        parent finalized (succeeded / failed_* / cancelled / orphaned_unknown)
        while a child was still active — a crash between a child's last
        transition and the parent's terminal finalize — that child is never
        visited and stays active forever, showing as perpetually in-flight in
        list_child_jobs (which drives unit status). Sweep them here.

        An active child under a terminal parent never resolved its (possibly
        paid) work, so mark it orphaned_unknown for manual review rather than
        guessing it succeeded — consistent with the paid-safety stance in
        _recover_stale_job.

        No overlap with the active-parent loop above: that loop only visits
        children of parents in ACTIVE_RECOVERY_STATUSES, and this sweep only
        visits children of TERMINAL parents — disjoint sets. A parent that was
        requeued to `queued` is in NEITHER set (queued is neither active-recovery
        nor terminal), so its still-active children are left untouched by
        recovery; they self-heal when the queued parent is re-claimed and its
        handler re-prepares the unit jobs on the fresh attempt.
        """
        recovered: list[JobRecord] = []
        for child in self.store.list_jobs_by_status(ACTIVE_RECOVERY_STATUSES):
            if child.parent_job_id is None:
                continue
            parent = self.store.get_job(child.parent_job_id)
            if parent is None or not is_terminal_status(parent.status):
                continue
            recovered.append(self.store.mark_orphaned_unknown(
                child.id,
                reason=(
                    "Parent durable job is already terminal but this child unit was still "
                    "active after worker restart; manual review required before retry."
                ),
            ))
        return recovered

    def _is_stale(self, job: JobRecord) -> bool:
        if job.heartbeat_at is None:
            return True
        try:
            from datetime import datetime

            heartbeat_dt = datetime.fromisoformat(job.heartbeat_at)
            age = time.time() - heartbeat_dt.timestamp()
        except ValueError:
            return True
        return age >= self.config.stale_after_seconds

    def _recover_stale_job(self, job: JobRecord) -> JobRecord:
        provider_job_id = job.metadata.get("providerJobId") or job.result.get("providerJobId")
        provider_submission_started = bool(job.metadata.get("providerSubmissionStarted"))
        if provider_job_id:
            return self.store.mark_orphaned_unknown(
                job.id,
                reason="Provider job checkpoint exists but no resume poller is registered; manual review is required before retry.",
            )
        if provider_submission_started:
            return self.store.mark_orphaned_unknown(
                job.id,
                reason="Provider submission may have started before the worker stopped; manual review is required before retry.",
            )
        if job.metadata.get("safeToRequeue") is True:
            return self.store.requeue_job(job.id, reason="Recovered stale pre-provider job after worker restart.", allow_stale_running=True)
        return self.store.mark_orphaned_unknown(
            job.id,
            reason="Worker stopped after claiming a paid job; manual review is required before retry.",
        )

    def _recover_stale_child_jobs(self, *, parent_job_id: str, parent_status: str) -> None:
        child_jobs = self.store.list_child_jobs(parent_job_id)
        for child in child_jobs:
            if parent_status == "queued":
                if child.status not in ACTIVE_RECOVERY_STATUSES:
                    continue
                self.store.requeue_job(
                    child.id,
                    reason="Parent durable job was requeued after worker restart.",
                    allow_stale_running=True,
                )
            elif parent_status == "orphaned_unknown":
                if is_terminal_status(child.status):
                    continue
                self.store.mark_orphaned_unknown(
                    child.id,
                    reason="Parent durable job became orphaned_unknown during worker recovery.",
                )

    def _execute_job(self, job: JobRecord) -> None:
        handler = self.handlers.get(job.kind)
        if handler is None:
            self.store.requeue_job(job.id, reason=f"No handler registered for job kind {job.kind}", allow_stale_running=True)
            return
        # BUG-5 root fix (2026-08-14): cost attribution is set HERE, at the
        # dispatch chokepoint, for EVERY job — per-handler wrappers were
        # forgettable and mostly forgotten (0 tagged ledger rows all day).
        from merceka_core import costs as _mcosts

        try:
            with _mcosts.attribution({
                "app": "ftb-level-editor",
                "sessionId": job.session_id,
                "jobId": job.id,
                "operation": job.kind,
            }):
                job = self.store.update_heartbeat(job.id, owner=self.owner_id)
                result = handler(job, self.store)
            latest = self.store.get_job(job.id)
            if latest is not None and not is_terminal_status(latest.status):
                self.store.transition_job(job.id, status="succeeded", stage="succeeded", result=result or latest.result)
        except RetryableJobError as exc:
            self.store.transition_job(
                job.id,
                status="failed_retryable",
                stage="failed_retryable",
                retryable=True,
                error_code=exc.code,
                error_message=exc.message,
            )
        except TerminalJobError as exc:
            self.store.transition_job(
                job.id,
                status="failed_terminal",
                stage="failed_terminal",
                retryable=False,
                error_code=exc.code,
                error_message=exc.message,
            )
        except Exception as exc:
            logger.exception("durable job handler crashed for %s", job.id)
            self.store.transition_job(
                job.id,
                status="failed_retryable",
                stage="failed_retryable",
                retryable=True,
                error_code="unexpected_job_error",
                error_message=str(exc),
            )


_default_worker: JobWorker | None = None


def get_default_job_worker() -> JobWorker:
    global _default_worker
    if _default_worker is None:
        _default_worker = JobWorker()
    return _default_worker
