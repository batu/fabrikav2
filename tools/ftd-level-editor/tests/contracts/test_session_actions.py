from __future__ import annotations

from fastapi.testclient import TestClient

from ftd_editor.app import (
    AppComponents,
    EditorStores,
    FailClosedProviders,
    ManualWorker,
    create_app,
)
from ftd_editor.security import CompositionSecrets, SecretRedactor
from ftd_editor.sessions.store import SessionStore


def _session_app(editor_settings):
    store = SessionStore(editor_settings.workspace)
    return create_app(
        editor_settings,
        AppComponents(
            stores=EditorStores(sessions=store),
            worker=ManualWorker(),
            providers=FailClosedProviders(),
            redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
        ),
    )


def _headers(app) -> dict[str, str]:
    return {
        "Host": "testserver",
        "Origin": "http://testserver",
        "X-FTD-Launch-Credential": app.state.launch_credential,
    }


def test_named_current_session_actions_return_revision_conflicts_with_snapshot(
    editor_settings,
) -> None:
    app = _session_app(editor_settings)
    headers = _headers(app)
    with TestClient(app, raise_server_exceptions=False) as client:
        created = client.post(
            "/api/sessions",
            headers=headers,
            json={
                "session": {
                    "id": "api-session",
                    "dogs": [{"index": 0, "id": "dog-a", "activeVariant": None}],
                }
            },
        )
        first = created.json()
        accepted = client.post(
            "/api/sessions/api-session/dogs/dog-a/active-variant",
            headers=headers,
            json={"revision": first["revision"], "activeVariant": 0},
        )
        conflict = client.post(
            "/api/sessions/api-session/dogs/dog-a/active-variant",
            headers=headers,
            json={"revision": first["revision"], "activeVariant": None},
        )

    assert created.status_code == 201
    assert accepted.status_code == 200
    assert conflict.status_code == 409
    detail = conflict.json()["detail"]
    assert detail["code"] == "session_revision_conflict"
    assert detail["current"]["revision"] == accepted.json()["revision"]
    assert detail["current"]["session"]["dogs"][0]["activeVariant"] == 0


def test_route_inventory_has_no_raw_patch_or_import_repair_surface(editor_settings) -> None:
    app = _session_app(editor_settings)
    paths = {route.path for route in app.routes}

    assert "/api/sessions/{session_id}/dogs/{dog_id}/active-variant" in paths
    assert "/api/sessions/{session_id}/gallery-metadata" in paths
    assert not any(
        forbidden in path
        for path in paths
        for forbidden in ("raw-patch", "import", "repair", "archive-resurrection")
    )


def test_session_routes_return_typed_client_failures(editor_settings) -> None:
    app = _session_app(editor_settings)
    headers = _headers(app)
    with TestClient(app, raise_server_exceptions=False) as client:
        missing_id = client.post(
            "/api/sessions", headers=headers, json={"session": {"dogs": []}}
        )
        invalid_id = client.post(
            "/api/sessions", headers=headers, json={"session": {"id": "../bad"}}
        )
        invalid_get = client.get("/api/sessions/%2E%2Ebad", headers=headers)
        missing_dog_action = client.post(
            "/api/sessions/missing/dogs/dog-a/active-variant",
            headers=headers,
            json={"revision": "sha256:missing", "activeVariant": 0},
        )
        missing_gallery_action = client.post(
            "/api/sessions/missing/gallery-metadata",
            headers=headers,
            json={"revision": "sha256:missing"},
        )

    assert missing_id.status_code == 422
    assert invalid_id.status_code == 422
    assert invalid_get.status_code == 422
    assert missing_dog_action.status_code == 404
    assert missing_gallery_action.status_code == 404


def test_revision_conflict_response_is_declared_in_openapi(editor_settings) -> None:
    app = _session_app(editor_settings)

    operation = app.openapi()["paths"][
        "/api/sessions/{session_id}/dogs/{dog_id}/active-variant"
    ]["post"]

    assert "409" in operation["responses"]
    assert (
        operation["responses"]["409"]["content"]["application/json"]["schema"]["$ref"]
        == "#/components/schemas/SessionRevisionConflictResponse"
    )


def test_gallery_metadata_action_updates_shared_session_listing(editor_settings) -> None:
    app = _session_app(editor_settings)
    headers = _headers(app)
    with TestClient(app, raise_server_exceptions=False) as client:
        created = client.post(
            "/api/sessions",
            headers=headers,
            json={"session": {"id": "gallery", "dogs": []}},
        ).json()
        updated = client.post(
            "/api/sessions/gallery/gallery-metadata",
            headers=headers,
            json={
                "revision": created["revision"],
                "tags": ["review", "final"],
                "archived": True,
            },
        )
        gallery = client.get("/api/sessions", headers=headers)

    assert updated.status_code == 200
    assert gallery.status_code == 200
    assert gallery.json() == [
        {
            "session_id": "gallery",
            "revision": updated.json()["revision"],
            "dog_count": 0,
            "tags": ["review", "final"],
            "archived": True,
        }
    ]
