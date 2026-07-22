"""OpenAPI is the single discoverability authority; TypeScript is derived."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from .schema_codegen import ts_identifier, ts_pascal_identifier, ts_type

GENERATED_TS_HEADER = (
    "// GENERATED FILE - do not edit by hand.\n"
    "// Source of truth: tools/ftd-level-editor/openapi.json\n"
    "// Regenerate: uv run python scripts/generate_contracts.py\n"
)


def build_contract_app(root: Path):
    """Compose one fully-wired provider-free app purely to derive contracts."""

    from .app import (
        AppComponents,
        EditorStores,
        FailClosedProviders,
        ManualWorker,
        create_app,
    )
    from .approvals import ApprovalStore
    from .artifacts import ArtifactStore
    from .jobs.actions import JobService
    from .jobs.store import JobStore
    from .security import CompositionSecrets, SecretRedactor
    from .sessions.store import SessionStore
    from .publishing.sequence import PublishingService
    from .settings import EditorSettings

    settings = EditorSettings.for_test(root)
    sessions = SessionStore(settings.workspace)
    jobs = JobStore(settings.workspace.state)
    service = JobService(
        jobs=jobs,
        approvals=ApprovalStore(jobs),
        artifacts=ArtifactStore(settings.workspace.artifacts, jobs),
        sessions=sessions,
    )
    publishing = PublishingService(
        public_root=settings.workspace.public,
        state_root=settings.workspace.state / "publishing",
        approvals=ApprovalStore(jobs),
    )
    components = AppComponents(
        stores=EditorStores(sessions=sessions, jobs=service, publishing=publishing),
        worker=ManualWorker(),
        providers=FailClosedProviders(),
        redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
    )
    return create_app(settings, components)


def openapi_document() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="ftd-contract-") as directory:
        return build_contract_app(Path(directory)).openapi()


def openapi_bytes(document: dict[str, Any] | None = None) -> bytes:
    return (
        json.dumps(
            document if document is not None else openapi_document(),
            indent=2,
            sort_keys=True,
            ensure_ascii=False,
        )
        + "\n"
    ).encode("utf-8")


def generate_typescript(document: dict[str, Any]) -> str:
    """Emit deterministic wire types for every OpenAPI component schema."""

    lines: list[str] = [GENERATED_TS_HEADER]
    schemas = document.get("components", {}).get("schemas", {})
    for name in sorted(schemas):
        schema = schemas[name]
        identifier = ts_identifier(name)
        if schema.get("type") == "object" and "properties" in schema:
            required = set(schema.get("required", ()))
            lines.append(f"export interface {identifier} {{")
            for property_name in sorted(schema["properties"]):
                property_schema = schema["properties"][property_name]
                optional = "" if property_name in required else "?"
                lines.append(
                    f"  {json.dumps(property_name)}{optional}: "
                    f"{ts_type(property_schema)};"
                )
            lines.append("}")
        else:
            lines.append(f"export type {identifier} = {ts_type(schema)};")
        lines.append("")
    operations: list[str] = []
    for path in sorted(document.get("paths", {})):
        for method in sorted(document["paths"][path]):
            operation = document["paths"][path][method]
            operation_id = operation.get("operationId")
            if operation_id:
                binary_media_types: set[str] = set()
                binary_headers: dict[str, dict[str, Any]] = {}
                for response in operation.get("responses", {}).values():
                    for media_type, content in response.get("content", {}).items():
                        schema = content.get("schema", {})
                        if schema.get("type") == "string" and schema.get("format") == "binary":
                            binary_media_types.add(media_type)
                            binary_headers.update(response.get("headers", {}))
                response_type = None
                if binary_media_types:
                    prefix = ts_pascal_identifier(operation_id)
                    headers_type = f"{prefix}ResponseHeaders"
                    media_type = f"{prefix}ResponseMediaType"
                    response_type = f"{prefix}BinaryResponse"
                    lines.append(f"export interface {headers_type} {{")
                    for header_name in sorted(binary_headers):
                        lines.append(
                            f"  {json.dumps(header_name)}: "
                            f"{ts_type(binary_headers[header_name].get('schema'))};"
                        )
                    lines.append("}")
                    lines.append("")
                    lines.append(
                        f"export type {media_type} = "
                        + " | ".join(json.dumps(value) for value in sorted(binary_media_types))
                        + ";"
                    )
                    lines.append("")
                    lines.append(f"export interface {response_type} {{")
                    lines.append('  "body": Blob;')
                    lines.append(f'  "headers": {headers_type};')
                    lines.append(f'  "mediaType": {media_type};')
                    lines.append("}")
                    lines.append("")
                response_member = (
                    f"; response: {response_type}" if response_type is not None else ""
                )
                operations.append(
                    f'  "{operation_id}": {{ method: "{method}"; path: "{path}"'
                    f"{response_member} }};"
                )
    lines.append("export interface FtdEditorOperations {")
    lines.extend(operations)
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def generated_typescript_bytes(document: dict[str, Any] | None = None) -> bytes:
    return generate_typescript(
        document if document is not None else openapi_document()
    ).encode("utf-8")
