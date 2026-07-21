from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ftd_editor.app import (
    AppComponents,
    EmptyStores,
    FailClosedProviders,
    ManualWorker,
    create_app,
)
from ftd_editor.security import CompositionSecrets, SecretRedactor
from ftd_editor.settings import EditorSettings


CANARY_SECRET = "ftd-canary-secret-8d122253"


@pytest.fixture
def legacy_fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "legacy-v1"
    (root / "state").mkdir(parents=True)
    return root


@pytest.fixture
def editor_settings(tmp_path: Path, legacy_fixture_root: Path) -> EditorSettings:
    return EditorSettings.for_test(
        tmp_path / "target",
        allowed_hosts=("testserver",),
        allowed_origins=("http://testserver",),
        forbidden_roots=(legacy_fixture_root,),
    )


@pytest.fixture
def app_components() -> AppComponents:
    secrets = CompositionSecrets.from_mapping({"provider": CANARY_SECRET})
    return AppComponents(
        stores=EmptyStores(),
        worker=ManualWorker(),
        providers=FailClosedProviders(),
        redactor=SecretRedactor(secrets),
    )


@pytest.fixture
def app(editor_settings: EditorSettings, app_components: AppComponents):
    return create_app(editor_settings, app_components)


@pytest.fixture
def client(app) -> TestClient:
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def launch_credential(app) -> str:
    return app.state.launch_credential


@pytest.fixture
def authorized_headers(launch_credential: str) -> dict[str, str]:
    return {"X-FTD-Launch-Credential": launch_credential}
