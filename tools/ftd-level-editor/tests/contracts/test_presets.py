from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from ftd_editor.app import (
    AppComponents,
    EditorStores,
    FailClosedProviders,
    ManualWorker,
    create_app,
)
from ftd_editor.presets.store import PresetStore, seed_default_presets
from ftd_editor.security import CompositionSecrets, SecretRedactor


def _preset_app(editor_settings):
    store = PresetStore(editor_settings.workspace.state / "presets")
    seed_default_presets(store)
    return create_app(
        editor_settings,
        AppComponents(
            stores=EditorStores(presets=store),
            worker=ManualWorker(),
            providers=FailClosedProviders(),
            redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
        ),
    ), store


def _headers(app) -> dict[str, str]:
    return {
        "Host": "testserver",
        "Origin": "http://testserver",
        "X-FTD-Launch-Credential": app.state.launch_credential,
    }


def test_index_serves_presets_and_every_dropdown_vocabulary(editor_settings):
    app, _ = _preset_app(editor_settings)
    with TestClient(app) as client:
        response = client.get("/api/presets", headers=_headers(app))
    assert response.status_code == 200
    body = response.json()
    assert [preset["id"] for preset in body["presets"]] == ["spot-the-bird-lineart"]

    options = body["options"]
    # The dropdowns are driven by the frozen catalog, never by a second list.
    assert "lineart" in options["styles"]
    assert "bird" in options["entities"]
    assert "isometric" in options["views"]
    assert "japan_morning_market" in options["scenes"]
    assert any(option["id"].startswith("google/") for option in options["models"])


def test_resolution_pins_catalog_text_and_a_digest(editor_settings):
    app, _ = _preset_app(editor_settings)
    with TestClient(app) as client:
        response = client.get(
            "/api/presets/spot-the-bird-lineart/resolved", headers=_headers(app)
        )
    assert response.status_code == 200
    resolved = response.json()
    assert resolved["selection"]["style"] == "lineart"
    assert "coloring book" in resolved["scenePrompt"]
    assert "bird" in resolved["entityPrompt"]
    assert len(resolved["catalogSha256"]) == 64
    assert len(resolved["digest"]) == 64


def test_editing_a_preset_never_rewrites_a_recorded_run(editor_settings):
    """The point of the by-value snapshot: provenance survives preset edits."""
    app, _ = _preset_app(editor_settings)
    with TestClient(app) as client:
        headers = _headers(app)
        recorded = client.post(
            "/api/presets/spot-the-bird-lineart/runs",
            json={"runId": "run-0001", "outcome": "succeeded"},
            headers=headers,
        )
        assert recorded.status_code == 201
        before = recorded.json()
        assert before["presetVersion"] == 1
        assert before["resolved"]["selection"]["scene"] == "japan_morning_market"

        bumped = client.post(
            "/api/presets/spot-the-bird-lineart/selection",
            json={
                "selection": {
                    "scene": "france_montmartre_cafe_terrace",
                    "view": "isometric",
                    "style": "lineart",
                    "entity": "bird",
                    "model": "google/gemini-3.1-flash-image-preview",
                }
            },
            headers=headers,
        )
        assert bumped.status_code == 200
        assert bumped.json()["version"] == 2

        runs = client.get("/api/presets/runs", headers=headers).json()

    assert len(runs) == 1
    after = runs[0]
    assert after["presetVersion"] == 1
    assert after["resolved"]["selection"]["scene"] == "japan_morning_market"
    assert after["digest"] == before["digest"]


def test_replaying_a_run_id_returns_the_original_record(editor_settings):
    app, _ = _preset_app(editor_settings)
    with TestClient(app) as client:
        headers = _headers(app)
        first = client.post(
            "/api/presets/spot-the-bird-lineart/runs",
            json={"runId": "run-dup"},
            headers=headers,
        ).json()
        second = client.post(
            "/api/presets/spot-the-bird-lineart/runs",
            json={"runId": "run-dup"},
            headers=headers,
        )
    assert second.status_code == 201
    assert second.json()["createdAt"] == first["createdAt"]


def test_a_selection_outside_the_frozen_catalog_is_refused(editor_settings):
    app, _ = _preset_app(editor_settings)
    with TestClient(app) as client:
        response = client.post(
            "/api/presets",
            json={
                "id": "invented",
                "label": "Invented",
                "selection": {
                    "scene": "no_such_scene",
                    "view": "isometric",
                    "style": "lineart",
                    "entity": "bird",
                    "model": "google/gemini-3.1-flash-image-preview",
                },
            },
            headers=_headers(app),
        )
    assert response.status_code == 422
    assert "frozen catalog identifier" in response.json()["detail"]


def test_unknown_preset_is_not_found(editor_settings):
    app, _ = _preset_app(editor_settings)
    with TestClient(app) as client:
        response = client.get("/api/presets/nope/resolved", headers=_headers(app))
    assert response.status_code == 404
    assert response.json()["detail"] == "preset not found"


def test_preset_routes_are_absent_when_composition_omits_the_store(editor_settings):
    app = create_app(
        editor_settings,
        AppComponents(
            stores=EditorStores(),
            worker=ManualWorker(),
            providers=FailClosedProviders(),
            redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
        ),
    )
    assert not [route for route in app.routes if "/api/presets" in getattr(route, "path", "")]


@pytest.mark.parametrize("path", ["/api/presets", "/api/presets/runs"])
def test_preset_routes_require_the_launch_credential(editor_settings, path):
    app, _ = _preset_app(editor_settings)
    with TestClient(app) as client:
        response = client.get(path, headers={"Host": "testserver", "Origin": "http://testserver"})
    assert response.status_code in (401, 403)
