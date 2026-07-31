"""Boot smoke: the composed app serves the catalog against a fresh workspace.

Workspace roots are import-time module state in the forked v1 code, so the
env vars must be set before `levelbuilder` imports — handled in conftest.
"""

from fastapi.testclient import TestClient


def test_config_and_empty_sessions(app_client: TestClient) -> None:
    config = app_client.get("/api/config").json()
    assert "bold_cardboard" in config["styles"]
    assert "isometric_close_20" in config["views"]
    assert "bird" in config["entities"]
    assert config["game"]["name"] == "game"
    assert app_client.get("/api/sessions").json() == []


def test_fresh_workspace_dirs_created(app_client: TestClient, workspace_roots) -> None:
    workspace, game_root = workspace_roots
    assert (workspace / "levels").is_dir()
    assert (game_root / "public" / "levels").is_dir()
