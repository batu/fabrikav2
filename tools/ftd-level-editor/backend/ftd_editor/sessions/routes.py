"""Thin named HTTP actions over the FTD SessionStore."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .dogs import StableDogNotFound
from .store import (
    SessionAlreadyExists,
    SessionNotFound,
    SessionRevisionConflict,
    SessionSnapshot,
    SessionStore,
)


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session: dict[str, Any]


class RevisionedAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str


class SetDogActiveVariantRequest(RevisionedAction):
    active_variant: int | None = Field(alias="activeVariant")


class UpdateGalleryMetadataRequest(RevisionedAction):
    tags: list[str] | None = None
    archived: bool | None = None


class SessionProvenanceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    session_sha256: str
    file_count: int


class SessionSnapshotResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    revision: str
    session: dict[str, Any]
    provenance: SessionProvenanceResponse

    @classmethod
    def from_snapshot(cls, snapshot: SessionSnapshot) -> "SessionSnapshotResponse":
        return cls(
            sessionId=snapshot.session_id,
            revision=snapshot.revision,
            session=snapshot.session.to_mapping(),
            provenance=SessionProvenanceResponse(
                source=snapshot.provenance.source,
                session_sha256=snapshot.provenance.session_sha256,
                file_count=snapshot.provenance.file_count,
            ),
        )


class GallerySessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    session_id: str
    revision: str
    dog_count: int
    tags: tuple[str, ...]
    archived: bool


def build_session_router(store: SessionStore, dependencies: list[Any]) -> APIRouter:
    router = APIRouter(prefix="/api/sessions", dependencies=dependencies)

    @router.get(
        "",
        operation_id="listCurrentSessions",
        response_model=list[GallerySessionResponse],
    )
    def list_current_sessions() -> list[GallerySessionResponse]:
        return [
            GallerySessionResponse.model_validate(item)
            for item in store.list_gallery()
        ]

    @router.post(
        "",
        status_code=201,
        operation_id="createCurrentSession",
        response_model=SessionSnapshotResponse,
    )
    def create_current_session(body: CreateSessionRequest) -> SessionSnapshotResponse:
        try:
            return SessionSnapshotResponse.from_snapshot(store.create(body.session))
        except SessionAlreadyExists as error:
            raise HTTPException(
                status_code=409,
                detail="session destination already exists",
            ) from error

    @router.get(
        "/{session_id}",
        operation_id="getCurrentSession",
        response_model=SessionSnapshotResponse,
    )
    def get_current_session(session_id: str) -> SessionSnapshotResponse:
        try:
            return SessionSnapshotResponse.from_snapshot(store.load(session_id))
        except SessionNotFound as error:
            raise HTTPException(status_code=404, detail="session not found") from error

    def apply(action: Any) -> SessionSnapshotResponse:
        try:
            return SessionSnapshotResponse.from_snapshot(action())
        except SessionRevisionConflict as error:
            current = SessionSnapshotResponse.from_snapshot(error.current)
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "session_revision_conflict",
                    "current": current.model_dump(by_alias=True),
                },
            ) from error
        except StableDogNotFound as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.post(
        "/{session_id}/dogs/{dog_id}/active-variant",
        operation_id="setCurrentSessionDogActiveVariant",
        response_model=SessionSnapshotResponse,
    )
    def set_current_session_dog_active_variant(
        session_id: str, dog_id: str, body: SetDogActiveVariantRequest
    ) -> SessionSnapshotResponse:
        return apply(
            lambda: store.set_dog_active_variant(
                session_id,
                dog_id,
                body.active_variant,
                expected_revision=body.revision,
            )
        )

    @router.post(
        "/{session_id}/gallery-metadata",
        operation_id="updateCurrentSessionGalleryMetadata",
        response_model=SessionSnapshotResponse,
    )
    def update_current_session_gallery_metadata(
        session_id: str, body: UpdateGalleryMetadataRequest
    ) -> SessionSnapshotResponse:
        return apply(
            lambda: store.set_gallery_metadata(
                session_id,
                expected_revision=body.revision,
                tags=body.tags,
                archived=body.archived,
            )
        )

    return router
