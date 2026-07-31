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
    """Author-fixable refusals are 409, not 500 (the CLI fails fast on 4xx).

    Exercised through a real route rather than asserting handler registration —
    registration alone could still return 500."""
    from levelbuilder.api import session as sess

    session_id = "not_ready_probe_01"
    (sess.LEVELS_DIR / session_id).mkdir(parents=True, exist_ok=True)  # no hitboxes.json
    response = app_client.post(f"/api/sessions/{session_id}/fix-hitboxes")
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "level_not_ready"
    assert "hitboxes" in body["error"]


def test_sprite_gaps_after_a_real_delete(isolated_session):
    """The live incident: after deleting a dog, dog-meta indices diverge from
    hitbox target indices, and comparing against the map's KEYS reported
    healthy dogs as missing (costing provider calls to "fix" them).

    Built from real session state and a real delete — no stubbed lookups."""
    import json as _json

    from levelbuilder.api import routes
    from tests.test_recenter import _make_session

    sess = isolated_session
    session_id = "delete_divergence_01"
    hitboxes = [
        {"x": 50, "y": 50, "r": 26, "id": "uuid-0"},
        {"x": 150, "y": 150, "r": 26, "id": "uuid-1"},
        {"x": 250, "y": 250, "r": 26, "id": "uuid-2"},
    ]
    sprites = [[30, 30, 70, 70], [130, 130, 170, 170], [230, 230, 270, 270]]
    _make_session(sess, session_id, hitboxes, sprites)
    raw = _json.loads((sess.LEVELS_DIR / session_id / "session.json").read_text())
    for index, dog in enumerate(raw["dogs"]):
        dog["id"] = f"uuid-{index}"
    (sess.LEVELS_DIR / session_id / "session.json").write_text(_json.dumps(raw))

    assert routes.get_sprite_gaps(session_id)["missing"] == []

    # Delete the middle dog: survivors keep dog indices 0 and 2, but the
    # hitbox list now has only two slots.
    assert sess.delete_dog_by_id(session_id, "uuid-1") is True
    gaps = routes.get_sprite_gaps(session_id)
    assert gaps["missing"] == [], f"healthy dogs reported missing: {gaps}"
