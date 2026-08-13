def test_default_flatkey_grid_is_the_operator_selected_1x1() -> None:
    # Operator decision 2026-08-13 (supersedes the 2026-08-10 2x2 review
    # pick): single-call cutouts by default — no grid regen risk; placement
    # correctness outranks the batch discount.
    from levelbuilder.api.session import DEFAULT_FLATKEY_GRID

    assert DEFAULT_FLATKEY_GRID == 1
