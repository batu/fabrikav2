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
