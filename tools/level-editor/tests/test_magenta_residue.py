def test_magenta_residue_detects_unpainted_dots():
    """Pirate palm-root level (2026-08-15): the paint model left the magenta
    placement rings visible in color.png — 64k magenta pixels, level looked
    complete (25 detected, canonical clean) but ships bright magenta rings.
    Healthy levels measure 0."""
    import numpy as np
    from levelbuilder.api.magenta_residue import magenta_residue_pixels

    clean = np.zeros((64, 64, 3), np.uint8)
    clean[:] = (120, 100, 80)
    assert magenta_residue_pixels(clean) == 0

    dirty = clean.copy()
    dirty[10:20, 10:20] = (255, 0, 255)
    assert magenta_residue_pixels(dirty) == 100
