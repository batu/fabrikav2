"""Revision-bound current-session image capture contracts (R32/F1/AE13)."""

from __future__ import annotations

import struct

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


def _png(width: int, height: int, marker: bytes) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x02\x00\x00\x00" * 2
        + marker
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


def _current_revision(client: TestClient, headers: dict[str, str], session_id: str) -> str:
    response = client.get(f"/api/sessions/{session_id}", headers=headers)
    assert response.status_code == 200
    return response.json()["revision"]


def test_capture_ports_v1_gallery_source_selection_without_derivative_writes(
    editor_settings,
) -> None:
    app = _session_app(editor_settings)
    headers = _headers(app)
    selected = _png(80, 60, b"selected")
    fallback = _png(40, 30, b"fallback")
    with TestClient(app, raise_server_exceptions=False) as client:
        created = client.post(
            "/api/sessions",
            headers=headers,
            json={"session": {"id": "capture", "dogs": [], "selected_bg": 2}},
        )
        assert created.status_code == 201
        session_dir = editor_settings.workspace.authoring / "capture"
        (session_dir / "bg_00.png").write_bytes(fallback)
        (session_dir / "bg_02.png").write_bytes(selected)
        revision = _current_revision(client, headers, "capture")
        locks_before = tuple(editor_settings.workspace.locks.iterdir())

        response = client.post(
            "/api/sessions/capture/capture",
            headers=headers,
            json={"revision": revision, "variant": "gemini_bg_only"},
        )

    assert response.status_code == 200
    assert response.content == selected
    assert response.headers["x-ftd-image-source"] == "bg_02.png"
    assert not (session_dir / ".gallery_previews").exists()
    assert tuple(editor_settings.workspace.locks.iterdir()) == locks_before


def test_capture_rejects_stale_revision_with_the_current_snapshot(editor_settings) -> None:
    app = _session_app(editor_settings)
    headers = _headers(app)
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post(
            "/api/sessions",
            headers=headers,
            json={"session": {"id": "stale-capture", "dogs": []}},
        )
        session_dir = editor_settings.workspace.authoring / "stale-capture"
        (session_dir / "color.png").write_bytes(_png(32, 24, b"current"))
        stale_revision = _current_revision(client, headers, "stale-capture")
        edited = client.post(
            "/api/sessions/stale-capture/gallery-metadata",
            headers=headers,
            json={"revision": stale_revision, "tags": ["newer"]},
        )
        response = client.post(
            "/api/sessions/stale-capture/capture",
            headers=headers,
            json={"revision": stale_revision, "variant": "gemini"},
        )

    assert edited.status_code == 200
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "session_revision_conflict",
        "current": edited.json(),
    }


def test_capture_never_follows_a_session_image_symlink(editor_settings, tmp_path) -> None:
    app = _session_app(editor_settings)
    headers = _headers(app)
    outside = tmp_path / "outside.png"
    outside.write_bytes(_png(32, 24, b"outside-secret"))
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post(
            "/api/sessions",
            headers=headers,
            json={"session": {"id": "symlink-capture", "dogs": []}},
        )
        session_dir = editor_settings.workspace.authoring / "symlink-capture"
        (session_dir / "color.png").symlink_to(outside)
        revision = _current_revision(client, headers, "symlink-capture")
        response = client.post(
            "/api/sessions/symlink-capture/capture",
            headers=headers,
            json={"revision": revision, "variant": "gemini"},
        )

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "session image not found"}
    assert outside.read_bytes().endswith(b"outside-secret")


def test_capture_binary_headers_are_pinned_in_openapi(editor_settings) -> None:
    operation = _session_app(editor_settings).openapi()["paths"][
        "/api/sessions/{session_id}/capture"
    ]["post"]

    success = operation["responses"]["200"]
    assert success["content"]["image/png"]["schema"] == {
        "type": "string",
        "format": "binary",
    }
    assert set(success["headers"]) == {
        "X-FTD-Session-Id",
        "X-FTD-Session-Revision",
        "X-FTD-Image-Source",
        "X-FTD-Image-SHA256",
    }
    assert (
        operation["responses"]["409"]["content"]["application/json"]["schema"][
            "$ref"
        ]
        == "#/components/schemas/SessionRevisionConflictResponse"
    )
