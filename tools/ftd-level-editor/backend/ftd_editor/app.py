"""FastAPI composition boundary for the Find the Dog editor."""

from __future__ import annotations

import logging
import secrets as secrets_module
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from fastapi import FastAPI, Request, Security
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

from .security import (
    LAUNCH_CREDENTIAL_HEADER,
    LocalRequestGuardMiddleware,
    SecretBoundaryMiddleware,
    SecretRedactionFilter,
    SecretRedactor,
)
from .jobs.actions import JobService
from .settings import EditorSettings
from .sessions.store import SessionStore

if TYPE_CHECKING:
    from .publishing.sequence import PublishingService


class FailClosedProviderError(RuntimeError):
    pass


class Worker(Protocol):
    mode: str

    def step(self) -> bool: ...


class ProviderRegistry(Protocol):
    mode: str

    def require(self, name: str) -> Any: ...


class StoreRegistry(Protocol):
    @property
    def sessions(self) -> SessionStore | None: ...

    @property
    def jobs(self) -> JobService | None: ...

    @property
    def publishing(self) -> "PublishingService | None": ...

    def names(self) -> tuple[str, ...]: ...


@dataclass(slots=True)
class ManualWorker:
    """A test/development worker controlled one explicit step at a time."""

    _steps: list[Callable[[], None]] = field(default_factory=list)
    mode: str = "manual"

    def enqueue(self, callback: Callable[[], None]) -> None:
        self._steps.append(callback)

    def step(self) -> bool:
        if not self._steps:
            return False
        self._steps.pop(0)()
        return True


@dataclass(frozen=True, slots=True)
class FailClosedProviders:
    """Provider registry used unless a scripted adapter is explicitly installed."""

    scripted: Mapping[str, Any] = field(default_factory=dict)
    mode: str = "fail-closed"

    def require(self, name: str) -> Any:
        try:
            return self.scripted[name]
        except KeyError as error:
            raise FailClosedProviderError(
                f"provider {name!r} requires an explicitly installed scripted provider"
            ) from error


@dataclass(frozen=True, slots=True)
class EditorStores:
    """Explicit composition root for editor-owned persistence authorities."""

    sessions: SessionStore | None = None
    jobs: JobService | None = None
    publishing: "PublishingService | None" = None

    def names(self) -> tuple[str, ...]:
        names: list[str] = []
        if self.sessions is not None:
            names.append("sessions")
        if self.jobs is not None:
            names.append("jobs")
        if self.publishing is not None:
            names.append("publishing")
        return tuple(names)


@dataclass(frozen=True, slots=True)
class AppComponents:
    stores: StoreRegistry
    worker: Worker
    providers: ProviderRegistry
    redactor: SecretRedactor
    human_approval_credential: str | None = None


class EditorStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service: str
    providerMode: str
    workerMode: str
    stores: tuple[str, ...]


class BootstrapResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    launchCredential: str


def create_app(settings: EditorSettings, components: AppComponents) -> FastAPI:
    """Compose one provider-free editor app from explicit startup dependencies."""

    settings.validate(require_disposable_root=settings.environment != "production")
    launch_credential = secrets_module.token_urlsafe(32)
    runtime_logger = logging.getLogger("ftd_editor.runtime")
    server_logger = logging.getLogger("uvicorn.error")
    redaction_filter = SecretRedactionFilter(components.redactor)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        runtime_logger.addFilter(redaction_filter)
        server_logger.addFilter(redaction_filter)
        try:
            settings.workspace.approve_filesystems()
            yield
        finally:
            server_logger.removeFilter(redaction_filter)
            runtime_logger.removeFilter(redaction_filter)

    application = FastAPI(
        title="Find the Dog Level Editor",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    application.state.settings = settings
    application.state.stores = components.stores
    application.state.worker = components.worker
    application.state.providers = components.providers
    application.state.redactor = components.redactor
    application.state.logger = runtime_logger
    application.state.launch_credential = launch_credential
    application.state.human_approval_credential = components.human_approval_credential
    application.add_middleware(
        LocalRequestGuardMiddleware,
        settings=settings,
        credential=launch_credential,
    )
    application.add_middleware(
        SecretBoundaryMiddleware,
        redactor=components.redactor,
    )

    @application.exception_handler(StarletteHTTPException)
    async def redact_http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            {"detail": components.redactor.sanitize(error.detail)},
            status_code=error.status_code,
            headers={
                str(key): components.redactor.sanitize_text(str(value))
                for key, value in (error.headers or {}).items()
            },
        )

    @application.exception_handler(RequestValidationError)
    async def redact_validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {"detail": components.redactor.sanitize(jsonable_encoder(error.errors()))},
            status_code=422,
        )

    launch_credential_scheme = APIKeyHeader(
        name=LAUNCH_CREDENTIAL_HEADER,
        scheme_name="LaunchCredential",
        auto_error=False,
    )
    protected_dependencies = [Security(launch_credential_scheme)]

    @application.get(
        "/bootstrap",
        response_model=BootstrapResponse,
        operation_id="getEditorBootstrap",
        openapi_extra={
            "x-ftd-authority": "same-origin-bootstrap",
            "x-ftd-side-effects": "none",
            "x-ftd-cost": "none",
        },
    )
    def bootstrap() -> BootstrapResponse:
        return BootstrapResponse(launchCredential=launch_credential)

    @application.get(
        "/api/status",
        response_model=EditorStatus,
        operation_id="getEditorStatus",
        openapi_extra={
            "x-ftd-side-effects": "none",
            "x-ftd-cost": "none",
            "x-ftd-authorization": "launch-credential",
        },
        dependencies=protected_dependencies,
    )
    def status() -> EditorStatus:
        return EditorStatus(
            service="ftd-level-editor",
            providerMode=components.providers.mode,
            workerMode=components.worker.mode,
            stores=components.stores.names(),
        )

    @application.get(
        "/api/openapi.json",
        operation_id="getEditorOpenApi",
        include_in_schema=False,
        dependencies=protected_dependencies,
    )
    def openapi_document() -> dict[str, Any]:
        return application.openapi()

    if components.stores.sessions is not None:
        from .sessions.routes import build_session_router

        application.include_router(
            build_session_router(
                components.stores.sessions,
                protected_dependencies,
            )
        )

    if components.stores.jobs is not None:
        from .jobs.actions import build_job_router

        application.include_router(
            build_job_router(components.stores.jobs, protected_dependencies)
        )

    if components.stores.publishing is not None:
        from .publishing.routes import build_publishing_router

        if components.human_approval_credential is None:
            raise ValueError(
                "publishing composition requires an operator-supplied human approval credential"
            )

        application.include_router(
            build_publishing_router(
                components.stores.publishing,
                components.stores.sessions,
                protected_dependencies,
                components.human_approval_credential,
            )
        )

    return application
