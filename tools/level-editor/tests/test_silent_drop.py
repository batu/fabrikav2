"""A painted bird must never vanish from an export.

Live probe 2026-07-29: displacing one hitbox produced a 19-bird package from a
20-bird session, silently — the HUD then counts 19. The gate never saw it
because the dropped dog wasn't in painted_indices either.
"""

import pytest

from levelbuilder.api.session import LevelNotReadyError, require_all_painted_dogs_mapped


def _painted(index: int) -> dict:
    return {"index": index, "activeVariant": 0}


def test_all_mapped_is_fine():
    dogs = [_painted(0), _painted(1)]
    target_map = {0: (0, 0), 1: (1, 0)}
    require_all_painted_dogs_mapped("s", dogs, target_map)


def test_orphaned_painted_dog_refuses_with_its_name():
    dogs = [_painted(0), _painted(1), _painted(2)]
    target_map = {0: (0, 0), 1: (2, 0)}  # dog_01 mapped nowhere
    with pytest.raises(LevelNotReadyError) as excinfo:
        require_all_painted_dogs_mapped("sess", dogs, target_map)
    message = str(excinfo.value)
    assert "dog_01" in message
    assert "1 painted dog" in message


def test_unpainted_dogs_are_not_required():
    dogs = [_painted(0), {"index": 1, "activeVariant": None}]
    require_all_painted_dogs_mapped("s", dogs, {0: (0, 0)})


def test_many_orphans_are_truncated_in_the_message():
    dogs = [_painted(i) for i in range(20)]
    with pytest.raises(LevelNotReadyError) as excinfo:
        require_all_painted_dogs_mapped("s", dogs, {0: (0, 0)})
    message = str(excinfo.value)
    assert "19 painted dog(s)" in message
    assert "+7 more" in message


def test_level_not_ready_maps_to_409(app_client):
    """Author-fixable refusals are 409, not 500 (the CLI fails fast on 4xx)."""
    from levelbuilder.api import server

    handlers = server.app.exception_handlers
    from levelbuilder.api.session import LevelNotReadyError

    assert LevelNotReadyError in handlers


def test_sprite_gaps_uses_dog_indices_not_target_indices(isolated_session, monkeypatch):
    """After a delete, dog-meta indices diverge from hitbox target indices.
    Comparing against the map's KEYS reported healthy dogs as missing (and
    burned provider calls regenerating them)."""
    from levelbuilder.api import routes

    dogs_meta = [{"index": 19, "id": "uuid-19", "activeVariant": 1}]
    # dog 19 is bound to hitbox slot 18 (one earlier dog was deleted).
    monkeypatch.setattr(routes.S, "active_dog_variant_targets", lambda *a, **k: {18: (19, 1)})
    monkeypatch.setattr(routes.S, "active_sprite_metadata_map", lambda *a, **k: {18: {"image": "x"}})
    monkeypatch.setattr(routes.S, "load_session_raw", lambda *a, **k: {"dogs": dogs_meta})
    monkeypatch.setattr(routes.S, "session_dir", lambda *a, **k: isolated_session.LEVELS_DIR / "nope")

    result = routes.get_sprite_gaps("session_with_delete_01")
    assert result["missing"] == []
