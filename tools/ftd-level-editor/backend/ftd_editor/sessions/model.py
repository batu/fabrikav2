"""Lossless tolerant boundary for FTD authoring-session JSON."""

from __future__ import annotations

import copy
import json
from typing import Any, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    StrictInt,
    StrictStr,
    model_validator,
)

from ..fs import encode_json


class AuthoringDog(BaseModel):
    """Known dog identity fields with all legacy/future fields retained."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    # The string arm retains coercible legacy integers without normalizing them.
    index: StrictInt | StrictStr
    id: StrictStr | None = None
    status: StrictStr | None = None
    active_variant: StrictInt | StrictStr | None = Field(
        default=None, alias="activeVariant"
    )
    prompt_override: StrictStr | None = Field(default=None, alias="promptOverride")


class AuthoringSession(BaseModel):
    """Typed known fields plus an exact original-byte no-op representation."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    dogs: list[AuthoringDog] = Field(default_factory=list)

    _original_bytes: bytes | None = PrivateAttr(default=None)
    _original_mapping: dict[str, Any] | None = PrivateAttr(default=None)
    _baseline_mapping: dict[str, Any] | None = PrivateAttr(default=None)
    _baseline_sparse_mapping: dict[str, Any] | None = PrivateAttr(default=None)

    @model_validator(mode="before")
    @classmethod
    def require_object_root(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("authoring session must be a JSON object")
        return value

    @classmethod
    def from_bytes(cls, raw: bytes) -> Self:
        parsed = json.loads(raw)
        session = cls.model_validate(parsed)
        session._original_bytes = raw
        session._original_mapping = copy.deepcopy(parsed)
        session._baseline_mapping = session.model_dump(by_alias=True)
        session._baseline_sparse_mapping = session.model_dump(
            by_alias=True, exclude_unset=True
        )
        return session

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> Self:
        session = cls.model_validate(copy.deepcopy(value))
        session._original_mapping = copy.deepcopy(value)
        session._original_bytes = encode_json(value)
        session._baseline_mapping = session.model_dump(by_alias=True)
        session._baseline_sparse_mapping = session.model_dump(
            by_alias=True, exclude_unset=True
        )
        return session

    def to_mapping(self) -> dict[str, Any]:
        """Serialize only fields that existed, plus explicitly added mutations."""

        current = self.model_dump(by_alias=True)
        if (
            self._original_mapping is None
            or self._baseline_mapping is None
            or self._baseline_sparse_mapping is None
        ):
            return self.model_dump(by_alias=True, exclude_unset=True)
        sparse_current = self.model_dump(by_alias=True, exclude_unset=True)
        if self._baseline_mapping.get("dogs") != current.get("dogs"):
            sparse_current["dogs"] = [
                dog.model_dump(by_alias=True, exclude_unset=True) for dog in self.dogs
            ]
        return _overlay_model_changes(
            self._original_mapping,
            self._baseline_mapping,
            current,
            self._baseline_sparse_mapping,
            sparse_current,
        )

    def to_bytes(self) -> bytes:
        mapping = self.to_mapping()
        if self._original_bytes is not None and mapping == self._original_mapping:
            return self._original_bytes
        return encode_json(mapping)

    def with_mapping(self, value: dict[str, Any]) -> Self:
        return type(self).from_mapping(value)


def _overlay_model_changes(
    original: Any,
    baseline: Any,
    current: Any,
    baseline_sparse: Any,
    sparse_current: Any,
) -> Any:
    """Apply only explicit model edits, preserving untouched raw legacy values."""

    if baseline == current and baseline_sparse == sparse_current:
        return copy.deepcopy(original)
    if isinstance(baseline, dict) and isinstance(current, dict):
        result = copy.deepcopy(original) if isinstance(original, dict) else {}
        for key in baseline.keys() - current.keys():
            result.pop(key, None)
        for key, value in current.items():
            baseline_sparse_value = (
                baseline_sparse.get(key, _MISSING)
                if isinstance(baseline_sparse, dict)
                else _MISSING
            )
            sparse_value = (
                sparse_current.get(key, _MISSING)
                if isinstance(sparse_current, dict)
                else _MISSING
            )
            if key not in baseline:
                if sparse_value is not _MISSING:
                    result[key] = copy.deepcopy(sparse_value)
            elif (
                key not in result
                and baseline[key] == value
                and baseline_sparse_value == sparse_value
            ):
                continue
            else:
                overlaid = _overlay_model_changes(
                    result.get(key, _MISSING),
                    baseline[key],
                    value,
                    baseline_sparse_value,
                    sparse_value,
                )
                if overlaid is _MISSING:
                    result.pop(key, None)
                else:
                    result[key] = overlaid
        return result
    if (
        isinstance(baseline, list)
        and isinstance(current, list)
        and isinstance(original, list)
        and len(baseline) == len(current) == len(original)
    ):
        return [
            _overlay_model_changes(
                raw,
                before,
                after,
                before_sparse,
                sparse,
            )
            for raw, before, after, before_sparse, sparse in zip(
                original,
                baseline,
                current,
                baseline_sparse if isinstance(baseline_sparse, list) else baseline,
                sparse_current if isinstance(sparse_current, list) else current,
                strict=True,
            )
        ]
    if sparse_current is _MISSING:
        return _MISSING
    return copy.deepcopy(sparse_current)


_MISSING = object()
