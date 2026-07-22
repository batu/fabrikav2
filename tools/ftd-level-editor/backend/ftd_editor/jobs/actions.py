"""Named FTD durable-action routes: start, inspect, cancel, retry, force-new."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from ..approvals import ApprovalStore, GrantRejected
from ..artifacts import ArtifactNotFound, ArtifactStore
from ..sessions.routes import SessionRevisionConflictDetail, SessionSnapshotResponse
from ..sessions.store import SessionNotFound, SessionRevisionConflict, SessionStore
from .models import ExecutionSpec, JobRecord
from .store import (
    AttemptNotAllowed,
    JobNotFound,
    JobStore,
    RequestIdentityConflict,
)


@dataclass(frozen=True, slots=True)
class FtdActionKind:
    """One server-registered FTD action; recipe/policy versions are server-owned."""

    kind: str
    recipe_version: str
    policy_version: str


# The durable FTD actions this editor understands. Later units register their
# paid handlers against these exact names; callers can never invent a kind.
# The U5 rows are the already-durable legacy starts (background generation,
# crop inpaint, retry-failed-dogs, band generation, sequence workflow,
# multi-scene generation) whose SSE/shadow observation moved to Job + events.
FTD_ACTION_KINDS: tuple[FtdActionKind, ...] = (
    FtdActionKind("ftd.dog_variant_upscale", "upscale-r1", "spend-p1"),
    FtdActionKind("ftd.background_generate", "background-r1", "spend-p1"),
    FtdActionKind("ftd.sprite_animate", "sprite-r1", "spend-p1"),
    FtdActionKind("ftd.crop_inpaint", "crop-inpaint-r1", "spend-p1"),
    FtdActionKind("ftd.retry_failed_dogs", "retry-dogs-r1", "spend-p1"),
    FtdActionKind("ftd.band_generate", "band-r1", "spend-p1"),
    FtdActionKind("ftd.sequence_workflow", "sequence-r1", "spend-p1"),
    FtdActionKind("ftd.multi_scene_generate", "multi-scene-r1", "spend-p1"),
    # U6: the last two request-owned v1 paid actions (GET+SSE magenta inpaint
    # and POST single-dog regeneration) gain durable kinds of their own.
    FtdActionKind("ftd.magenta_inpaint", "magenta-r1", "spend-p1"),
    FtdActionKind("ftd.dog_regenerate", "dog-regen-r1", "spend-p1"),
)


class StartJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    request_id: str = Field(alias="requestId", min_length=8, max_length=128)
    session_id: str = Field(alias="sessionId")
    revision: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    provider_options: dict[str, Any] = Field(alias="providerOptions", default_factory=dict)


class ForceNewJobRequest(StartJobRequest):
    grant_id: str = Field(alias="grantId")
    actor: str


class MintApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    actor: str
    action_kind: str = Field(alias="actionKind")
    request_binding: str = Field(alias="requestBinding")
    source_revision: str = Field(alias="sourceRevision")
    acknowledgement: str


class ApprovalGrantResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    grant_id: str = Field(alias="grantId")
    actor: str
    action_kind: str = Field(alias="actionKind")
    request_binding: str = Field(alias="requestBinding")
    source_revision: str = Field(alias="sourceRevision")
    expires_at: str = Field(alias="expiresAt")


class JobErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str | None


class ArtifactReferenceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    artifact_id: str = Field(alias="artifactId")
    display_name: str = Field(alias="displayName")
    media_type: str = Field(alias="mediaType")
    checksum: str
    size: int


class JobAttemptResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    reason: Literal["initial", "retry", "force_new"]
    previous_attempt_id: str | None = Field(alias="previousAttemptId")
    superseded_by: str | None = Field(alias="supersededBy")


class JobResource(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    job_id: str = Field(alias="jobId")
    kind: str
    session_id: str = Field(alias="sessionId")
    request_id: str | None = Field(alias="requestId")
    input_hash: str = Field(alias="inputHash")
    status: str
    stage: str
    retryable: bool
    error: JobErrorResponse | None
    result: dict[str, Any]
    attempt: JobAttemptResponse
    artifacts: list[ArtifactReferenceResponse]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    completed_at: str | None = Field(alias="completedAt")


class JobEventResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: int
    event_type: str = Field(alias="eventType")
    message: str | None
    data: dict[str, Any]
    created_at: str = Field(alias="createdAt")


class RequestIdentityConflictDetail(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    code: Literal["request_identity_conflict"]
    existing_job_id: str = Field(alias="existingJobId")
    existing_input_hash: str = Field(alias="existingInputHash")
    submitted_input_hash: str = Field(alias="submittedInputHash")


class StartJobConflictResponse(BaseModel):
    """Wire shape of every 409 a durable start/force-new route can emit."""

    model_config = ConfigDict(extra="forbid")

    detail: RequestIdentityConflictDetail | SessionRevisionConflictDetail | str


_START_CONFLICT_RESPONSES = {409: {"model": StartJobConflictResponse}}


class JobService:
    """Deterministic action-layer orchestration over the durable stores."""

    def __init__(
        self,
        *,
        jobs: JobStore,
        approvals: ApprovalStore,
        artifacts: ArtifactStore,
        sessions: SessionStore | None,
        action_kinds: tuple[FtdActionKind, ...] = FTD_ACTION_KINDS,
    ) -> None:
        self.jobs = jobs
        self.approvals = approvals
        self.artifacts = artifacts
        self.sessions = sessions
        self.action_kinds: Mapping[str, FtdActionKind] = {
            action.kind: action for action in action_kinds
        }

    def build_spec(self, kind: str, body: StartJobRequest) -> ExecutionSpec:
        action = self.action_kinds.get(kind)
        if action is None:
            raise KeyError(kind)
        source_hashes: dict[str, str] = {}
        if self.sessions is not None:
            snapshot = self.sessions.load(body.session_id)
            if snapshot.revision != body.revision:
                raise SessionRevisionConflict(snapshot)
            source_hashes["session.json"] = snapshot.provenance.session_sha256
        return ExecutionSpec(
            kind=kind,
            session_id=body.session_id,
            source_revision=body.revision,
            inputs=body.inputs,
            recipe_version=action.recipe_version,
            policy_version=action.policy_version,
            provider_options=body.provider_options,
            source_hashes=source_hashes,
            target_reservation=f"session:{body.session_id}",
        )

    def start(self, kind: str, body: StartJobRequest) -> tuple[JobRecord, bool]:
        # Replay attachment must win before session-revision validation: a job
        # that already applied its output moved the session revision, and the
        # caller replaying a lost response still carries the original one.
        existing = self.jobs.find_by_request_id(kind, body.request_id)
        if existing is not None:
            stored = existing.execution_spec
            if (
                stored.get("sessionId") == body.session_id
                and stored.get("sourceRevision") == body.revision
                and stored.get("inputs") == body.inputs
                and stored.get("providerOptions") == body.provider_options
            ):
                return existing, False
        spec = self.build_spec(kind, body)
        return self.jobs.start_job(spec, request_id=body.request_id, reuse=True)

    def force_new(self, kind: str, job_id: str, body: ForceNewJobRequest) -> JobRecord:
        spec = self.build_spec(kind, body)
        original = self.jobs.get_job(job_id)
        consume = self.approvals.consumer(
            grant_id=body.grant_id,
            actor=body.actor,
            action_kind=f"force_new:{kind}",
            request_binding=f"job:{original.id}",
            source_revision=body.revision,
        )
        return self.jobs.force_new(
            job_id, spec, new_request_id=body.request_id, consume_grant=consume
        )

    def resource(self, job: JobRecord) -> JobResource:
        return JobResource(
            jobId=job.id,
            kind=job.kind,
            sessionId=job.session_id,
            requestId=job.request_id,
            inputHash=job.input_hash,
            status=job.status,
            stage=job.stage,
            retryable=job.retryable,
            error=(
                JobErrorResponse(code=job.error_code, message=job.error_message)
                if job.error_code
                else None
            ),
            result=job.result,
            attempt=JobAttemptResponse(
                reason=job.attempt_reason,  # type: ignore[arg-type]
                previousAttemptId=job.previous_attempt_id,
                supersededBy=job.superseded_by,
            ),
            artifacts=[
                ArtifactReferenceResponse(
                    artifactId=artifact.artifact_id,
                    displayName=artifact.display_name,
                    mediaType=artifact.media_type,
                    checksum=artifact.checksum,
                    size=artifact.size,
                )
                for artifact in self.jobs.list_artifacts(job.id)
            ],
            createdAt=job.created_at,
            updatedAt=job.updated_at,
            completedAt=job.completed_at,
        )


def build_job_router(service: JobService, dependencies: list[Any]) -> APIRouter:
    router = APIRouter(prefix="/api", dependencies=dependencies)
    durable_extra = {
        "x-ftd-durability": "durable-job",
        "x-ftd-cost": "provider-spend",
        "x-ftd-authorization": "launch-credential",
        "x-ftd-side-effects": "provider-submission",
    }

    def job_or_404(job_id: str) -> JobRecord:
        try:
            return service.jobs.get_job(job_id)
        except JobNotFound as error:
            raise HTTPException(status_code=404, detail="job not found") from error

    def identity_conflict(error: RequestIdentityConflict) -> HTTPException:
        return HTTPException(
            status_code=409,
            detail=RequestIdentityConflictDetail(
                code="request_identity_conflict",
                existingJobId=error.existing.id,
                existingInputHash=error.existing.input_hash,
                submittedInputHash=error.submitted_hash,
            ).model_dump(by_alias=True),
        )

    def guard_start(action: Any) -> Any:
        try:
            return action()
        except KeyError as error:
            raise HTTPException(
                status_code=404, detail="unknown FTD action kind"
            ) from error
        except RequestIdentityConflict as error:
            raise identity_conflict(error) from error
        except SessionRevisionConflict as error:
            raise HTTPException(
                status_code=409,
                detail=SessionRevisionConflictDetail(
                    code="session_revision_conflict",
                    current=SessionSnapshotResponse.from_snapshot(error.current),
                ).model_dump(by_alias=True),
            ) from error
        except SessionNotFound as error:
            raise HTTPException(status_code=404, detail="session not found") from error

    @router.post(
        "/jobs/actions/{kind}",
        operation_id="startFtdDurableAction",
        response_model=JobResource,
        responses=_START_CONFLICT_RESPONSES,
        openapi_extra={**durable_extra, "x-ftd-revision": "bound"},
    )
    def start_ftd_durable_action(kind: str, body: StartJobRequest) -> JobResource:
        job, _created = guard_start(lambda: service.start(kind, body))
        return service.resource(job)

    @router.get(
        "/jobs/{job_id}",
        operation_id="getDurableJob",
        response_model=JobResource,
        openapi_extra={"x-ftd-side-effects": "none", "x-ftd-cost": "none"},
    )
    def get_durable_job(job_id: str) -> JobResource:
        return service.resource(job_or_404(job_id))

    @router.get(
        "/jobs",
        operation_id="listDurableJobs",
        response_model=list[JobResource],
        openapi_extra={"x-ftd-side-effects": "none", "x-ftd-cost": "none"},
    )
    def list_durable_jobs(
        sessionId: str | None = None,
        requestId: str | None = None,
        kind: str | None = None,
    ) -> list[JobResource]:
        if requestId is not None:
            kinds = [kind] if kind else list(service.action_kinds)
            found = [
                job
                for job in (
                    service.jobs.find_by_request_id(each, requestId) for each in kinds
                )
                if job is not None
            ]
            return [service.resource(job) for job in found]
        return [
            service.resource(job)
            for job in service.jobs.list_jobs(session_id=sessionId)
            if kind is None or job.kind == kind
        ]

    @router.get(
        "/jobs/{job_id}/events",
        operation_id="listDurableJobEvents",
        response_model=list[JobEventResponse],
        openapi_extra={"x-ftd-side-effects": "none", "x-ftd-cost": "none"},
    )
    def list_durable_job_events(job_id: str, after: int = 0) -> list[JobEventResponse]:
        job_or_404(job_id)
        return [
            JobEventResponse(
                id=event.id,
                eventType=event.event_type,
                message=event.message,
                data=event.data,
                createdAt=event.created_at,
            )
            for event in service.jobs.list_events(job_id, after_id=after)
        ]

    @router.post(
        "/jobs/{job_id}/cancel",
        operation_id="cancelDurableJob",
        response_model=JobResource,
        openapi_extra={"x-ftd-side-effects": "job-cancellation", "x-ftd-cost": "none"},
    )
    def cancel_durable_job(job_id: str) -> JobResource:
        job_or_404(job_id)
        return service.resource(service.jobs.request_cancel(job_id))

    @router.post(
        "/jobs/{job_id}/retry",
        operation_id="retryDurableJob",
        response_model=JobResource,
        openapi_extra=durable_extra,
    )
    def retry_durable_job(job_id: str) -> JobResource:
        job_or_404(job_id)
        try:
            return service.resource(service.jobs.retry(job_id))
        except AttemptNotAllowed as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @router.post(
        "/jobs/{job_id}/force-new/{kind}",
        operation_id="forceNewDurableJob",
        response_model=JobResource,
        responses=_START_CONFLICT_RESPONSES,
        openapi_extra={**durable_extra, "x-ftd-approval": "single-use-grant"},
    )
    def force_new_durable_job(job_id: str, kind: str, body: ForceNewJobRequest) -> JobResource:
        job_or_404(job_id)
        try:
            return service.resource(guard_start(lambda: service.force_new(kind, job_id, body)))
        except GrantRejected as error:
            raise HTTPException(status_code=403, detail=error.reason) from error
        except AttemptNotAllowed as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @router.post(
        "/approvals",
        operation_id="mintApprovalGrant",
        response_model=ApprovalGrantResponse,
        status_code=201,
        openapi_extra={
            # Honest label: the gate is an exact server-derived acknowledgement
            # from a credentialed caller, not proof of a human. A genuinely
            # human gate needs a distinct approval credential (deferred to the
            # unit that owns the human-facing approval surface).
            "x-ftd-authorization": "deliberate-intent-acknowledgement",
            "x-ftd-side-effects": "grant-minting",
            "x-ftd-cost": "none",
        },
    )
    def mint_approval_grant(body: MintApprovalRequest) -> ApprovalGrantResponse:
        try:
            grant = service.approvals.mint(
                actor=body.actor,
                action_kind=body.action_kind,
                request_binding=body.request_binding,
                source_revision=body.source_revision,
                acknowledgement=body.acknowledgement,
            )
        except GrantRejected as error:
            raise HTTPException(status_code=403, detail=error.reason) from error
        return ApprovalGrantResponse(
            grantId=grant.grant_id,
            actor=grant.actor,
            actionKind=grant.action_kind,
            requestBinding=grant.request_binding,
            sourceRevision=grant.source_revision,
            expiresAt=grant.expires_at,
        )

    @router.get(
        "/jobs/{job_id}/artifacts/{artifact_id}",
        operation_id="downloadDurableJobArtifact",
        response_class=Response,
        openapi_extra={
            "x-ftd-side-effects": "none",
            "x-ftd-cost": "none",
            "x-ftd-artifacts": "opaque-download",
        },
    )
    def download_durable_job_artifact(job_id: str, artifact_id: str) -> Response:
        job_or_404(job_id)
        try:
            resolved = service.artifacts.resolve_download(job_id, artifact_id)
        except ArtifactNotFound as error:
            raise HTTPException(status_code=404, detail="artifact not found") from error
        return Response(
            content=resolved.content,
            media_type=resolved.record.media_type,
            headers={
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": (
                    f'attachment; filename="{resolved.record.display_name}"'
                ),
            },
        )

    return router
