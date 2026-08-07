"""Prompts sent to providers for a non-dog entity must not mention dogs —
"When the entity is a dog, vary breed…" burned tokens steering bird levels
toward dog traits (user report 2026-07-29)."""
import re

import pytest

DOG = re.compile(r"\bdogs?\b", re.IGNORECASE)


def test_entity_prompt_for_bird_never_mentions_dog():
    from levelbuilder.prompts import get_entity_prompt

    for style in ("bold_cardboard", "lineart", "clean_old_cartoon"):
        prompt = get_entity_prompt(style, "bird")
        assert not DOG.search(prompt), (style, prompt)


def test_openai_mask_addendum_is_entity_neutral():
    from levelbuilder.api.inpaint import _openai_inpaint_prompt

    text = _openai_inpaint_prompt("Add exactly one bird to this crop.")
    tail = text.split("\n\n", 1)[1]
    assert not DOG.search(tail), tail


def test_flatkey_prompt_is_cutout_only_and_completes_occlusion():
    from levelbuilder.api.flatkey import FLAT_PROMPT

    assert "CUTOUT-ONLY TASK" in FLAT_PROMPT
    assert "Every pixel that is not" in FLAT_PROMPT
    assert "partially occluded" in FLAT_PROMPT
    assert "infer and complete only the hidden anatomy" in FLAT_PROMPT
    assert "do not include the occluding object" in FLAT_PROMPT


@pytest.mark.parametrize("style", ("bold_cardboard", "lineart", "clean_old_cartoon"))
def test_server_recipe_scene_prompt_uses_selected_bird_entity(style):
    from levelbuilder.api.routes import RecipePromptRequest, _assemble_recipe_prompts

    response = _assemble_recipe_prompts(RecipePromptRequest(
        setting="pirate_shipwreck_island",
        scene="pirate_shipwreck_island_treasure_cove_camp",
        style=style,
        view="isometric_close_20",
        entity="bird",
    ))

    assert "Find the Bird" in response.scenePrompt
    assert "Title:" not in response.scenePrompt
    assert "birds will be added later" in response.scenePrompt
    assert "Do not depict any bird" in response.scenePrompt
    assert "parrot" not in response.scenePrompt.lower()
    assert not DOG.search(response.scenePrompt), response.scenePrompt


def test_generic_scene_prompt_uses_selected_entity():
    from levelbuilder.prompts import build_scene_prompt

    prompt = build_scene_prompt(
        style="lineart",
        content="pirate_shipwreck_island_treasure_cove_camp",
        entity="bird",
    )

    assert "Find the Bird" in prompt
    assert "Title:" not in prompt
    assert "birds will be added later" in prompt
    assert "Do not depict any bird" in prompt
    assert not DOG.search(prompt), prompt
