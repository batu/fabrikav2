"""OpenAPI is the single discoverability authority; TypeScript is derived."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

GENERATED_TS_HEADER = (
    "// GENERATED FILE - do not edit by hand.\n"
    "// Source of truth: tools/ftd-level-editor/openapi.json\n"
    "// Regenerate: uv run python scripts/generate_contracts.py\n"
)


def build_contract_app():
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
    from .settings import EditorSettings

    settings = EditorSettings.for_test(Path(tempfile.mkdtemp(prefix="ftd-contract-")))
    sessions = SessionStore(settings.workspace)
    jobs = JobStore(settings.workspace.state)
    service = JobService(
        jobs=jobs,
        approvals=ApprovalStore(jobs),
        artifacts=ArtifactStore(settings.workspace.artifacts, jobs),
        sessions=sessions,
    )
    components = AppComponents(
        stores=EditorStores(sessions=sessions, jobs=service),
        worker=ManualWorker(),
        providers=FailClosedProviders(),
        redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
    )
    return create_app(settings, components)


def openapi_document() -> dict[str, Any]:
    return build_contract_app().openapi()


def openapi_bytes() -> bytes:
    return (
        json.dumps(openapi_document(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    ).encode("utf-8")


def _ts_identifier(name: str) -> str:
    return "".join(part for part in name.replace("-", "_").split("_") if part)


def _ts_type(schema: dict[str, Any] | None) -> str:
    if not schema:
        return "unknown"
    if "$ref" in schema:
        return _ts_identifier(schema["$ref"].rsplit("/", 1)[-1])
    if "const" in schema:
        return json.dumps(schema["const"])
    if "enum" in schema:
        return " | ".join(json.dumps(value) for value in schema["enum"])
    if "anyOf" in schema:
        return " | ".join(sorted({_ts_type(item) for item in schema["anyOf"]}))
    if "allOf" in schema:
        return " & ".join(_ts_type(item) for item in schema["allOf"])
    schema_type = schema.get("type")
    if schema_type == "array":
        item = _ts_type(schema.get("items"))
        return f"Array<{item}>"
    if schema_type == "object":
        properties = schema.get("properties")
        if properties:
            members = "; ".join(
                f"{json.dumps(name)}: {_ts_type(value)}"
                for name, value in sorted(properties.items())
            )
            return "{ " + members + " }"
        additional = schema.get("additionalProperties")
        value_type = _ts_type(additional) if isinstance(additional, dict) else "unknown"
        return f"Record<string, {value_type}>"
    if schema_type == "string":
        return "string"
    if schema_type in ("number", "integer"):
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "null":
        return "null"
    return "unknown"


def generate_typescript(document: dict[str, Any]) -> str:
    """Emit deterministic wire types for every OpenAPI component schema."""

    lines: list[str] = [GENERATED_TS_HEADER]
    schemas = document.get("components", {}).get("schemas", {})
    for name in sorted(schemas):
        schema = schemas[name]
        identifier = _ts_identifier(name)
        if schema.get("type") == "object" and "properties" in schema:
            required = set(schema.get("required", ()))
            lines.append(f"export interface {identifier} {{")
            for property_name in sorted(schema["properties"]):
                property_schema = schema["properties"][property_name]
                optional = "" if property_name in required else "?"
                lines.append(
                    f"  {json.dumps(property_name)}{optional}: "
                    f"{_ts_type(property_schema)};"
                )
            lines.append("}")
        else:
            lines.append(f"export type {identifier} = {_ts_type(schema)};")
        lines.append("")
    operations: list[str] = []
    for path in sorted(document.get("paths", {})):
        for method in sorted(document["paths"][path]):
            operation_id = document["paths"][path][method].get("operationId")
            if operation_id:
                operations.append(f'  "{operation_id}": {{ method: "{method}"; path: "{path}" }};')
    lines.append("export interface FtdEditorOperations {")
    lines.extend(operations)
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def generated_typescript_bytes() -> bytes:
    return generate_typescript(openapi_document()).encode("utf-8")
