"""Preset shapes: a named binding over frozen catalog identifiers.

A preset selects catalog keys only. It never carries prompt prose, because the
catalog is the single source of prompt text and a preset that inlined it would
become a second, silently diverging copy.

Reproducibility rests on the run record rather than the preset: presets are
edited, so a run stores the fully resolved selection **by value** together with
the catalog hash it resolved against and a digest over both. A run therefore
answers "what exactly produced this?" without depending on mutable state.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..prompts.recipes import (
    CONTENTS,
    ENTITIES,
    STYLES,
    VIEWS,
    build_scene_prompt,
    get_entity_prompt,
    prompt_catalog_snapshot,
)

PRESET_ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{1,63}$"

# Entities the editor offers beyond the frozen v1 catalog.
#
# catalog.json is pinned byte-for-byte by the pure-FTD parity fixture, which
# proves this editor emits the same prompts v1 did; adding a key there would
# break that proof for a vocabulary change. `get_entity_prompt` already falls
# back to the identifier itself as the noun, so an additive vocabulary needs no
# catalog edit and no second prompt template.
EDITOR_ENTITIES: dict[str, str] = {"bird": "bird"}


def entity_vocabulary() -> dict[str, str]:
    return {**ENTITIES, **EDITOR_ENTITIES}


class PresetSelection(BaseModel):
    """The frozen catalog identifiers a preset binds together."""

    model_config = ConfigDict(extra="forbid")

    scene: str = Field(min_length=1)
    view: str = Field(min_length=1)
    style: str = Field(min_length=1)
    entity: str = Field(min_length=1)
    model: str = Field(min_length=1)


class PresetRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=PRESET_ID_PATTERN)
    version: int = Field(ge=1)
    label: str = Field(min_length=1)
    selection: PresetSelection
    notes: str = ""


class ResolvedPreset(BaseModel):
    """A preset with its catalog text resolved and pinned by digest."""

    model_config = ConfigDict(extra="forbid")

    presetId: str
    presetVersion: int
    label: str
    selection: PresetSelection
    scenePrompt: str
    entityPrompt: str
    catalogSha256: str
    digest: str


class PresetRunRecord(BaseModel):
    """An immutable record of one generation run.

    ``resolved`` is a by-value snapshot: editing the preset afterwards cannot
    rewrite what this run reports.
    """

    model_config = ConfigDict(extra="forbid")

    runId: str = Field(min_length=1)
    presetId: str
    presetVersion: int
    digest: str
    resolved: ResolvedPreset
    createdAt: str
    outcome: str = Field(pattern=r"^(recorded|succeeded|failed)$")
    note: str = ""


class CatalogOptions(BaseModel):
    """Dropdown vocabularies, straight from the frozen catalog."""

    model_config = ConfigDict(extra="forbid")

    scenes: list[str]
    views: list[str]
    styles: list[str]
    entities: list[str]
    models: list[dict[str, str]]


class UnknownCatalogKey(ValueError):
    """A preset names an identifier the frozen catalog does not define."""


def validate_selection(selection: PresetSelection, model_ids: frozenset[str]) -> None:
    for field, catalog, name in (
        (selection.scene, CONTENTS, "scene"),
        (selection.view, VIEWS, "view"),
        (selection.style, STYLES, "style"),
        (selection.entity, entity_vocabulary(), "entity"),
    ):
        if field not in catalog:
            raise UnknownCatalogKey(f"selection.{name} is not a frozen catalog identifier")
    if selection.model not in model_ids:
        raise UnknownCatalogKey("selection.model is not an available model option")


def _digest(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def resolve(preset: PresetRecord) -> ResolvedPreset:
    """Resolve a preset's catalog keys into the prompts they name."""

    scene_prompt = build_scene_prompt(
        view=preset.selection.view,
        style=preset.selection.style,
        content=preset.selection.scene,
    )
    entity_prompt = get_entity_prompt(preset.selection.style, preset.selection.entity)
    catalog_sha = prompt_catalog_snapshot()["catalogSha256"]
    digest = _digest(
        {
            "presetId": preset.id,
            "presetVersion": preset.version,
            "selection": preset.selection.model_dump(),
            "scenePrompt": scene_prompt,
            "entityPrompt": entity_prompt,
            "catalogSha256": catalog_sha,
        }
    )
    return ResolvedPreset(
        presetId=preset.id,
        presetVersion=preset.version,
        label=preset.label,
        selection=preset.selection,
        scenePrompt=scene_prompt,
        entityPrompt=entity_prompt,
        catalogSha256=catalog_sha,
        digest=digest,
    )
