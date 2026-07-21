"""FastAPI composition boundary for the Find the Dog editor."""

from __future__ import annotations

import secrets as secrets_module
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Protocol

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from .security import LocalRequestGuardMiddleware, SecretRedactor
from .settings import EditorSettings


class FailClosedProviderError(RuntimeError):
    pass


class Worker(Protocol):
    mode: str

    def step(self) -> bool: ...


class ProviderRegistry(Protocol):
    mode: str

    def require(self, name: str) -> Any: ...


class StoreRegistry(Protocol):
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
class EmptyStores:
    """U1 store registry: no ledger or authoring store exists yet."""

    def names(self) -> tuple[str, ...]:
        return ()


@dataclass(frozen=True, slots=True)
class AppComponents:
    stores: StoreRegistry
    worker: Worker
    providers: ProviderRegistry
    redactor: SecretRedactor


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

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        settings.workspace.prepare()
        yield

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
    application.state.launch_credential = launch_credential
    application.add_middleware(
        LocalRequestGuardMiddleware,
        settings=settings,
        credential=launch_credential,
    )

    @application.exception_handler(Exception)
    async def redact_unhandled(_: Request, error: Exception) -> JSONResponse:
        return JSONResponse(
            {"error": components.redactor.sanitize_exception(error)},
            status_code=500,
        )

    @application.get(
        "/bootstrap",
        response_model=BootstrapResponse,
        operation_id="getEditorBootstrap",
        openapi_extra={"x-ftd-authority": "same-origin-bootstrap"},
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
    )
    def openapi_document() -> dict[str, Any]:
        return application.openapi()

    return application
