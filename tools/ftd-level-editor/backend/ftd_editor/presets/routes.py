"""Preset selection and run-provenance routes."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .model import (
    CatalogOptions,
    PresetRecord,
    PresetRunRecord,
    PresetSelection,
    ResolvedPreset,
    UnknownCatalogKey,
)
from .store import PresetExists, PresetNotFound, PresetStore


class PresetNotFoundResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: Literal["preset not found"]


class PresetConflictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str


class UnknownCatalogKeyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str


class PresetIndexResponse(BaseModel):
    """Everything the dropdown needs in one call: the presets and the vocabularies."""

    model_config = ConfigDict(extra="forbid")

    presets: list[PresetRecord]
    options: CatalogOptions


class CreatePresetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    selection: PresetSelection
    notes: str = ""


class UpdateSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selection: PresetSelection


class RecordRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runId: str = Field(min_length=1)
    outcome: Literal["recorded", "succeeded", "failed"] = "recorded"
    note: str = ""


_NOT_FOUND = {404: {"model": PresetNotFoundResponse}}
_INVALID = {422: {"model": UnknownCatalogKeyResponse}}


def build_preset_router(store: PresetStore, dependencies: list[Any]) -> APIRouter:
    router = APIRouter(prefix="/api/presets", dependencies=dependencies)

    def not_found(preset_id: str) -> HTTPException:
        return HTTPException(status_code=404, detail="preset not found")

    @router.get(
        "",
        operation_id="listPresets",
        response_model=PresetIndexResponse,
        openapi_extra={"x-ftd-side-effects": "none", "x-ftd-cost": "none"},
    )
    def list_presets() -> PresetIndexResponse:
        return PresetIndexResponse(
            presets=store.list(),
            options=store.catalog_options(),
        )

    @router.post(
        "",
        status_code=201,
        operation_id="createPreset",
        response_model=PresetRecord,
        responses={409: {"model": PresetConflictResponse}, **_INVALID},
        openapi_extra={"x-ftd-side-effects": "preset-mutation", "x-ftd-cost": "none"},
    )
    def create_preset(body: CreatePresetRequest) -> PresetRecord:
        record = PresetRecord(
            id=body.id, version=1, label=body.label, selection=body.selection, notes=body.notes
        )
        try:
            return store.create(record)
        except PresetExists as error:
            raise HTTPException(status_code=409, detail="preset already exists") from error
        except UnknownCatalogKey as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.get(
        "/{preset_id}/resolved",
        operation_id="resolvePreset",
        response_model=ResolvedPreset,
        responses=_NOT_FOUND,
        openapi_extra={"x-ftd-side-effects": "none", "x-ftd-cost": "none"},
    )
    def resolve_preset(preset_id: str) -> ResolvedPreset:
        try:
            return store.resolve(preset_id)
        except PresetNotFound as error:
            raise not_found(preset_id) from error

    @router.post(
        "/{preset_id}/selection",
        operation_id="updatePresetSelection",
        response_model=PresetRecord,
        responses={**_NOT_FOUND, **_INVALID},
        openapi_extra={
            "x-ftd-side-effects": "preset-mutation",
            "x-ftd-cost": "none",
            "x-ftd-provenance": "bumps version; recorded runs keep their own snapshot",
        },
    )
    def update_preset_selection(preset_id: str, body: UpdateSelectionRequest) -> PresetRecord:
        try:
            return store.update_selection(preset_id, body.selection)
        except PresetNotFound as error:
            raise not_found(preset_id) from error
        except UnknownCatalogKey as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.post(
        "/{preset_id}/runs",
        status_code=201,
        operation_id="recordPresetRun",
        response_model=PresetRunRecord,
        responses={**_NOT_FOUND, 409: {"model": PresetConflictResponse}},
        openapi_extra={
            "x-ftd-side-effects": "run-record",
            "x-ftd-cost": "none",
            "x-ftd-provenance": "embeds the resolved preset by value",
        },
    )
    def record_preset_run(preset_id: str, body: RecordRunRequest) -> PresetRunRecord:
        try:
            return store.record_run(
                preset_id, run_id=body.runId, outcome=body.outcome, note=body.note
            )
        except PresetNotFound as error:
            raise not_found(preset_id) from error
        except PresetExists as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @router.get(
        "/runs",
        operation_id="listPresetRuns",
        response_model=list[PresetRunRecord],
        openapi_extra={"x-ftd-side-effects": "none", "x-ftd-cost": "none"},
    )
    def list_preset_runs() -> list[PresetRunRecord]:
        return store.list_runs()

    return router
