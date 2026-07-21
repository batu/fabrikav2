"""Same-origin request protection and the central secret sanitization boundary."""

from __future__ import annotations

import hmac
import json
import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .settings import EditorSettings


LAUNCH_CREDENTIAL_HEADER: Final = "X-FTD-Launch-Credential"
_PROTECTED_PREFIXES: Final = ("/api", "/assets", "/downloads")
_MUTATING_METHODS: Final = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_CORS_METHODS: Final = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"})
_CREDENTIAL_PATTERNS: Final = (
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"),
    re.compile(
        r"(?i)\b(?:authorization|x[-\w]*api[-_]?key|api[-_]?key|token)\b"
        r"\s*[:=]\s*(?:bearer\s+)?[^\s,&;]+"
    ),
    re.compile(r"(?i)(?:[?&])(?:api[-_]?key|token)=[^&#\s]+"),
)
_ABSOLUTE_PATH = re.compile(r"(?<![\w.-])/(?:Users|home)/[^\s'\"]+")


@dataclass(frozen=True, slots=True)
class SecretValue:
    _value: str

    def reveal(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return "SecretValue(<redacted>)"

    def __str__(self) -> str:
        return "<redacted>"


@dataclass(frozen=True, slots=True)
class CompositionSecrets:
    _items: tuple[tuple[str, SecretValue], ...]

    @classmethod
    def from_mapping(cls, values: Mapping[str, str]) -> "CompositionSecrets":
        return cls(tuple((name, SecretValue(value)) for name, value in values.items()))

    def values(self) -> tuple[str, ...]:
        return tuple(value.reveal() for _, value in self._items if value.reveal())

    def get(self, name: str) -> SecretValue | None:
        return next((value for key, value in self._items if key == name), None)

    def __repr__(self) -> str:
        names = ", ".join(name for name, _ in self._items)
        return f"CompositionSecrets(names=[{names}], values=<redacted>)"


class SecretRedactor:
    """Sanitize untrusted/provider text before it reaches any outward sink."""

    def __init__(self, secrets: CompositionSecrets):
        self.secrets = secrets

    def sanitize_text(self, value: str) -> str:
        sanitized = value
        for secret in sorted(self.secrets.values(), key=len, reverse=True):
            sanitized = sanitized.replace(secret, "<redacted>")
        for pattern in _CREDENTIAL_PATTERNS:
            sanitized = pattern.sub("<redacted>", sanitized)
        return _ABSOLUTE_PATH.sub("<redacted-path>", sanitized)

    def sanitize(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.sanitize_text(value)
        if isinstance(value, Path):
            return self.sanitize_text(str(value))
        if isinstance(value, Mapping):
            return {
                self.sanitize_text(str(key)): self.sanitize(item)
                for key, item in value.items()
            }
        if isinstance(value, tuple):
            return tuple(self.sanitize(item) for item in value)
        if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
            return [self.sanitize(item) for item in value]
        return value

    def sanitize_exception(self, error: BaseException) -> dict[str, str]:
        return {
            "code": "internal_error",
            "message": self.sanitize_text(f"{type(error).__name__}: {error}"),
        }

    def assert_tree_clean(self, root: Path) -> None:
        encoded_secrets = [secret.encode() for secret in self.secrets.values()]
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            content = path.read_bytes()
            for secret in encoded_secrets:
                if secret in content:
                    raise AssertionError(f"secret persisted in {path}")


class SecretRedactionFilter(logging.Filter):
    def __init__(self, redactor: SecretRedactor):
        super().__init__()
        self._redactor = redactor

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self._redactor.sanitize_text(record.getMessage())
        record.args = ()
        if record.exc_info is not None:
            rendered = logging.Formatter().formatException(record.exc_info)
            record.exc_text = self._redactor.sanitize_text(rendered)
            record.exc_info = None
        elif record.exc_text is not None:
            record.exc_text = self._redactor.sanitize_text(record.exc_text)
        if record.stack_info is not None:
            record.stack_info = self._redactor.sanitize_text(record.stack_info)
        return True


def _header_error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message}},
        status_code=status,
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )


class LocalRequestGuardMiddleware:
    """Reject DNS rebinding, cross-origin writes, and missing launch authority."""

    def __init__(self, app: ASGIApp, settings: EditorSettings, credential: str):
        self._app = app
        self._settings = settings
        self._credential = credential

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        host = headers.get("host", "")
        if host not in self._settings.allowed_hosts:
            await _header_error(400, "invalid_host", "Host is not allowed")(scope, receive, send)
            return

        origin = headers.get("origin")
        if origin is not None and origin not in self._settings.allowed_origins:
            await _header_error(403, "invalid_origin", "Origin is not allowed")(scope, receive, send)
            return

        method = scope["method"].upper()
        path = scope.get("path", "")
        if method == "OPTIONS" and headers.get("access-control-request-method"):
            await self._preflight(scope, receive, send, headers, origin)
            return

        if method in _MUTATING_METHODS and origin is None:
            await _header_error(403, "origin_required", "Mutating requests require Origin")(
                scope, receive, send
            )
            return

        if path.startswith(_PROTECTED_PREFIXES):
            supplied = headers.get(LAUNCH_CREDENTIAL_HEADER)
            if supplied is None or not hmac.compare_digest(supplied, self._credential):
                await _header_error(401, "invalid_launch_credential", "Launch credential required")(
                    scope, receive, send
                )
                return

        async def send_with_security_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                mutable = MutableHeaders(scope=message)
                mutable["Cache-Control"] = "no-store"
                mutable["Referrer-Policy"] = "no-referrer"
                mutable["X-Content-Type-Options"] = "nosniff"
            await send(message)

        await self._app(scope, receive, send_with_security_headers)

    async def _preflight(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        headers: Headers,
        origin: str | None,
    ) -> None:
        requested_method = headers.get("access-control-request-method", "").upper()
        requested_headers = headers.get("access-control-request-headers", "")
        normalized_headers = {item.strip().lower() for item in requested_headers.split(",") if item.strip()}
        if origin is None or origin not in self._settings.allowed_origins:
            response = _header_error(403, "invalid_origin", "Origin is not allowed")
        elif requested_method not in _CORS_METHODS:
            response = _header_error(403, "invalid_preflight", "Method is not allowed")
        elif normalized_headers - {LAUNCH_CREDENTIAL_HEADER.lower(), "content-type"}:
            response = _header_error(403, "invalid_preflight", "Header is not allowed")
        else:
            response = Response(
                status_code=204,
                headers={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Methods": requested_method,
                    "Access-Control-Allow-Headers": requested_headers,
                    "Cache-Control": "no-store",
                    "Vary": "Origin",
                },
            )
        await response(scope, receive, send)


class SecretBoundaryMiddleware:
    """Return sanitized failures without exposing raw errors to the ASGI server."""

    def __init__(self, app: ASGIApp, redactor: SecretRedactor):
        self._app = app
        self._redactor = redactor

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        response_started = False

        async def track_start(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self._app(scope, receive, track_start)
        except Exception as error:
            if response_started:
                raise
            response = JSONResponse(
                {"error": self._redactor.sanitize_exception(error)},
                status_code=500,
                headers={
                    "Cache-Control": "no-store",
                    "Referrer-Policy": "no-referrer",
                    "X-Content-Type-Options": "nosniff",
                },
            )
            await response(scope, receive, send)


def sanitized_json(redactor: SecretRedactor, value: Any) -> bytes:
    """Canonical JSON bytes for events, metadata, artifacts, or evidence sinks."""

    return json.dumps(
        redactor.sanitize(value),
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
