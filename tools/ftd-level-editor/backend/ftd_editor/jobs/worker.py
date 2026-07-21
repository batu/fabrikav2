"""Single-owner durable worker: execution, checkpoints, and conservative recovery."""

from __future__ import annotations

import fcntl
import os
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from types import TracebackType
from typing import Any, Self

from .models import ArtifactRecord, JobRecord
from .store import JobStore, OwnershipLost, TerminalJobImmutable, utc_now_iso


class JobError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class RetryableJobError(JobError):
    pass


class TerminalJobError(JobError):
    pass


class JobCancelled(Exception):
    pass


class ApplicationConflict(Exception):
    """Raised by a handler when revision-bound application lost the CAS race."""

    def __init__(self, result: dict[str, Any] | None = None) -> None:
        super().__init__("job output application conflicted with a newer session revision")
        self.result = result or {}


class WorkerOwnershipLock:
    """Non-blocking process lock keeping exactly one local worker owner alive."""

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
            raise RuntimeError(f"could not acquire worker ownership lock: {self.lock_path}")
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.release()


@dataclass(slots=True)
class JobContext:
    """Everything one handler may touch; every checkpoint is durable."""

    job: JobRecord
    store: JobStore
    owner_id: str
    providers: Any
    register_artifact: Callable[..., ArtifactRecord]

    def heartbeat(self) -> None:
        self.job = self.store.heartbeat(self.job.id, owner=self.owner_id)

    def record_submission_intent(self) -> None:
        self.job = self.store.record_submission_intent(self.job.id, owner=self.owner_id)

    def record_provider_job_id(self, provider_job_id: str) -> None:
        self.job = self.store.record_provider_job_id(
            self.job.id, provider_job_id, owner=self.owner_id
        )

    def set_stage(self, status: str, *, stage: str | None = None) -> None:
        self.job = self.store.transition_job(
            self.job.id, status=status, stage=stage, worker_owner=self.owner_id
        )

    def cancel_requested(self) -> bool:
        return self.store.get_job(self.job.id).status == "cancel_requested"

    def raise_if_cancel_requested(self) -> None:
        if self.cancel_requested():
            raise JobCancelled()


JobHandler = Callable[[JobContext], dict[str, Any] | None]
ResumeHandler = Callable[[JobContext, str], dict[str, Any] | None]


