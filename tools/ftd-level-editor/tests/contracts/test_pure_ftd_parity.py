from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from ftd_editor.domain.geometry import Rect, banner_band, hud_band, section_forbidden_zones, section_ranges
from ftd_editor.models.options import model_option_snapshot
from ftd_editor.prompts.recipes import build_scene_prompt, get_entity_prompt, prompt_catalog_snapshot


FIXTURE = Path(__file__).parents[1] / "fixtures" / "pure-ftd-parity.json"


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def test_frozen_pure_ftd_fixture_matches_final_modules() -> None:
    expected = json.loads(FIXTURE.read_text())["pureFtd"]

    actual = {
        "geometry": {
            "hud1080": hud_band(1080),
            "banner1080": banner_band(1080),
            "ranges1921": section_ranges(1921),
            "middleZones": [
                asdict(zone) for zone in section_forbidden_zones(1, 640, 1080)
            ],
        },
        "models": model_option_snapshot(),
        "prompts": prompt_catalog_snapshot(),
        "promptDigests": {
            "defaultScene": _digest(build_scene_prompt()),
            "dog": _digest(get_entity_prompt("clean_old_cartoon", "dog")),
            "oldPixelCat": _digest(get_entity_prompt("old_pixel_art", "cat")),
        },
    }

    assert actual == expected


def test_rect_overlap_semantics_are_preserved() -> None:
    rect = Rect(x=10, y=10, w=20, h=20)
    assert rect.contains_circle(10, 10, 1)
    assert not rect.contains_circle(0, 0, 1)
    assert rect.overlaps_box(0, 0, 11, 11)
    assert not rect.overlaps_box(30, 30, 40, 40)
