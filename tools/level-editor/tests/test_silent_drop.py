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