@dataclass(slots=True)
class DurableJobWorker:
    """The one in-process owner of durable job execution and recovery.

    It is a tool: `run_once` performs at most one unit of work and returns.
    """

    store: JobStore
    handlers: Mapping[str, JobHandler]
    register_artifact: Callable[..., ArtifactRecord]
    lock_path: Path
    providers: Any = None
    resume_handlers: Mapping[str, ResumeHandler] = field(default_factory=dict)
    owner_id: str = ""
    now: Callable[[], str] = utc_now_iso
    stale_after_seconds: float = 60.0
    mode: str = "durable"
    _ownership: WorkerOwnershipLock = field(init=False, repr=False, default=None)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if not self.owner_id:
            self.owner_id = f"worker-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        self._ownership = WorkerOwnershipLock(self.lock_path)

    def acquire_ownership(self) -> bool:
        return self._ownership.acquire()

    def release_ownership(self) -> None:
        self._ownership.release()

    def step(self) -> bool:
        return self.run_once()

    def run_once(self) -> bool:
        job = self.store.claim_next_queued(
            owner=self.owner_id, kinds=tuple(self.handlers.keys())
        )
        if job is None:
            job = self._claim_resumable()
        if job is None:
            return False
        self._execute(job)
        return True

    def _claim_resumable(self) -> JobRecord | None:
        for job in self.store.list_jobs(statuses=("polling",)):
            if job.worker_owner == self.owner_id:
                return job
        return None

    # -- execution -----------------------------------------------------------

    def _execute(self, job: JobRecord) -> None:
        context = JobContext(
            job=job,
            store=self.store,
            owner_id=self.owner_id,
            providers=self.providers,
            register_artifact=self.register_artifact,
        )
        try:
            if job.status == "polling":
                provider_job_id = job.metadata.get("providerJobId")
                resume = self.resume_handlers.get(job.kind)
                if resume is None or not provider_job_id:
                    self._orphan(job, "no resume path for a checkpointed provider job")
                    return
                result = resume(context, str(provider_job_id))
            else:
                handler = self.handlers.get(job.kind)
                if handler is None:
                    self._finish(
                        job.id,
                        status="failed_terminal",
                        error_code="unregistered_job_kind",
                        error_message=f"no handler is registered for kind {job.kind!r}",
                    )
                    return
                result = handler(context)
            self._succeed(context, result)
        except JobCancelled:
            self._finish(job.id, status="cancelled", stage="cancelled")
        except ApplicationConflict as conflict:
            result = dict(conflict.result)
            result["application"] = "conflict"
            self._finish(job.id, status="succeeded", result=result)
        except RetryableJobError as error:
            self._finish(
                job.id,
                status="failed_retryable",
                retryable=True,
                error_code=error.code,
                error_message=error.message,
            )
        except TerminalJobError as error:
            self._finish(
                job.id,
                status="failed_terminal",
                error_code=error.code,
                error_message=error.message,
            )
        except OwnershipLost:
            self.store.append_event(
                job.id,
                "job.ownership_lost",
                message="a fenced write was rejected; another owner holds this job",
            )
        except Exception as error:  # crash containment: the ledger stays consistent
            latest = self.store.get_job(job.id)
            if latest.metadata.get("providerSubmissionStarted") and not (
                latest.metadata.get("providerJobId") and latest.kind in self.resume_handlers
            ):
                # Ambiguous spend: intent exists without a resumable identity.
                # Never reclassify to retryable — that would allow a grant-free
                # resubmission and a duplicate provider spend.
                self._orphan(
                    latest,
                    "unexpected error after submission intent without a resumable "
                    "provider identity; force-new authority is required",
                )
                return
            self._finish(
                job.id,
                status="failed_retryable",
                retryable=True,
                error_code="unexpected_job_error",
                error_message=str(error),
            )

    def _succeed(self, context: JobContext, result: dict[str, Any] | None) -> None:
        self.store.complete_success(context.job.id, result=result, owner=self.owner_id)

    def _finish(self, job_id: str, **kwargs: Any) -> None:
        try:
            self.store.transition_job(
                job_id,
                worker_owner=self.owner_id,
                expect_owner=self.owner_id,
                **kwargs,
            )
        except TerminalJobImmutable:
            self.store.append_event(
                job_id,
                "job.late_transition_rejected",
                data={"attempted": str(kwargs.get("status"))},
            )
        except OwnershipLost:
            self.store.append_event(
                job_id,
                "job.ownership_lost",
                message="a fenced write was rejected; another owner holds this job",
            )

    def _orphan(self, job: JobRecord, reason: str) -> JobRecord:
        try:
            return self.store.transition_job(
                job.id,
                status="orphaned_unknown",
                stage="orphaned_unknown",
                error_code="orphaned_unknown",
                error_message=reason,
            )
        except TerminalJobImmutable:
            return self.store.get_job(job.id)

    # -- recovery ------------------------------------------------------------

    def recover(self) -> list[JobRecord]:
        """Startup reconciliation: conservative per R18, never a duplicate spend."""

        reconciled: list[JobRecord] = []
        for job in self.store.list_active_jobs():
            if job.status == "queued":
                continue
            reconciled.append(self._reconcile(job))
        return reconciled

    def sweep_stale(self) -> list[JobRecord]:
        """Periodic stale-owner takeover using the injected deterministic clock."""

        cutoff = datetime.fromisoformat(self.now())
        swept: list[JobRecord] = []
        for job in self.store.list_active_jobs():
            if job.status == "queued" or job.worker_owner == self.owner_id:
                continue
            if job.heartbeat_at is not None:
                age = (cutoff - datetime.fromisoformat(job.heartbeat_at)).total_seconds()
                if age < self.stale_after_seconds:
                    continue
            swept.append(self._reconcile(job))
        return swept

    def _reconcile(self, job: JobRecord) -> JobRecord:
        provider_job_id = job.metadata.get("providerJobId")
        submission_started = bool(job.metadata.get("providerSubmissionStarted"))
        if job.status == "cancel_requested":
            return self.store.transition_job(job.id, status="cancelled", stage="cancelled")
        if provider_job_id and job.kind in self.resume_handlers:
            return self.store.transition_job(
                job.id,
                status="polling",
                stage="resume_polling",
                worker_owner=self.owner_id,
                heartbeat_at=self.now(),
            )
        if submission_started:
            return self._orphan(
                job,
                "submission intent exists without a resumable provider identity; "
                "force-new authority is required before any resubmission",
            )
        return self.store.requeue_pre_side_effect(
            job.id, reason="recovered before submission intent; safe to run once"
        )
