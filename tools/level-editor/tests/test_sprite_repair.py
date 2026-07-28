"""Sprite-repair default: OFF cost a full debugging loop overnight (10 of 20
birds shipped without pickup sprites and export refused). The fork defaults ON."""

import importlib
import os


def _reload_with_env(value: str | None):
    from levelbuilder.api import inpaint

    if value is None:
        os.environ.pop("FTD_SPRITE_REPAIR", None)
    else:
        os.environ["FTD_SPRITE_REPAIR"] = value
    return importlib.reload(inpaint)


def test_repair_enabled_by_default(monkeypatch):
    module = _reload_with_env(None)
    try:
        assert module._SPRITE_REPAIR_ENABLED is True
    finally:
        _reload_with_env(None)


def test_repair_can_be_disabled_explicitly():
    module = _reload_with_env("0")
    try:
        assert module._SPRITE_REPAIR_ENABLED is False
    finally:
        _reload_with_env(None)


def test_prewarm_is_skipped_when_repair_is_disabled(monkeypatch):
    """No point downloading model weights the repair chain will never use."""
    from levelbuilder.api import server

    started = []
    monkeypatch.setenv("FTD_SPRITE_REPAIR", "0")
    monkeypatch.setattr(server.threading, "Thread",
                        lambda **kwargs: started.append(kwargs) or _NoopThread())
    server._start_sprite_model_prewarm()
    assert started == []


def test_prewarm_runs_in_a_background_thread_by_default(monkeypatch):
    from levelbuilder.api import server

    started = []
    monkeypatch.delenv("FTD_SPRITE_REPAIR", raising=False)
    monkeypatch.setattr(server.threading, "Thread",
                        lambda **kwargs: started.append(kwargs) or _NoopThread())
    server._start_sprite_model_prewarm()
    assert len(started) == 1
    assert started[0]["daemon"] is True


class _NoopThread:
    def start(self) -> None:
        return None
