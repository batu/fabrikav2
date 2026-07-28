from pathlib import Path

import pytest

from levelbuilder.settings import GameProfile, UnknownGameError, resolve_game


def _fake_repo(tmp_path: Path) -> Path:
    (tmp_path / ".git").mkdir()
    for name in ("find_the_bird", "find_the_dog"):
        (tmp_path / "games" / name / "public").mkdir(parents=True)
    return tmp_path


def test_two_games_get_disjoint_roots(tmp_path: Path) -> None:
    root = _fake_repo(tmp_path)
    bird = resolve_game("find_the_bird", root)
    dog = resolve_game("find_the_dog", root)
    assert bird.workspace != dog.workspace
    assert bird.game_root != dog.game_root
    assert bird.workspace == root / "games" / "find_the_bird" / ".levelbuilder"
    assert bird.label == "Find The Bird"


def test_unknown_game_lists_available(tmp_path: Path) -> None:
    root = _fake_repo(tmp_path)
    with pytest.raises(UnknownGameError) as excinfo:
        resolve_game("marble_run", root)
    assert "find_the_bird" in str(excinfo.value)


def test_absolute_path_game(tmp_path: Path) -> None:
    game = tmp_path / "elsewhere" / "spot_the_cat"
    game.mkdir(parents=True)
    profile = resolve_game(str(game))
    assert isinstance(profile, GameProfile)
    assert profile.name == "spot_the_cat"
    assert profile.workspace == game / ".levelbuilder"
