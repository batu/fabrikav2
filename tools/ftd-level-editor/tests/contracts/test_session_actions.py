from __future__ import annotations

from fastapi.testclient import TestClient

from ftd_editor.app import AppComponents, FailClosedProviders, ManualWorker, create_app
from ftd_editor.security import CompositionSecrets, SecretRedactor
from ftd_editor.sessions.store import SessionStore


def test_named_current_session_actions_return_revision_conflicts_with_snapshot(
    editor_settings,
) -> None:
    store = SessionStore(editor_settings.workspace)
    components = AppComponents(
        stores=store,
        worker=ManualWorker(),
        providers=FailClosedProviders(),
        redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
    )
    app = create_app(editor_settings, components)
    headers = {
        "Host": "testserver",
        "Origin": "http://testserver",
        "X-FTD-Launch-Credential": app.state.launch_credential,
    }
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
    store = SessionStore(editor_settings.workspace)
    app = create_app(
        editor_settings,
        AppComponents(
            stores=store,
            worker=ManualWorker(),
            providers=FailClosedProviders(),
            redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
        ),
    )
    paths = {route.path for route in app.routes}

    assert "/api/sessions/{session_id}/dogs/{dog_id}/active-variant" in paths
    assert "/api/sessions/{session_id}/gallery-metadata" in paths
    assert not any(
        forbidden in path
        for path in paths
        for forbidden in ("raw-patch", "import", "repair", "archive-resurrection")
    )
