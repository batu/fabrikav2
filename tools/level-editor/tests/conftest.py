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
    monkeypatch.setattr(
        sessmod,
        "ARCHIVE_LEDGER_PATH",
        tmp_path / "state" / "archive-ledger.json",
        raising=False,
    )
    return sessmod


def materialize_snapshot_assets(root: Path, snapshot: dict) -> None:
    """FF-1: commits verify referenced bytes on disk. Write each descriptor's file
    with deterministic content and stamp the descriptor with the true digest, keeping
    provenance couplings (restore scene sha, cleanup sprite sha) intact."""
    import hashlib

    seen: dict[str, bytes] = {}

    def _fix(descriptor: dict) -> None:
        path = root / descriptor["path"]
        if descriptor["path"] not in seen:
            path.parent.mkdir(parents=True, exist_ok=True)
            data = f"asset:{descriptor['path']}".encode()
            path.write_bytes(data)
            seen[descriptor["path"]] = data
        data = seen[descriptor["path"]]
        descriptor["sha256"] = hashlib.sha256(data).hexdigest()
        descriptor["bytes"] = len(data)

    _fix(snapshot["assets"]["scene"])
    _fix(snapshot["assets"]["cleanBackground"])
    _fix(snapshot["restore"]["asset"])
    snapshot["restore"]["sourceSceneSha256"] = snapshot["assets"]["scene"]["sha256"]
    for bird in snapshot["birds"]:
        _fix(bird["sprite"]["asset"])
        bird["activeGeneration"]["inputSceneSha256"] = snapshot["assets"]["scene"]["sha256"]
        bird["cleanup"]["sourceSpriteSha256"] = bird["sprite"]["asset"]["sha256"]


def restamp_snapshot_assets(root: Path, snapshot: dict) -> None:
    """Recompute descriptor sha256/bytes from the files currently on disk (for tests
    that overwrite fixture assets with real images after the initial commit)."""
    import hashlib

    def _stamp(descriptor: dict) -> None:
        data = (root / descriptor["path"]).read_bytes()
        descriptor["sha256"] = hashlib.sha256(data).hexdigest()
        descriptor["bytes"] = len(data)

    _stamp(snapshot["assets"]["scene"])
    _stamp(snapshot["assets"]["cleanBackground"])
    _stamp(snapshot["restore"]["asset"])
    snapshot["restore"]["sourceSceneSha256"] = snapshot["assets"]["scene"]["sha256"]
    for bird in snapshot["birds"]:
        _stamp(bird["sprite"]["asset"])
        bird["activeGeneration"]["inputSceneSha256"] = snapshot["assets"]["scene"]["sha256"]
        bird["cleanup"]["sourceSpriteSha256"] = bird["sprite"]["asset"]["sha256"]
