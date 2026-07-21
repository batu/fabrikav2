"""Lossless tolerant boundary for FTD authoring-session JSON."""

from __future__ import annotations

import copy
import json
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

from ..fs import encode_json


class AuthoringDog(BaseModel):
    """Known dog identity fields with all legacy/future fields retained."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    index: int
    id: str | None = None
    status: str | None = None
    active_variant: int | None = Field(default=None, alias="activeVariant")
    prompt_override: str | None = Field(default=None, alias="promptOverride")


class AuthoringSession(BaseModel):
    """Typed known fields plus an exact original-byte no-op representation."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    dogs: list[AuthoringDog] = Field(default_factory=list)

    _original_bytes: bytes | None = PrivateAttr(default=None)
    _original_mapping: dict[str, Any] | None = PrivateAttr(default=None)

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
        return session

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> Self:
        session = cls.model_validate(copy.deepcopy(value))
        session._original_mapping = copy.deepcopy(value)
        session._original_bytes = encode_json(value)
        return session

    def to_mapping(self) -> dict[str, Any]:
        """Serialize only fields that existed, plus explicitly added mutations."""

        return self.model_dump(by_alias=True, exclude_unset=True)

    def to_bytes(self) -> bytes:
        mapping = self.to_mapping()
        if self._original_bytes is not None and mapping == self._original_mapping:
            return self._original_bytes
        return encode_json(mapping)

    def with_mapping(self, value: dict[str, Any]) -> Self:
        return type(self).from_mapping(value)
