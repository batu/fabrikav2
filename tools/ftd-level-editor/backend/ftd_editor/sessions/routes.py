"""Thin named HTTP actions over the FTD SessionStore."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from .dogs import StableDogNotFound
from .gallery import CaptureVariant
from .model import AuthoringSession
from .store import (
    SessionAlreadyExists,
    SessionCommitIndeterminate,
    SessionImageNotFound,
    SessionNotFound,
    SessionReadError,
    SessionRevisionConflict,
    SessionSnapshot,
    SessionStore,
)


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session: AuthoringSession


class RevisionedAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str


class SetDogActiveVariantRequest(RevisionedAction):
    active_variant: int | None = Field(alias="activeVariant")


class UpdateGalleryMetadataRequest(RevisionedAction):
    tags: list[str] | None = None
    archived: bool | None = None


class CaptureSessionImageRequest(RevisionedAction):
    variant: CaptureVariant = "gemini"


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


class SessionRevisionConflictDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Literal["session_revision_conflict"]
    current: SessionSnapshotResponse


class SessionRevisionConflictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: SessionRevisionConflictDetail


class SessionUnavailableResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str


class SessionImageNotFoundResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: Literal["session image not found"]


_UNAVAILABLE_RESPONSE = {503: {"model": SessionUnavailableResponse}}

_CAPTURE_HEADERS = {
    name: {
        "description": description,
        "schema": {"type": "string"},
    }
    for name, description in {
        "X-FTD-Session-Id": "Captured authoring session identity.",
        "X-FTD-Session-Revision": "Exact session revision captured.",
        "X-FTD-Image-Source": "Session-relative v1-compatible source filename.",
        "X-FTD-Image-SHA256": "SHA-256 digest of the returned image bytes.",
    }.items()
}


def build_session_router(store: SessionStore, dependencies: list[Any]) -> APIRouter:
    router = APIRouter(prefix="/api/sessions", dependencies=dependencies)

    def unavailable(error: SessionReadError) -> HTTPException:
        return HTTPException(status_code=503, detail="session storage unavailable")

    @router.get(
        "",
        operation_id="listCurrentSessions",
        response_model=list[GallerySessionResponse],
        responses=_UNAVAILABLE_RESPONSE,
        openapi_extra={"x-ftd-side-effects": "none", "x-ftd-cost": "none"},
    )
    def list_current_sessions() -> list[GallerySessionResponse]:
        try:
            return [
                GallerySessionResponse.model_validate(item)
                for item in store.list_gallery()
            ]
        except SessionReadError as error:
            raise unavailable(error) from error

    @router.post(
        "",
        status_code=201,
        operation_id="createCurrentSession",
        response_model=SessionSnapshotResponse,
        responses=_UNAVAILABLE_RESPONSE,
        openapi_extra={"x-ftd-side-effects": "session-mutation", "x-ftd-cost": "none"},
    )
    def create_current_session(body: CreateSessionRequest) -> SessionSnapshotResponse:
        try:
            return SessionSnapshotResponse.from_snapshot(store.create(body.session))
        except SessionAlreadyExists as error:
            raise HTTPException(
                status_code=409,
                detail="session destination already exists",
            ) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except SessionReadError as error:
            raise unavailable(error) from error
        except SessionCommitIndeterminate as error:
            raise HTTPException(
                status_code=503,
                detail="session commit outcome indeterminate",
            ) from error

    @router.get(
        "/{session_id}",
        operation_id="getCurrentSession",
        response_model=SessionSnapshotResponse,
        responses=_UNAVAILABLE_RESPONSE,
        openapi_extra={"x-ftd-side-effects": "none", "x-ftd-cost": "none"},
    )
    def get_current_session(session_id: str) -> SessionSnapshotResponse:
        try:
            return SessionSnapshotResponse.from_snapshot(store.load(session_id))
        except SessionNotFound as error:
            raise HTTPException(status_code=404, detail="session not found") from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except SessionReadError as error:
            raise unavailable(error) from error

    def revision_conflict(error: SessionRevisionConflict) -> HTTPException:
        current = SessionSnapshotResponse.from_snapshot(error.current)
        return HTTPException(
            status_code=409,
            detail=SessionRevisionConflictDetail(
                code="session_revision_conflict",
                current=current,
            ).model_dump(by_alias=True),
        )

    def apply(action: Any) -> SessionSnapshotResponse:
        try:
            return SessionSnapshotResponse.from_snapshot(action())
        except SessionRevisionConflict as error:
            raise revision_conflict(error) from error
        except SessionNotFound as error:
            raise HTTPException(status_code=404, detail="session not found") from error
        except StableDogNotFound as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except SessionReadError as error:
            raise unavailable(error) from error
        except SessionCommitIndeterminate as error:
            raise HTTPException(
                status_code=503,
                detail="session commit outcome indeterminate",
            ) from error

    @router.post(
        "/{session_id}/dogs/{dog_id}/active-variant",
        operation_id="setCurrentSessionDogActiveVariant",
        response_model=SessionSnapshotResponse,
        responses={
            409: {"model": SessionRevisionConflictResponse},
            **_UNAVAILABLE_RESPONSE,
        },
        openapi_extra={
            "x-ftd-side-effects": "session-mutation",
            "x-ftd-cost": "none",
            "x-ftd-revision": "bound",
        },
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
        responses={
            409: {"model": SessionRevisionConflictResponse},
            **_UNAVAILABLE_RESPONSE,
        },
        openapi_extra={
            "x-ftd-side-effects": "session-mutation",
            "x-ftd-cost": "none",
            "x-ftd-revision": "bound",
        },
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

    @router.post(
        "/{session_id}/capture",
        operation_id="captureCurrentSessionImage",
        response_class=Response,
        responses={
            200: {
                "description": "Revision-bound current authoring image bytes.",
                "content": {
                    "image/png": {
                        "schema": {"type": "string", "format": "binary"}
                    }
                },
                "headers": _CAPTURE_HEADERS,
            },
            404: {"model": SessionImageNotFoundResponse},
            409: {"model": SessionRevisionConflictResponse},
            **_UNAVAILABLE_RESPONSE,
        },
        openapi_extra={
            "x-ftd-side-effects": "none",
            "x-ftd-cost": "none",
            "x-ftd-revision": "bound",
            "x-ftd-artifacts": "inline-image",
            "x-ftd-authorization": "launch-credential",
        },
    )
    def capture_current_session_image(
        session_id: str, body: CaptureSessionImageRequest
    ) -> Response:
        try:
            capture = store.capture_image(
                session_id,
                expected_revision=body.revision,
                variant=body.variant,
            )
        except SessionRevisionConflict as error:
            raise revision_conflict(error) from error
        except (SessionNotFound, SessionImageNotFound) as error:
            raise HTTPException(status_code=404, detail="session image not found") from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except SessionReadError as error:
            raise unavailable(error) from error
        return Response(
            content=capture.content,
            media_type=capture.media_type,
            headers={
                "X-FTD-Session-Id": capture.session_id,
                "X-FTD-Session-Revision": capture.revision,
                "X-FTD-Image-Source": capture.source,
                "X-FTD-Image-SHA256": capture.sha256,
                "ETag": f'"{capture.sha256}"',
                "Cache-Control": "private, no-store",
            },
        )

    return router
