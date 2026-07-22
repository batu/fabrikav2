"""AE12 action parity: UI-shaped and OpenAPI-discovered clients get the same
unpaid stable-ID edit facts, and stable IDs survive dog reorder.

The "UI" client mirrors exactly the wire shape the React transport emits
(the derived `ui/src/api/generated.ts` types over these operations); the
"fresh" client knows nothing but the pinned `openapi.json` — it resolves
paths, methods, and request property names from the document alone.
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

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

PINNED = Path(__file__).resolve().parents[2] / "openapi.json"


def _png(width: int = 32, height: int = 24) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x02\x00\x00\x00" * 2
    )


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


def _create(client, headers, session_id: str, dogs: list[dict]) -> dict:
    response = client.post(
        "/api/sessions", headers=headers, json={"session": {"id": session_id, "dogs": dogs}}
    )
    assert response.status_code == 201
    return response.json()


DOGS = [
    {"index": 0, "id": "dog-a", "activeVariant": None},
    {"index": 1, "id": "dog-b", "activeVariant": None},
]


def _operation(document: dict, operation_id: str) -> tuple[str, str, dict]:
    for path, methods in document["paths"].items():
        for method, operation in methods.items():
            if operation.get("operationId") == operation_id:
                return method, path, operation
    raise AssertionError(f"operation {operation_id} not in pinned document")


def test_ui_shaped_and_openapi_discovered_clients_receive_equivalent_edit_facts(
    editor_settings,
) -> None:
    document = json.loads(PINNED.read_text(encoding="utf-8"))
    app = _session_app(editor_settings)
    headers = _headers(app)
    with TestClient(app, raise_server_exceptions=False) as client:
        ui_session = _create(client, headers, "ui-session", DOGS)
        fresh_session = _create(client, headers, "fresh-session", DOGS)

        # UI-shaped client: the exact wire body the React transport sends.
        ui_response = client.post(
            "/api/sessions/ui-session/dogs/dog-b/active-variant",
            headers=headers,
            json={"revision": ui_session["revision"], "activeVariant": 1},
        )

        # Fresh client: everything derived from the pinned OpenAPI document.
        method, path_template, _ = _operation(document, "setCurrentSessionDogActiveVariant")
        path = path_template.format(session_id="fresh-session", dog_id="dog-b")
        fresh_response = client.request(
            method.upper(),
            path,
            headers=headers,
            json={"revision": fresh_session["revision"], "activeVariant": 1},
        )

        # A stale replay must fail with the same validation contract for both.
        ui_conflict = client.post(
            "/api/sessions/ui-session/dogs/dog-b/active-variant",
            headers=headers,
            json={"revision": ui_session["revision"], "activeVariant": 0},
        )
        fresh_conflict = client.request(
            method.upper(),
            path,
            headers=headers,
            json={"revision": fresh_session["revision"], "activeVariant": 0},
        )

    assert ui_response.status_code == fresh_response.status_code == 200
    ui_body, fresh_body = ui_response.json(), fresh_response.json()
    assert set(ui_body) == set(fresh_body) == {"sessionId", "revision", "session", "provenance"}
    assert ui_body["session"]["dogs"] == fresh_body["session"]["dogs"]
    assert ui_body["revision"] != ui_session["revision"]
    assert ui_conflict.status_code == fresh_conflict.status_code == 409
    assert (
        ui_conflict.json()["detail"]["code"]
        == fresh_conflict.json()["detail"]["code"]
        == "session_revision_conflict"
    )


def test_fresh_client_completes_unpaid_edit_and_capture_from_pinned_extensions(
    editor_settings,
) -> None:
    document = json.loads(PINNED.read_text(encoding="utf-8"))
    app = _session_app(editor_settings)
    headers = _headers(app)
    with TestClient(app, raise_server_exceptions=False) as client:
        _create(client, headers, "discover", DOGS)
        image = _png()
        (editor_settings.workspace.authoring / "discover" / "color.png").write_bytes(
            image
        )

        snapshot_method, snapshot_path, _ = _operation(document, "getCurrentSession")
        current = client.request(
            snapshot_method.upper(),
            snapshot_path.format(session_id="discover"),
            headers=headers,
        ).json()

        method, path_template, operation = _operation(
            document, "updateCurrentSessionGalleryMetadata"
        )
        assert operation["x-ftd-cost"] == "none"
        assert operation["x-ftd-revision"] == "bound"
        edited = client.request(
            method.upper(),
            path_template.format(session_id="discover"),
            headers=headers,
            json={"revision": current["revision"], "tags": ["ready"]},
        )

        capture_method, capture_path, capture_op = _operation(
            document, "captureCurrentSessionImage"
        )
        assert capture_op["x-ftd-side-effects"] == "none"
        assert capture_op["x-ftd-cost"] == "none"
        assert capture_op["x-ftd-revision"] == "bound"
        assert capture_op["x-ftd-artifacts"] == "inline-image"
        captured = client.request(
            capture_method.upper(),
            capture_path.format(session_id="discover"),
            headers=headers,
            json={"revision": edited.json()["revision"], "variant": "gemini"},
        )

    assert edited.status_code == 200
    assert captured.status_code == 200
    assert captured.content == image
    assert captured.headers["content-type"] == "image/png"
    assert captured.headers["x-ftd-session-id"] == "discover"
    assert captured.headers["x-ftd-session-revision"] == edited.json()["revision"]
    assert captured.headers["x-ftd-image-source"] == "color.png"
    assert captured.headers["x-ftd-image-sha256"] == (
        f"sha256:{hashlib.sha256(image).hexdigest()}"
    )

    # Paid actions are discoverable from the same document's extension —
    # there is no second catalog endpoint anywhere in the surface.
    start = document["paths"]["/api/jobs/actions/{kind}"]["post"]
    kinds = [entry["kind"] for entry in start["x-ftd-actions"]]
    assert "ftd.magenta_inpaint" in kinds


def test_stable_id_operations_survive_dog_reorder(editor_settings) -> None:
    app = _session_app(editor_settings)
    headers = _headers(app)
    reordered = [
        {"index": 0, "id": "dog-b", "activeVariant": None},
        {"index": 1, "id": "dog-a", "activeVariant": None},
    ]
    with TestClient(app, raise_server_exceptions=False) as client:
        created = _create(client, headers, "reordered", reordered)
        response = client.post(
            "/api/sessions/reordered/dogs/dog-a/active-variant",
            headers=headers,
            json={"revision": created["revision"], "activeVariant": 2},
        )

    assert response.status_code == 200
    dogs = {dog["id"]: dog for dog in response.json()["session"]["dogs"]}
    assert dogs["dog-a"]["activeVariant"] == 2
    assert dogs["dog-b"]["activeVariant"] is None
