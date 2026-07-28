"""Regressions for the 2026-07-29 review findings."""

import json
import os

import pytest

from levelbuilder.api import server
from levelbuilder.settings import UnknownGameError, apply_game_from_env


def test_revision_middleware_added_before_auth() -> None:
    # Starlette makes the LAST-added middleware outermost; auth must wrap the
    # revision stamper, or 401s leak session existence + mtime.
    names = [m.cls.__name__ for m in server.app.user_middleware]
    assert names.index("_TokenAuthMiddleware") < names.index("_SessionRevisionMiddleware")


@pytest.mark.parametrize("path_id", ["..%2F..%2Fetc", "../../etc", "a/b", "x" * 200])
def test_revision_middleware_rejects_unsafe_session_ids(path_id: str) -> None:
    assert server._SESSION_ID_SAFE.fullmatch(path_id) is None


def test_revision_header_absent_on_error_response(app_client) -> None:
    response = app_client.get("/api/sessions/nonexistent_session_zz")
    assert "X-Session-Revision" not in response.headers


def test_env_chain_stops_above_repo_root(tmp_path) -> None:
    repo = tmp_path / "base" / "repo"
    tool = repo / "tools" / "level-editor"
    tool.mkdir(parents=True)
    (repo / ".git").mkdir()
    chain = [str(p) for p in server._env_chain(tool)]
    assert str(tmp_path / "base" / ".env") in chain
    assert str(tmp_path / ".env") not in chain
    assert str(tmp_path.parent / ".env") not in chain


def test_partial_workspace_env_is_an_error(monkeypatch) -> None:
    monkeypatch.setenv("LEVELBUILDER_WORKSPACE", "/tmp/ws-only")
    monkeypatch.delenv("LEVELBUILDER_GAME_ROOT", raising=False)
    monkeypatch.delenv("LEVEL_EDITOR_GAME", raising=False)
    with pytest.raises(UnknownGameError) as excinfo:
        apply_game_from_env()
    assert "LEVELBUILDER_GAME_ROOT" in str(excinfo.value)


def test_bundle_refuses_uninstalled_package(app_client) -> None:
    response = app_client.post("/api/sessions/never_exported_zz01/bundle")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "package_not_installed"


def test_approve_requires_request_id(app_client) -> None:
    response = app_client.post("/api/sessions/some_session_zz01/approve-catalog")
    assert response.status_code == 422


def test_corpus_validator_skips_staging_dirs(tmp_path) -> None:
    from levelbuilder.api.export_gate import validate_corpus

    root = tmp_path / "levels"
    staging = root / ".catalog-staging-abc"
    staging.mkdir(parents=True)
    (staging / "level.json").write_text("{not even json")
    summary = validate_corpus(root)
    assert summary["levels"] == 0
