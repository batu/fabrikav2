import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="level-editor-tests-"))
_WORKSPACE = _TMP / ".levelbuilder"
_GAME_ROOT = _TMP / "game"
# Must precede any levelbuilder import: the forked v1 modules resolve their
# roots at import time from these variables.
os.environ["LEVELBUILDER_WORKSPACE"] = str(_WORKSPACE)
os.environ["LEVELBUILDER_GAME_ROOT"] = str(_GAME_ROOT)


@pytest.fixture(scope="session")
def workspace_roots() -> tuple[Path, Path]:
    return _WORKSPACE, _GAME_ROOT


@pytest.fixture(scope="session")
def app_client():
    from fastapi.testclient import TestClient
    from levelbuilder.api.server import app

    with TestClient(app) as client:
        yield client


@pytest.fixture
def isolated_session(tmp_path, monkeypatch):
    """Ported from fabrika's suite: point session module at a tmp dir."""
    import levelbuilder.api.session as sessmod

    levels_dir = tmp_path / "levels"
    levels_dir.mkdir()
    # Match the production layout (<game>/public/levels): catalog asset paths
    # are "levels/<id>/..." and resolve against the public root's PARENT, so
    # the directory must be literally named "levels" under a parent dir —
    # the old flat "public_levels" name made verification resolve into the
    # sessions dir by coincidence.
    public_levels = tmp_path / "public" / "levels"
    public_levels.mkdir(parents=True)
    monkeypatch.setattr(sessmod, "LEVELS_DIR", levels_dir)
    monkeypatch.setattr(sessmod, "GAME_PUBLIC_LEVELS", public_levels)
    monkeypatch.setattr(sessmod, "GAME_LEVELS_INDEX", public_levels / "levels-index.json")
    return sessmod
