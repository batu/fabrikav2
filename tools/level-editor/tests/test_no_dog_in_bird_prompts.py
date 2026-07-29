"""Prompts sent to providers for a non-dog entity must not mention dogs —
"When the entity is a dog, vary breed…" burned tokens steering bird levels
toward dog traits (user report 2026-07-29)."""
import re

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
