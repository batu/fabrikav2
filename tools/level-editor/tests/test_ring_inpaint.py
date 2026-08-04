"""Ring inpaint mode: prompt composition and deterministic gates."""

from PIL import Image, ImageDraw

from levelbuilder.api.inpaint import (
    _ring_containment_ok,
    _ring_crop_prompt,
    _ring_residual_magenta_count,
    _strip_positional_phrases,
)

ENTITY_PROMPT = (
    "Add exactly one bird at the center of the image, occupying roughly the "
    "central third of the frame (not filling it). The bird is a charming "
    "little anthropomorphic inhabitant of this world. Vary the bird's colors, "
    "markings, proportions, and small physical details across crops. "
    "Keep all other elements of the image unchanged."
)


class TestRingPrompt:
    def test_composes_default_entity_prompt_verbatim_minus_positional(self):
        prompt = _ring_crop_prompt(ENTITY_PROMPT)
        # Charm/variation clauses from the wizard prompt survive.
        assert "charming little anthropomorphic inhabitant" in prompt
        assert "Vary the bird's colors" in prompt
        # Per-crop framing clauses do not.
        assert "at the center of the image" not in prompt
        assert "central third of the frame" not in prompt

    def test_ring_contract_clauses_present(self):
        prompt = _ring_crop_prompt(ENTITY_PROMPT)
        assert "CIRCLE OUTLINE" in prompt
        assert "ENTIRELY INSIDE" in prompt
        assert "erase the magenta outline" in prompt
        assert "EXACTLY identical" in prompt

    def test_strip_positional_phrases_keeps_aesthetics(self):
        cleaned = _strip_positional_phrases(ENTITY_PROMPT)
        assert "charming" in cleaned
        assert "central third" not in cleaned


class TestRingGates:
    def _mask(self, size, blobs):
        m = Image.new("L", size, 0)
        d = ImageDraw.Draw(m)
        for (x, y, r) in blobs:
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
        return m

    def test_contained_subject_passes(self):
        m = self._mask((400, 400), [(200, 200, 60)])
        assert _ring_containment_ok(m, (200, 200), 100)

    def test_subject_outside_ring_fails(self):
        m = self._mask((400, 400), [(60, 60, 40)])
        assert not _ring_containment_ok(m, (200, 200), 100)

    def test_subject_straddling_ring_edge_fails(self):
        m = self._mask((400, 400), [(295, 200, 50)])
        assert not _ring_containment_ok(m, (200, 200), 100)

    def test_empty_mask_fails(self):
        m = Image.new("L", (400, 400), 0)
        assert not _ring_containment_ok(m, (200, 200), 100)

    def test_residual_magenta_detected(self):
        img = Image.new("RGB", (100, 100), (240, 230, 200))
        d = ImageDraw.Draw(img)
        d.ellipse([20, 20, 80, 80], outline=(255, 0, 255), width=6)
        assert _ring_residual_magenta_count(img) > 40

    def test_clean_result_has_no_magenta(self):
        img = Image.new("RGB", (100, 100), (240, 230, 200))
        assert _ring_residual_magenta_count(img) == 0
