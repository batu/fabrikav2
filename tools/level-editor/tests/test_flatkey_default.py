def test_default_flatkey_grid_is_the_operator_selected_1x1() -> None:
    # Operator decision 2026-08-13 (supersedes the 2026-08-10 2x2 review
    # pick): single-call cutouts by default — no grid regen risk; placement
    # correctness outranks the batch discount.
    from levelbuilder.api.session import DEFAULT_FLATKEY_GRID

    assert DEFAULT_FLATKEY_GRID == 1


def test_flat_ok_defers_two_components_to_the_judge():
    """Wagon bird-6 (2026-08-14): a bird HOLDING a lantern renders the item
    as a second connected component whenever the handle contact is lost in
    the chroma key — 8/8 job attempts failed 'duplicate subject' on a bird
    the judge scores 0.94. Exactly two big components must pass the
    deterministic gate and let the semantic judge arbitrate; 3+ still fail."""
    import numpy as np
    from PIL import Image
    from levelbuilder.api.flatkey import flat_ok

    def make(components):
        flat = np.zeros((100, 100, 3), np.uint8)
        flat[:] = (255, 0, 255)  # pure key
        alpha = np.zeros((100, 100), np.uint8)
        for (x0, y0, x1, y1) in components:
            flat[y0:y1, x0:x1] = (120, 90, 60)
            alpha[y0:y1, x0:x1] = 255
        rgba = np.dstack([flat, alpha])
        return Image.fromarray(flat, "RGB"), Image.fromarray(rgba, "RGBA")

    ok, _ = flat_ok(*make([(10, 10, 60, 60)]))
    assert ok, "single subject must pass"
    ok, _ = flat_ok(*make([(10, 10, 55, 60), (65, 20, 95, 55)]))
    assert ok, "bird + held item (two components) must defer to the judge"
    ok, reason = flat_ok(*make([(5, 5, 30, 30), (40, 5, 65, 30), (70, 5, 95, 30)]))
    assert not ok and "components" in reason, "3+ components still hard-fail"
