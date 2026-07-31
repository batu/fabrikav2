"""Filesystem authority for presets and their immutable run records.

Presets are small, human-edited configuration; the session store's tree-hash
compare-and-swap would be overkill, but writes still go through the shared
atomic helpers so a crash cannot leave a torn file.

Run records are append-only and never rewritten. That is the whole point of
storing the resolved preset by value: a preset edit must not be able to change
what a past run reports.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

from ..fs import atomic_write_json, ensure_durable_directory
from ..models.options import ModelOption, ProviderCapabilities, available_model_options
from ..prompts.recipes import CONTENTS, STYLES, VIEWS
from .model import (
    CatalogOptions,
    PresetRecord,
    PresetRunRecord,
    PresetSelection,
    ResolvedPreset,
    UnknownCatalogKey,
    entity_vocabulary,
    resolve,
)


class PresetNotFound(LookupError):
    """No preset is stored under that identifier."""


class PresetExists(ValueError):
    """A preset already exists under that identifier."""


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class PresetStore:
    def __init__(
        self,
        root: Path,
        *,
        capabilities: ProviderCapabilities | None = None,
        now: Callable[[], str] | None = None,
    ) -> None:
        self._root = ensure_durable_directory(Path(root))
        self._presets = ensure_durable_directory(self._root / "presets")
        self._runs = ensure_durable_directory(self._root / "runs")
        self._capabilities = capabilities or ProviderCapabilities()
        self._now = now or _utc_now

    # -- catalog vocabularies -------------------------------------------------

    def _model_options(self) -> tuple[ModelOption, ...]:
        return available_model_options(self._capabilities)["background"]

    def model_ids(self) -> frozenset[str]:
        return frozenset(option.id for option in self._model_options())

    def catalog_options(self) -> CatalogOptions:
        return CatalogOptions(
            scenes=sorted(CONTENTS),
            views=sorted(VIEWS),
            styles=sorted(STYLES),
            entities=sorted(entity_vocabulary()),
            models=[
                {"id": option.id, "label": option.label}
                for option in self._model_options()
            ],
        )

    # -- presets --------------------------------------------------------------

    def _path(self, preset_id: str) -> Path:
        return self._presets / f"{preset_id}.json"

    def list(self) -> list[PresetRecord]:
        records = []
        for path in sorted(self._presets.glob("*.json")):
            records.append(PresetRecord.model_validate(json.loads(path.read_text())))
        return records

    def get(self, preset_id: str) -> PresetRecord:
        path = self._path(preset_id)
        if not path.exists():
            raise PresetNotFound(preset_id)
        return PresetRecord.model_validate(json.loads(path.read_text()))

    def create(self, preset: PresetRecord) -> PresetRecord:
        if self._path(preset.id).exists():
            raise PresetExists(preset.id)
        self._validate(preset.selection)
        atomic_write_json(self._path(preset.id), preset.model_dump())
        return preset

    def update_selection(self, preset_id: str, selection: PresetSelection) -> PresetRecord:
        """Bump the version. Past runs keep their own by-value snapshot."""
        current = self.get(preset_id)
        self._validate(selection)
        updated = current.model_copy(
            update={"selection": selection, "version": current.version + 1}
        )
        atomic_write_json(self._path(preset_id), updated.model_dump())
        return updated

    def resolve(self, preset_id: str) -> ResolvedPreset:
        return resolve(self.get(preset_id))

    def _validate(self, selection: PresetSelection) -> None:
        from .model import validate_selection

        validate_selection(selection, self.model_ids())

    # -- runs -----------------------------------------------------------------

    def record_run(
        self,
        preset_id: str,
        *,
        run_id: str,
        outcome: str = "recorded",
        note: str = "",
    ) -> PresetRunRecord:
        resolved = self.resolve(preset_id)
        record = PresetRunRecord(
            runId=run_id,
            presetId=resolved.presetId,
            presetVersion=resolved.presetVersion,
            digest=resolved.digest,
            resolved=resolved,
            createdAt=self._now(),
            outcome=outcome,
            note=note,
        )
        path = self._runs / f"{run_id}.json"
        if path.exists():
            existing = PresetRunRecord.model_validate(json.loads(path.read_text()))
            if existing.digest != record.digest:
                raise PresetExists(f"run {run_id} already recorded with a different digest")
            return existing
        atomic_write_json(path, record.model_dump())
        return record

    def list_runs(self) -> list[PresetRunRecord]:
        records = []
        for path in sorted(self._runs.glob("*.json")):
            records.append(PresetRunRecord.model_validate(json.loads(path.read_text())))
        return records

    def get_run(self, run_id: str) -> PresetRunRecord:
        path = self._runs / f"{run_id}.json"
        if not path.exists():
            raise PresetNotFound(run_id)
        return PresetRunRecord.model_validate(json.loads(path.read_text()))


def seed_default_presets(store: PresetStore) -> list[PresetRecord]:
    """Install the starter presets, skipping any that already exist."""

    defaults = [
        PresetRecord(
            id="spot-the-bird-lineart",
            version=1,
            label="Spot The Bird — line art",
            selection=PresetSelection(
                scene="japan_morning_market",
                view="isometric",
                style="lineart",
                entity="bird",
                model="google/gemini-3.1-flash-image-preview",
            ),
            notes=(
                "Coloring-book line art with hidden birds. Style measured at 79.7 against an "
                "86 reference-set ceiling; model choice moved the score 24 points while three "
                "isolated prompt-wording edits moved nothing beyond noise."
            ),
        ),
    ]
    created = []
    for preset in defaults:
        try:
            created.append(store.create(preset))
        except (PresetExists, UnknownCatalogKey):
            continue
    return created
