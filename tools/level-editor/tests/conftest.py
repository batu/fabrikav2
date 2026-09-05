import os
import re
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
import dotenv

# Install before ANY editor/provider import, including collection-time imports.
# Tests use scripted providers and in-process ASGI clients; an unexpected attempt
# must fail the suite even if application error handling catches the exception.
_UNEXPECTED_EXTERNAL_CALLS: list[str] = []
_isolation = pytest.MonkeyPatch()
_isolation.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: False)
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
for _key in list(os.environ):
    if re.search(r"(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", _key):
        os.environ.pop(_key)

_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex


def _guard_connect(original):
    def connect(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            _UNEXPECTED_EXTERNAL_CALLS.append("network connection")
            raise RuntimeError("Editor tests prohibit network connections; inject a transport")
        return original(sock, address)
    return connect


_isolation.setattr(socket.socket, "connect", _guard_connect(_connect))
_isolation.setattr(socket.socket, "connect_ex", _guard_connect(_connect_ex))
_popen = subprocess.Popen


def _guard_popen(args, *positional, **kwargs):
    # Frozen golden fixtures deliberately read a pinned historical sprite.
    git_read = isinstance(args, (list, tuple)) and (
        (len(args) == 5 and args[:2] == ["git", "-C"] and args[3:] == ["rev-parse", "--show-toplevel"])
        or (len(args) == 3 and args[:2] == ["git", "show"] and re.match(r"^[0-9a-f]{40}:games/find_the_bird/public/levels/", args[2]))
    )
    # The security regression launches only this exact import-failure probe.
    # Allowing arbitrary Python would bypass this process's socket guard.
    import_probe = args == [sys.executable, "-c", "import levelbuilder.api.session"]
    # Real provider/model CLIs and shell commands have no place in this suite.
    if (not import_probe and not git_read) or kwargs.get("shell"):
        _UNEXPECTED_EXTERNAL_CALLS.append("external subprocess")
        raise RuntimeError("Editor tests prohibit external CLIs; inject a runner")
    return _popen(args, *positional, **kwargs)


_isolation.setattr(subprocess, "Popen", _guard_popen)

_TMP = Path(tempfile.mkdtemp(prefix="level-editor-tests-"))
_WORKSPACE = _TMP / ".levelbuilder"
_GAME_ROOT = _TMP / "game"
# Must precede any levelbuilder import: the forked v1 modules resolve their
# roots at import time from these variables.
os.environ["LEVELBUILDER_WORKSPACE"] = str(_WORKSPACE)
os.environ["LEVELBUILDER_GAME_ROOT"] = str(_GAME_ROOT)
os.environ["MERCEKA_COST_LEDGER"] = str(_TMP / "costs.jsonl")
os.environ["FTD_GALLERY_PREWARM"] = "0"


def pytest_sessionfinish(session, exitstatus):
    if _UNEXPECTED_EXTERNAL_CALLS:
        session.exitstatus = 1
        reporter = session.config.pluginmanager.get_plugin("terminalreporter")
        if reporter:
            reporter.write_sep("!", f"Blocked {len(_UNEXPECTED_EXTERNAL_CALLS)} unexpected network/provider calls")


def pytest_unconfigure(config):
    _isolation.undo()


@pytest.fixture(scope="session")
def workspace_roots() -> tuple[Path, Path]:
    return _WORKSPACE, _GAME_ROOT


@pytest.fixture(scope="session")
def app_client():
    from fastapi.testclient import TestClient
    from levelbuilder.api.server import app
    from levelbuilder.api import server

    # Image-model warmup is a live-provider/device concern. Keep all API/job
    # lifecycle behavior, but never download weights during the fixture boot.
    client = TestClient(app)
    with pytest.MonkeyPatch.context() as startup:
        startup.setattr(server, "_start_sprite_model_prewarm", lambda: None)
        client.__enter__()
    try:
        yield client
    finally:
        client.__exit__(None, None, None)


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
