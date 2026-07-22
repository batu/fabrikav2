"""U7 route-inventory contract over the pinned OpenAPI document.

One discoverable HTTP surface: unique operations, stable-ID path identity,
no compatibility duplicates, no archive-import/resurrection surface, and
x-ftd extensions on every operation so a fresh client needs no second
catalog.
"""

from __future__ import annotations

import json
from pathlib import Path

from ftd_editor.contracts import openapi_document
from ftd_editor.jobs.actions import FTD_ACTION_KINDS

PINNED = Path(__file__).resolve().parents[2] / "openapi.json"

FORBIDDEN_PATH_WORDS = ("import", "archive", "resurrect", "repair", "raw-patch", "legacy")
FORBIDDEN_PATH_PARAMS = ("{index}", "{dog_index}", "{position}")


def _operations() -> list[tuple[str, str, dict]]:
    document = openapi_document()
    return [
        (method.upper(), path, operation)
        for path, methods in document["paths"].items()
        for method, operation in methods.items()
        if method in ("get", "post", "put", "patch", "delete")
    ]


def test_every_operation_id_is_unique_and_no_duplicate_route_exists() -> None:
    operations = _operations()
    operation_ids = [op.get("operationId") for _, _, op in operations]
    assert all(operation_ids), "every route must carry an operationId"
    assert len(operation_ids) == len(set(operation_ids))
    keys = [(method, path) for method, path, _ in operations]
    assert len(keys) == len(set(keys))


def test_no_archive_import_or_index_identity_surface() -> None:
    for method, path, _ in _operations():
        lowered = path.lower()
        for word in FORBIDDEN_PATH_WORDS:
            assert word not in lowered, f"{method} {path} exposes forbidden surface {word!r}"
        for param in FORBIDDEN_PATH_PARAMS:
            assert param not in path, f"{method} {path} uses index identity"


def test_every_operation_carries_cost_and_side_effect_extensions() -> None:
    for method, path, operation in _operations():
        assert "x-ftd-cost" in operation, f"{method} {path} lacks x-ftd-cost"
        assert "x-ftd-side-effects" in operation, f"{method} {path} lacks x-ftd-side-effects"


def test_action_catalog_lives_only_in_the_pinned_start_operation_extension() -> None:
    document = json.loads(PINNED.read_text(encoding="utf-8"))
    start = document["paths"]["/api/jobs/actions/{kind}"]["post"]
    catalog = start["x-ftd-actions"]
    assert [entry["kind"] for entry in catalog] == [
        action.kind for action in FTD_ACTION_KINDS
    ]
    for entry, action in zip(catalog, FTD_ACTION_KINDS):
        assert entry == action.discovery_entry()
    prompt_intents = {
        entry["kind"]: entry["intentInput"]
        for entry in catalog
        if "intentInput" in entry
    }
    assert prompt_intents == {
        "ftd.background_generate": "sceneIntent",
        "ftd.crop_inpaint": "dogIntent",
        "ftd.retry_failed_dogs": "dogs[].dogIntent",
        "ftd.band_generate": "sceneIntent",
        "ftd.sequence_workflow": "scenes[]",
        "ftd.multi_scene_generate": "scenes[]",
        "ftd.magenta_inpaint": "dogIntent",
        "ftd.dog_regenerate": "dogIntent",
    }
    # No second catalog: the extension is the only place kinds are enumerated.
    others = [
        (method, path)
        for method, path, operation in _operations()
        if "x-ftd-actions" in operation and path != "/api/jobs/actions/{kind}"
    ]
    assert not others
