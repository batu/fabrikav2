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


class TestHardDifficulty:
    def test_hard_flag_adds_cyan_clause_and_easy_prompt_is_unchanged(self):
        entity = get_entity_prompt("clean_old_cartoon", "bird")
        easy = _magenta_prompt(entity)
        hard = _magenta_prompt(entity, hard=True)
        assert "#00FFFF" not in easy and "CAMOUFLAGE" not in easy
        assert "#00FFFF" in hard and "CAMOUFLAGE" in hard
        # Camouflage must stay findable — the clause carries its own floor.
        assert "findable" in hard

    def test_overlay_draws_hard_hitboxes_cyan(self):
        from PIL import Image
        from levelbuilder.api.inpaint import _HARD_RGB, _MAGENTA_RGB, _build_magenta_overlay
        bg = Image.new("RGB", (200, 200), (10, 10, 10))
        ov = _build_magenta_overlay(bg, [
            {"x": 50, "y": 50, "r": 20},
            {"x": 150, "y": 150, "r": 20, "difficulty": "hard"},
        ])
        assert ov.getpixel((50, 50)) == _MAGENTA_RGB
        assert ov.getpixel((150, 150)) == _HARD_RGB


class TestScenePrompt:
    def test_purpose_is_aspect_neutral(self):
        prompt = build_scene_prompt(entity="bird")
        # Canonical creates are 1:1; the purpose line must not claim portrait.
        assert "portrait" not in prompt.split("[Short Description]")[0]


class TestAssemblerParity:
    def test_routes_and_prompts_scene_assemblers_share_blocks(self):
        # Two scene-prompt assemblers exist (levelbuilder.prompts.build_scene_prompt
        # and routes._build_scene_prompt). Their shared blocks must not drift.
        from levelbuilder.api.routes import _build_scene_prompt as routes_build

        def blocks(text: str) -> dict[str, str]:
            out = {}
            for chunk in text.split("\n\n"):
                if chunk.startswith("["):
                    out[chunk.split("]")[0] + "]"] = chunk
            return out

        a = blocks(build_scene_prompt(entity="bird"))
        b = blocks(routes_build(
            content_prompt="x", view_prompt="x", style_prompt="x",
            scale_prompt="", title="X", entity_noun="bird",
        ))
        for key in ("[Purpose]", "[Gameplay Composition]", "[Constraints]"):
            assert a[key] == b[key], key


class TestGridPrompt:
    def test_partial_grid_declares_padding_and_exact_count(self):
        prompt = GRID_PROMPT_TEMPLATE.format(n=3, count=7, entity="bird")
        assert "row-major" in prompt
        assert "empty white padding" in prompt
        assert "exactly 7 birds" in prompt

    def test_entity_is_parameterized_not_hardcoded(self):
        prompt = GRID_PROMPT_TEMPLATE.format(n=3, count=7, entity="capybara")
        assert "bird" not in prompt
        assert "exactly 7 capybaras" in prompt
