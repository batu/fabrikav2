"""Per-game profile resolution.

One tool, many games: a game name selects the authoring workspace
(`games/<game>/.levelbuilder`) and the export target (`games/<game>`).
The forked v1 modules read `LEVELBUILDER_WORKSPACE` / `LEVELBUILDER_GAME_ROOT`
at import time, so `apply_game_from_env()` must run before `levelbuilder.api`
modules are imported. Explicit env vars win over `--game` resolution so tests
and unusual layouts (a game outside this repo) stay expressible.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

GAME_ENV = "LEVEL_EDITOR_GAME"
WORKSPACE_ENV = "LEVELBUILDER_WORKSPACE"
GAME_ROOT_ENV = "LEVELBUILDER_GAME_ROOT"

_TOOL_DIR = Path(__file__).resolve().parent.parent


class UnknownGameError(ValueError):
    pass


def repo_root(start: Path = _TOOL_DIR) -> Path | None:
    for ancestor in [start, *start.parents]:
        if (ancestor / ".git").exists():
            return ancestor
    return None


@dataclass(frozen=True)
class GameProfile:
    name: str
    label: str
    game_root: Path
    workspace: Path

    def apply(self) -> None:
        os.environ[WORKSPACE_ENV] = str(self.workspace)
        os.environ[GAME_ROOT_ENV] = str(self.game_root)


def _label(name: str) -> str:
    return name.replace("_", " ").title()


def available_games(root: Path | None = None) -> list[str]:
    base = (root or repo_root() or _TOOL_DIR) / "games"
    if not base.is_dir():
        return []
    return sorted(
        entry.name
        for entry in base.iterdir()
        if entry.is_dir() and (entry / "public").is_dir() and not entry.name.startswith(("_", "."))
    )


def resolve_game(name: str, root: Path | None = None) -> GameProfile:
    # Explicit path form: a game folder anywhere on disk.
    candidate = Path(name)
    if candidate.is_absolute():
        if not candidate.is_dir():
            raise UnknownGameError(f"game path does not exist: {name}")
        return GameProfile(
            name=candidate.name,
            label=_label(candidate.name),
            game_root=candidate,
            workspace=candidate / ".levelbuilder",
        )
    base = (root or repo_root() or _TOOL_DIR) / "games"
    game_root = base / name
    if not game_root.is_dir():
        raise UnknownGameError(
            f"unknown game {name!r}; available: {', '.join(available_games(root)) or '(none)'}"
        )
    return GameProfile(
        name=name,
        label=_label(name),
        game_root=game_root,
        workspace=game_root / ".levelbuilder",
    )


def apply_game_from_env() -> GameProfile | None:
    """Resolve the active profile before the v1 modules import their roots.

    Precedence: explicit LEVELBUILDER_* env vars > LEVEL_EDITOR_GAME > none
    (fall through to the forked defaults, which are module-relative and only
    sensible in tests)."""
    explicit_ws = os.environ.get(WORKSPACE_ENV)
    explicit_root = os.environ.get(GAME_ROOT_ENV)
    if bool(explicit_ws) != bool(explicit_root):
        # Half-set env silently split the workspace from the export root and
        # landed exports in tools/public/levels (observed live 2026-07-28).
        missing = GAME_ROOT_ENV if explicit_ws else WORKSPACE_ENV
        raise UnknownGameError(
            f"{missing} must be set alongside "
            f"{WORKSPACE_ENV if explicit_ws else GAME_ROOT_ENV}; "
            "set both, or use --game / LEVEL_EDITOR_GAME instead"
        )
    if explicit_ws and explicit_root:
        root = Path(explicit_root)
        return GameProfile(
            name=root.name,
            label=_label(root.name),
            game_root=root,
            workspace=Path(explicit_ws),
        )
    name = os.environ.get(GAME_ENV)
    if not name:
        return None
    profile = resolve_game(name)
    profile.apply()
    return profile


def require_game_from_env() -> GameProfile:
    """Return one coherent active profile; storage modules must never guess."""
    profile = apply_game_from_env()
    if profile is None:
        raise UnknownGameError(
            "no level-editor game profile is configured; select a game with "
            "--game or LEVEL_EDITOR_GAME, or set both LEVELBUILDER_WORKSPACE "
            "and LEVELBUILDER_GAME_ROOT"
        )
    return profile
