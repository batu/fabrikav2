"""Small deterministic JSON Schema to TypeScript helpers."""

from __future__ import annotations

import json
from typing import Any, Literal


def ts_identifier(name: str) -> str:
    return "".join(part for part in name.replace("-", "_").split("_") if part)


def ts_pascal_identifier(name: str) -> str:
    identifier = ts_identifier(name)
    return identifier[:1].upper() + identifier[1:]


def ts_type(
    schema: dict[str, Any] | None,
    *,
    omit_null: bool = False,
    array_style: Literal["generic", "suffix"] = "generic",
) -> str:
    if not schema:
        return "unknown"
    if "$ref" in schema:
        return ts_identifier(schema["$ref"].rsplit("/", 1)[-1])
    if "const" in schema:
        return json.dumps(schema["const"])
    if "enum" in schema:
        return " | ".join(json.dumps(value) for value in schema["enum"])
    if "anyOf" in schema:
        variants = [
            item
            for item in schema["anyOf"]
            if not (omit_null and item.get("type") == "null")
        ]
        return " | ".join(
            sorted(
                {
                    ts_type(item, omit_null=omit_null, array_style=array_style)
                    for item in variants
                }
            )
        )
    if "allOf" in schema:
        return " & ".join(
            ts_type(item, omit_null=omit_null, array_style=array_style)
            for item in schema["allOf"]
        )
    schema_type = schema.get("type")
    if schema_type == "array":
        item = ts_type(
            schema.get("items"), omit_null=omit_null, array_style=array_style
        )
        return f"{item}[]" if array_style == "suffix" else f"Array<{item}>"
    if schema_type == "object":
        properties = schema.get("properties")
        if properties:
            members = "; ".join(
                f"{json.dumps(name)}: "
                f"{ts_type(value, omit_null=omit_null, array_style=array_style)}"
                for name, value in sorted(properties.items())
            )
            return "{ " + members + " }"
        additional = schema.get("additionalProperties")
        value_type = (
            ts_type(additional, omit_null=omit_null, array_style=array_style)
            if isinstance(additional, dict)
            else "unknown"
        )
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
