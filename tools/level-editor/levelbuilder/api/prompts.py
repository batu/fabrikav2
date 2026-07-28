"""Prompt library — versioned, file-backed prompt storage.

One JSON file, keyed by arbitrary `kind` strings (e.g. `view:isometric`,
`style:flatvector`, `scene:japan.night_harbor`, `inpaint:default`).
Each kind has an append-only version list and a `default_version` pointer
that's bumped to the newest version on save. Single source of truth for
both Wizard (PromptSaver) and Batch (resolvePrompt).
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from .session import LEVELS_DIR

_LOCK = threading.Lock()
_KIND_RE = re.compile(r"^[a-z0-9_.:-]{1,128}$")
_LIBRARY_PATH: Path = LEVELS_DIR.parent / "prompts_library.json"


class PromptVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int
    text: str
    created_at: datetime


class PromptKind(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_version: int
    versions: list[PromptVersion]


def _read_library() -> dict[str, dict]:
    if not _LIBRARY_PATH.exists():
        return {}
    return json.loads(_LIBRARY_PATH.read_text())


def _write_library(data: dict[str, dict]) -> None:
    _LIBRARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _LIBRARY_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, _LIBRARY_PATH)


def validate_kind(kind: str) -> None:
    if not _KIND_RE.match(kind):
        raise ValueError(f"invalid prompt kind: {kind!r}")


def list_prompts() -> dict[str, PromptKind]:
    """All kinds in the library (D1 PROMPTS tab — central editing surface)."""
    with _LOCK:
        data = _read_library()
    return {kind: PromptKind.model_validate(raw) for kind, raw in sorted(data.items())}


def get_prompt(kind: str) -> PromptKind | None:
    validate_kind(kind)
    raw = _read_library().get(kind)
    return PromptKind.model_validate(raw) if raw is not None else None


def save_prompt(kind: str, text: str) -> PromptKind:
    """Append a new version, set as default, return the updated kind."""
    validate_kind(kind)
    with _LOCK:
        data = _read_library()
        current = data.get(kind, {"default_version": 0, "versions": []})
        next_version = max((v["version"] for v in current["versions"]), default=0) + 1
        current["versions"].append({
            "version": next_version,
            "text": text,
            "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        })
        current["default_version"] = next_version
        data[kind] = current
        _write_library(data)
    return PromptKind.model_validate(current)


def set_default(kind: str, version: int) -> PromptKind:
    validate_kind(kind)
    with _LOCK:
        data = _read_library()
        current = data.get(kind)
        if current is None:
            raise KeyError(f"no such prompt kind: {kind}")
        if not any(v["version"] == version for v in current["versions"]):
            raise KeyError(f"no such version {version} for kind {kind}")
        current["default_version"] = version
        data[kind] = current
        _write_library(data)
    return PromptKind.model_validate(current)
