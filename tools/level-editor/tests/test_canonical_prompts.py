"""Snapshot guards for the canonical prompts (2026-08-05 audit findings 1/6/7).

These lock the *invariants* the audit fixed, not full prompt text — wording may
evolve, but the contradictions must not come back.
"""

from levelbuilder.api.flatkey import GRID_PROMPT_TEMPLATE
from levelbuilder.api.inpaint import _magenta_prompt, _strip_positional_phrases
from levelbuilder.prompts import build_scene_prompt, get_entity_prompt


class TestMagentaPrompt:
    def test_per_crop_count_sentences_are_fully_stripped_for_every_style(self):
        # Styled overrides phrase the framing differently (e.g. bold_cardboard
        # continues "to this crop, centered on..."), so every style must pass.
        from levelbuilder.prompts import STYLES
        for style in STYLES:
            cleaned = _strip_positional_phrases(get_entity_prompt(style, "bird"))
            # The per-crop count claims contradict "one subject per circle" in
            # a 16-marker full-scene edit; no fragment may survive.
            assert "Add exactly one" not in cleaned, style
            assert "Place exactly one" not in cleaned, style
            assert "to this crop" not in cleaned, style
            assert "centered on the marked target area" not in cleaned, style
        # The aesthetic clauses must survive the strip.
        canonical = _strip_positional_phrases(get_entity_prompt("clean_old_cartoon", "bird"))
        assert "charming little anthropomorphic inhabitant" in canonical

    def test_wrapper_has_single_count_instruction_and_marker_specific_ban(self):
        prompt = _magenta_prompt(get_entity_prompt("clean_old_cartoon", "bird"))
        assert prompt.count("exactly one") == 2  # wrapper's TASK + constraint (4)
        # Ban is marker-color-specific, not a whole color family (existing
        # legitimate pink scene art must not be repainted).
        assert "#FF00FF" in prompt
        assert "pink, or fuchsia" not in prompt
        # Scale anchors must not cite banned scene content.
        assert "people" not in prompt


class TestScenePrompt:
    def test_purpose_is_aspect_neutral(self):
        prompt = build_scene_prompt(entity="bird")
        # Canonical creates are 1:1; the purpose line must not claim portrait.
        assert "portrait" not in prompt.split("[Short Description]")[0]


class TestGridPrompt:
    def test_partial_grid_declares_padding_and_exact_count(self):
        prompt = GRID_PROMPT_TEMPLATE.format(n=3, count=7)
        assert "row-major" in prompt
        assert "empty white padding" in prompt
        assert "exactly 7 birds" in prompt
