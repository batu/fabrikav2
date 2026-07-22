"""Typed human/agent HTTP actions for FTD package and sequence publishing."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..approvals import GrantRejected
from ..sessions.store import SessionNotFound, SessionRevisionConflict, SessionStore
from .level_schema import LevelFileV1, validate_level_geometry
from .sequence import (
    Candidate,
    PublishSaga,
    PublishingService,
    RemotePublicationDisabled,
    SagaStatus,
)


class CandidateResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid", from_attributes=True, populate_by_name=True
    )

    candidate_id: str = Field(alias="candidateId")
    sequence_version: str = Field(alias="sequenceVersion")
    level_ids: tuple[str, ...] = Field(alias="levelIds")
    catalog_revision: str = Field(alias="catalogRevision")
    changelog: str
    actor: str
    source_revision: str = Field(alias="sourceRevision")
    digest: str

    @classmethod
    def from_candidate(cls, candidate: Candidate) -> "CandidateResponse":
        return cls.model_validate(candidate)


class SagaResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid", from_attributes=True, populate_by_name=True
    )

    saga_id: str = Field(alias="sagaId")
    action: Literal["publish", "rollback"]
    candidate_id: str = Field(alias="candidateId")
    digest: str
    actor: str
    changelog: str
    source_revision: str = Field(alias="sourceRevision")
    status: SagaStatus
    remote: bool
    error: str | None

    @classmethod
    def from_saga(cls, saga: PublishSaga) -> "SagaResponse":
        return cls.model_validate(saga)


class PublishingSnapshotResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    selected: CandidateResponse | None
    candidates: tuple[CandidateResponse, ...]
    sagas: tuple[SagaResponse, ...]
    rollback_eligible_candidate_ids: tuple[str, ...] = Field(
        alias="rollbackEligibleCandidateIds"
    )
    remote_enabled: bool = Field(alias="remoteEnabled")


class PrepareSequenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    sequence_version: str = Field(alias="sequenceVersion")
    level_ids: tuple[str, ...] = Field(alias="levelIds")
    catalog_revision: str = Field(alias="catalogRevision")
    changelog: str
    actor: str
    source_revision: str = Field(alias="sourceRevision")


class ProtectedSequenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    candidate_id: str = Field(alias="candidateId")
    grant_id: str = Field(alias="grantId")
    remote: bool = True


class ExportDryRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    revision: str


class ExportDryRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    revision: str
    valid: bool
    level_id: str = Field(alias="levelId")
    dog_count: int = Field(alias="dogCount")


def build_publishing_router(
    service: PublishingService,
    sessions: SessionStore | None,
    dependencies: list[Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/publishing", dependencies=dependencies)

    def snapshot_response() -> PublishingSnapshotResponse:
        snapshot = service.snapshot()
        return PublishingSnapshotResponse(
            selected=(
                CandidateResponse.from_candidate(snapshot.selected)
                if snapshot.selected is not None
                else None
            ),
            candidates=tuple(
                CandidateResponse.from_candidate(candidate)
                for candidate in snapshot.candidates
            ),
            sagas=tuple(SagaResponse.from_saga(saga) for saga in snapshot.sagas),
            rollbackEligibleCandidateIds=snapshot.rollback_eligible_candidate_ids,
            remoteEnabled=snapshot.remote_enabled,
        )

    @router.get(
        "",
        operation_id="getPublishingSnapshot",
        response_model=PublishingSnapshotResponse,
        openapi_extra={
            "x-ftd-side-effects": "none",
            "x-ftd-cost": "none",
            "x-ftd-authorization": "launch-credential",
        },
    )
    def get_snapshot() -> PublishingSnapshotResponse:
        return snapshot_response()

    @router.post(
        "/previews",
        status_code=201,
        operation_id="prepareSequencePublication",
        response_model=CandidateResponse,
        openapi_extra={
            "x-ftd-side-effects": "immutable-local-preview",
            "x-ftd-cost": "none",
            "x-ftd-revision": "catalog-bound",
            "x-ftd-approval": "not-required",
        },
    )
    def prepare(body: PrepareSequenceRequest) -> CandidateResponse:
        try:
            candidate = service.prepare(
                sequence_version=body.sequence_version,
                level_ids=body.level_ids,
                catalog_revision=body.catalog_revision,
                changelog=body.changelog,
                actor=body.actor,
                source_revision=body.source_revision,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return CandidateResponse.from_candidate(candidate)

    def protected(action: str, body: ProtectedSequenceRequest) -> SagaResponse:
        try:
            saga = (
                service.activate(body.candidate_id, body.grant_id, remote=body.remote)
                if action == "publish"
                else service.rollback(body.candidate_id, body.grant_id, remote=body.remote)
            )
        except GrantRejected as error:
            raise HTTPException(status_code=403, detail=error.reason) from error
        except RemotePublicationDisabled as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail="candidate not found") from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except RuntimeError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return SagaResponse.from_saga(saga)

    protected_metadata = {
        "x-ftd-side-effects": "public-sequence-selection",
        "x-ftd-cost": "none",
        "x-ftd-revision": "digest-and-base-bound",
        "x-ftd-approval": "single-use-digest-bound",
        "x-ftd-reconciliation": "exact-remote-readback-no-blind-republish",
    }

    @router.post(
        "/activate",
        operation_id="activateSequencePublication",
        response_model=SagaResponse,
        openapi_extra=protected_metadata,
    )
    def activate(body: ProtectedSequenceRequest) -> SagaResponse:
        return protected("publish", body)

    @router.post(
        "/rollback",
        operation_id="rollbackSequencePublication",
        response_model=SagaResponse,
        openapi_extra=protected_metadata,
    )
    def rollback(body: ProtectedSequenceRequest) -> SagaResponse:
        return protected("rollback", body)

    @router.post(
        "/sagas/{saga_id}/reconcile",
        operation_id="reconcileSequencePublication",
        response_model=SagaResponse,
        openapi_extra={
            "x-ftd-side-effects": "remote-readback-and-local-finalization",
            "x-ftd-cost": "none",
            "x-ftd-reconciliation": "readback-only-no-publish",
        },
    )
    def reconcile(saga_id: str) -> SagaResponse:
        try:
            return SagaResponse.from_saga(service.reconcile(saga_id))
        except RemotePublicationDisabled as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except (FileNotFoundError, ValueError) as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @router.post(
        "/export-dry-run",
        operation_id="dryRunCurrentSessionExport",
        response_model=ExportDryRunResponse,
        openapi_extra={
            "x-ftd-side-effects": "none",
            "x-ftd-cost": "none",
            "x-ftd-revision": "bound",
            "x-ftd-artifacts": "validation-facts-only",
        },
    )
    def export_dry_run(body: ExportDryRunRequest) -> ExportDryRunResponse:
        if sessions is None:
            raise HTTPException(status_code=503, detail="session store unavailable")
        try:
            snapshot = sessions.load(body.session_id)
            if snapshot.revision != body.revision:
                raise SessionRevisionConflict(snapshot)
            level = LevelFileV1.model_validate(snapshot.session.to_mapping())
            validate_level_geometry(level)
        except SessionNotFound as error:
            raise HTTPException(status_code=404, detail="session not found") from error
        except SessionRevisionConflict as error:
            raise HTTPException(status_code=409, detail="session revision conflict") from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return ExportDryRunResponse(
            sessionId=snapshot.session_id,
            revision=snapshot.revision,
            valid=True,
            levelId=level.id,
            dogCount=len(level.dogs),
        )

    return router
