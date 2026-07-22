from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from ftd_editor.publishing.level_schema import (
    LevelFileV1,
    generate_level_typescript,
    validate_level_geometry,
)


ROOT = Path(__file__).resolve().parents[4]


def level_payload() -> dict:
    return {
        "id": "level-01",
        "name": "Level 01",
        "width": 100,
        "height": 200,
        "colorImage": "color.webp",
        "dogs": [
            {
                "id": "dog_00",
                "x": 50,
                "y": 100,
                "r": 10,
                "sprite": {
                    "image": "levels/level-01/dogs/dog_00/sprite_000.png",
                    "x": 40,
                    "y": 90,
                    "width": 20,
                    "height": 20,
                    "cleanup": {"x": 40, "y": 90, "width": 20, "height": 20},
                },
            }
        ],
    }


def test_schema_generation_is_deterministic_and_matches_runtime_contract() -> None:
    first = generate_level_typescript()
    second = generate_level_typescript()
    assert first == second
    generated = (ROOT / "games/find_the_dog/src/data/generated/levelFile.ts").read_text()
    assert generated == first


def test_schema_and_geometry_reject_invalid_public_level_before_selection() -> None:
    payload = level_payload()
    payload["dogs"][0]["x"] = 4
    level = LevelFileV1.model_validate(payload)
    with pytest.raises(ValueError, match="hitbox"):
        validate_level_geometry(level)

    payload = level_payload()
    payload["dogs"][0]["id"] = "mutable-index"
    with pytest.raises(ValidationError):
        LevelFileV1.model_validate(payload)


def test_native_and_baked_extension_geometry_must_correspond() -> None:
    native_payload = level_payload()
    native_payload["extension"] = {
        "targetAspect": 2.2,
        "bandsRef": "bands-01",
        "topBand": 20,
        "bottomBand": 30,
        "nativeWidth": 100,
        "nativeHeight": 200,
    }
    baked_payload = level_payload()
    baked_payload["height"] = 250
    baked_payload["dogs"][0]["y"] = 120
    baked_payload["dogs"][0]["sprite"]["y"] = 110
    baked_payload["dogs"][0]["sprite"]["cleanup"]["y"] = 110
    baked_payload["extension"] = native_payload["extension"]

    validate_level_geometry(
        LevelFileV1.model_validate(baked_payload),
        native=LevelFileV1.model_validate(native_payload),
    )
    baked_payload["dogs"][0]["y"] = 121
    with pytest.raises(ValueError, match="native/baked"):
        validate_level_geometry(
            LevelFileV1.model_validate(baked_payload),
            native=LevelFileV1.model_validate(native_payload),
        )


def test_levels_index_is_retained_until_the_scaffold_consumer_migrates() -> None:
    index = ROOT / "games/find_the_dog/public/levels/levels-index.json"
    scaffold = (ROOT / "tools/create-game/src/gen-stub-levels.mjs").read_text()
    assert index.exists()
    assert "levels-index.json" in scaffold
