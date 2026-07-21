from __future__ import annotations

import hashlib
import importlib
import json
import os
import pkgutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import ftd_editor
from ftd_editor.app import FailClosedProviderError
from ftd_editor.settings import EditorSettings, SettingsError


FIXTURE = Path(__file__).parents[1] / "fixtures" / "pure-ftd-parity.json"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_test_lifespan_cannot_open_or_modify_legacy_ledger(
    app,
    legacy_fixture_root: Path,
    authorized_headers: dict[str, str],
) -> None:
    ledger = legacy_fixture_root / "state" / "jobs.sqlite"
    connection = sqlite3.connect(ledger)
    connection.execute("create table jobs (id text primary key, status text not null)")
    connection.execute("insert into jobs values ('legacy-queued', 'queued')")
    connection.commit()
    connection.close()
    before = _sha256(ledger)

    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.get("/api/status", headers=authorized_headers)

        assert response.status_code == 200
        assert _sha256(ledger) == before
    assert _sha256(ledger) == before
    connection = sqlite3.connect(ledger)
    assert connection.execute("select id, status from jobs").fetchall() == [
        ("legacy-queued", "queued")
    ]
    connection.close()
    assert not (legacy_fixture_root / "state" / "jobs.worker.lock").exists()


def test_every_test_root_is_below_one_disposable_root(editor_settings: EditorSettings) -> None:
    root = editor_settings.workspace.root
    for path in editor_settings.workspace.operational_roots():
        assert path.is_relative_to(root)


def test_settings_reject_a_legacy_or_ambient_root(
    tmp_path: Path,
    legacy_fixture_root: Path,
) -> None:
    with pytest.raises(SettingsError, match="forbidden root"):
        EditorSettings.for_test(
            tmp_path / "target",
            authoring_root=legacy_fixture_root / "levels",
            forbidden_roots=(legacy_fixture_root,),
        )


def test_non_loopback_bind_requires_explicit_secure_remote_settings(tmp_path: Path) -> None:
    with pytest.raises(SettingsError, match="loopback"):
        EditorSettings.for_development(tmp_path / "target", bind_host="0.0.0.0")

    with pytest.raises(SettingsError, match="remote mode is not implemented"):
        EditorSettings.for_production(tmp_path / "production", bind_host="0.0.0.0")


def test_importing_every_module_has_no_composition_side_effects(tmp_path: Path) -> None:
    script = """
import builtins
import io
import json
import multiprocessing
import os
import pkgutil
import socket
import sqlite3
import subprocess
import threading
from pathlib import Path
import ftd_editor

def forbidden(action):
    def fail(*args, **kwargs):
        raise AssertionError(f'import attempted {action}')
    return fail

original_builtin_open = builtins.open
original_io_open = io.open
original_os_open = os.open

def guarded_builtin_open(file, mode='r', *args, **kwargs):
    if any(flag in mode for flag in ('w', 'a', 'x', '+')):
        raise AssertionError(f'import attempted file write: {file}')
    return original_builtin_open(file, mode, *args, **kwargs)

def guarded_io_open(file, mode='r', *args, **kwargs):
    if any(flag in mode for flag in ('w', 'a', 'x', '+')):
        raise AssertionError(f'import attempted file write: {file}')
    return original_io_open(file, mode, *args, **kwargs)

def guarded_os_open(file, flags, *args, **kwargs):
    write_flags = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND
    if flags & write_flags:
        raise AssertionError(f'import attempted file write: {file}')
    return original_os_open(file, flags, *args, **kwargs)

builtins.open = guarded_builtin_open
io.open = guarded_io_open
os.open = guarded_os_open
os.mkdir = forbidden('directory creation')
os.makedirs = forbidden('directory creation')
sqlite3.connect = forbidden('SQLite connection')
socket.socket.bind = forbidden('socket bind')
socket.socket.connect = forbidden('socket connect')
subprocess.Popen = forbidden('child process')
threading.Thread.start = forbidden('thread start')
multiprocessing.Process.start = forbidden('process start')

before = {thread.ident for thread in threading.enumerate()}
for module in pkgutil.walk_packages(ftd_editor.__path__, ftd_editor.__name__ + '.'):
    __import__(module.name)
after = {thread.ident for thread in threading.enumerate()}
from ftd_editor import app
print(json.dumps({
    'new_threads': sorted(str(item) for item in after - before),
    'has_global_app': hasattr(app, 'app'),
    'cwd_entries': sorted(path.name for path in Path.cwd().iterdir()),
}))
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    assert result.stderr == ""
    assert result.stdout.strip() == (
        '{"new_threads": [], "has_global_app": false, "cwd_entries": []}'
    )


def test_default_provider_registry_fails_closed(app_components) -> None:
    with pytest.raises(FailClosedProviderError, match="scripted provider"):
        app_components.providers.require("image-generation")


def test_package_walk_does_not_expose_legacy_imports() -> None:
    names = {
        module.name
        for module in pkgutil.walk_packages(ftd_editor.__path__, ftd_editor.__name__ + ".")
    }
    for name in names:
        module = importlib.import_module(name)
        assert "/fabrika/" not in str(getattr(module, "__file__", ""))


def test_openapi_and_route_inventory_are_frozen(app) -> None:
    expected = json.loads(FIXTURE.read_text())["appContract"]
    routes = sorted(
        (
            {
            "path": route.path,
            "methods": sorted(route.methods or ()),
            "operationId": getattr(route, "operation_id", None),
            }
        for route in app.routes
        ),
        key=lambda route: (route["path"], route["methods"]),
    )
    openapi_document = app.openapi()
    assert openapi_document["components"]["securitySchemes"]["LaunchCredential"] == {
        "type": "apiKey",
        "in": "header",
        "name": "X-FTD-Launch-Credential",
    }
    assert openapi_document["paths"]["/api/status"]["get"]["security"] == [
        {"LaunchCredential": []}
    ]
    openapi = json.dumps(openapi_document, sort_keys=True, separators=(",", ":"))
    actual = {
        "routes": routes,
        "openapiSha256": hashlib.sha256(openapi.encode()).hexdigest(),
    }
    assert actual == expected
