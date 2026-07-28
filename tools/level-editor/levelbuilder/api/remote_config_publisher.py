"""Firebase Remote Config publishing adapter for sequence activation.

The Levelbuilder activation workflow depends on this small interface so tests can
use a fake publisher and local/dev runs can report missing credentials without
pretending to publish. The real REST publisher is intentionally dependency-free.
"""

from __future__ import annotations

import gzip
import zlib
import json
import os
import socket
import urllib.error
import urllib.request
from typing import Any, Protocol


class RemoteConfigPublishConflict(ValueError):
    """Raised when Firebase rejects a publish because the template is stale."""


class RemoteConfigPublishUnavailable(ValueError):
    """Raised when live publish is requested without required configuration."""


class RemoteConfigPublishError(RuntimeError):
    """Raised for non-conflict Remote Config publish failures."""


class RemoteConfigPublisher(Protocol):
    def status(self) -> dict[str, Any]:
        """Return a UI-safe publisher status dictionary."""

    def publish_sequence(
        self,
        *,
        raw_payload: str,
        sha256_hex: str,
        request_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        """Publish the sequence payload and hash, returning publish metadata."""


class DisabledRemoteConfigPublisher:
    """Fail-closed publisher for this fork: no path may reach a production
    Firebase Remote Config publish. Status reports disabled; publish raises."""

    def status(self) -> dict[str, Any]:
        return {"configured": False, "mode": "disabled", "projectId": None}

    def publish_sequence(self, **_: Any) -> dict[str, Any]:
        raise RemoteConfigPublishUnavailable(
            "remote publication is disabled in the level-editor fork"
        )


class EnvironmentRemoteConfigPublisher:
    """Dependency-free REST publisher using an externally supplied OAuth token."""

    def __init__(
        self,
        *,
        project_id: str | None = None,
        oauth_token: str | None = None,
        quota_project_id: str | None = None,
        base_url: str = "https://firebaseremoteconfig.googleapis.com/v1",
    ) -> None:
        self.project_id = project_id if project_id is not None else os.environ.get("FTD_REMOTE_CONFIG_PROJECT_ID")
        self.oauth_token = oauth_token if oauth_token is not None else os.environ.get("FTD_REMOTE_CONFIG_OAUTH_TOKEN")
        self.quota_project_id = (
            quota_project_id if quota_project_id is not None else os.environ.get("FTD_REMOTE_CONFIG_QUOTA_PROJECT_ID")
        )
        self.base_url = base_url.rstrip("/")

    def status(self) -> dict[str, Any]:
        configured = bool(self.project_id and self.oauth_token)
        return {
            "configured": configured,
            "mode": "firebase-rest" if configured else "unconfigured",
            "projectId": self.project_id if self.project_id else None,
        }

    def publish_sequence(
        self,
        *,
        raw_payload: str,
        sha256_hex: str,
        request_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        if not self.project_id or not self.oauth_token:
            raise RemoteConfigPublishUnavailable("Remote Config publisher is not configured.")

        template, fetched_etag = self._fetch_template()
        patched_template = _template_with_sequence_parameters(
            template,
            raw_payload=raw_payload,
            sha256_hex=sha256_hex,
        )
        validated_etag = self._put_template(patched_template, fetched_etag, validate_only=True)
        published_etag = self._put_template(patched_template, fetched_etag, validate_only=False)
        return {
            "fetchedEtag": fetched_etag,
            "validatedEtag": validated_etag,
            "publishedEtag": published_etag,
            "templateVersion": _template_version(patched_template),
            "projectId": self.project_id,
        }

    def published_sequence_matches(self, *, raw_payload: str, sha256_hex: str) -> bool:
        if not self.project_id or not self.oauth_token:
            return False
        template, _ = self._fetch_template()
        return (
            _parameter_default_value(template, "level_sequence_payload") == raw_payload
            and _parameter_default_value(template, "level_sequence_sha256") == sha256_hex
        )

    def _url(self, suffix: str = "") -> str:
        return f"{self.base_url}/projects/{self.project_id}/remoteConfig{suffix}"

    def _request(self, request: urllib.request.Request) -> tuple[dict[str, Any], str | None]:
        request.add_header("Authorization", f"Bearer {self.oauth_token}")
        request.add_header("Accept", "application/json")
        request.add_header("Accept-Encoding", "gzip")
        if self.quota_project_id:
            request.add_header("X-Goog-User-Project", self.quota_project_id)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = _response_body_bytes(response.read(), response.headers.get("Content-Encoding"))
                data = json.loads(raw.decode("utf-8")) if raw else {}
                return data if isinstance(data, dict) else {}, response.headers.get("ETag")
        except urllib.error.HTTPError as exc:
            body = _http_error_body(exc)
            if exc.code in {409, 412} or (exc.code == 400 and _is_version_mismatch_error(body)):
                raise RemoteConfigPublishConflict(f"Remote Config template conflict ({exc.code}).") from exc
            raise RemoteConfigPublishError(f"Remote Config request failed ({exc.code}): {body}") from exc
        except (urllib.error.URLError, TimeoutError, socket.timeout, OSError, EOFError, zlib.error, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise RemoteConfigPublishError("Remote Config request failed before a valid template response was received.") from exc

    def _fetch_template(self) -> tuple[dict[str, Any], str]:
        request = urllib.request.Request(self._url(), method="GET")
        template, etag = self._request(request)
        if not etag:
            raise RemoteConfigPublishError("Remote Config template response did not include an ETag.")
        return template, etag

    def _put_template(self, template: dict[str, Any], etag: str, *, validate_only: bool) -> str | None:
        suffix = "?validateOnly=true" if validate_only else ""
        request = urllib.request.Request(
            self._url(suffix),
            data=json.dumps(template, separators=(",", ":")).encode("utf-8"),
            method="PUT",
        )
        request.add_header("Content-Type", "application/json; charset=utf-8")
        request.add_header("If-Match", etag)
        _, response_etag = self._request(request)
        return response_etag


def _response_body_bytes(raw: bytes, content_encoding: str | None) -> bytes:
    if content_encoding is not None and content_encoding.lower() == "gzip":
        return gzip.decompress(raw)
    return raw


def _http_error_body(exc: urllib.error.HTTPError) -> str:
    content_encoding = exc.headers.get("Content-Encoding") if exc.headers is not None else None
    try:
        body_bytes = _response_body_bytes(exc.read(), content_encoding)
        return body_bytes.decode("utf-8", errors="replace")
    except (EOFError, OSError, zlib.error, UnicodeDecodeError):
        return "<unreadable response body>"


def _is_version_mismatch_error(body: str) -> bool:
    normalized = body.upper()
    return "VERSION_MISMATCH" in normalized or ("ETAG" in normalized and ("MISMATCH" in normalized or "STALE" in normalized))


def _template_with_sequence_parameters(
    template: dict[str, Any],
    *,
    raw_payload: str,
    sha256_hex: str,
) -> dict[str, Any]:
    patched = json.loads(json.dumps(template))
    _set_parameter_value(
        patched,
        key="level_sequence_payload",
        value=raw_payload,
        fallback_value_type="STRING",
    )
    _set_parameter_value(
        patched,
        key="level_sequence_sha256",
        value=sha256_hex,
        fallback_value_type="STRING",
    )
    return patched


def _set_parameter_value(template: dict[str, Any], *, key: str, value: str, fallback_value_type: str) -> None:
    container = _parameter_container(template, key)
    existing = container.get(key)
    parameter = dict(existing) if isinstance(existing, dict) else {}
    if not isinstance(parameter.get("valueType"), str):
        parameter["valueType"] = fallback_value_type
    parameter["defaultValue"] = {"value": value}
    container[key] = parameter


def _parameter_container(template: dict[str, Any], key: str) -> dict[str, Any]:
    parameter_groups = template.get("parameterGroups")
    if isinstance(parameter_groups, dict):
        for group in parameter_groups.values():
            if not isinstance(group, dict):
                continue
            group_parameters = group.get("parameters")
            if isinstance(group_parameters, dict) and key in group_parameters:
                return group_parameters

    parameters = template.setdefault("parameters", {})
    if not isinstance(parameters, dict):
        raise RemoteConfigPublishError("Remote Config template parameters must be an object.")
    return parameters


def _parameter_default_value(template: dict[str, Any], key: str) -> str | None:
    parameter_groups = template.get("parameterGroups")
    if isinstance(parameter_groups, dict):
        for group in parameter_groups.values():
            if not isinstance(group, dict):
                continue
            value = _parameter_default_value_from_container(group.get("parameters"), key)
            if value is not None:
                return value
    return _parameter_default_value_from_container(template.get("parameters"), key)


def _parameter_default_value_from_container(container: Any, key: str) -> str | None:
    if not isinstance(container, dict):
        return None
    parameter = container.get(key)
    if not isinstance(parameter, dict):
        return None
    default_value = parameter.get("defaultValue")
    if not isinstance(default_value, dict):
        return None
    value = default_value.get("value")
    return value if isinstance(value, str) else None


def _template_version(template: dict[str, Any]) -> str | None:
    version = template.get("version")
    if not isinstance(version, dict):
        return None
    version_number = version.get("versionNumber")
    if isinstance(version_number, str):
        return version_number
    if isinstance(version_number, int):
        return str(version_number)
    return None
