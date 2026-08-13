"""BUG-8 mutation scrub (built OFF by default, 2026-08-14 overnight; operator
gate: morning before/after review decides if it ever enters the lane).

Pure function: given clean bg, painted scene, and hitbox discs, revert every
changed component that does not intersect a (dilated) disc. Birds stay;
redecoration is undone by construction. Nothing here writes to any level."""
import numpy as np


def _scene(w=100, h=100):
    return np.full((h, w, 3), 100, dtype=np.uint8)


def test_scrub_reverts_offdisc_mutations_and_keeps_birds():
    from levelbuilder.api.mutation_scrub import scrub_scene

    clean = _scene()
    painted = clean.copy()
    painted[20:30, 20:30] = 200     # "bird" at disc (25,25)
    painted[70:80, 70:80] = 250     # prop swap far from any disc
    result = scrub_scene(painted, clean, hitboxes=[{"x": 25, "y": 25, "r": 8}])
    out = result.scene
    assert (out[20:30, 20:30] == 200).all(), "bird paint must survive"
    assert (out[70:80, 70:80] == 100).all(), "off-disc mutation must revert"
    assert result.stats["keptComponents"] == 1
    assert result.stats["revertedComponents"] == 1
    assert result.stats["revertedPixels"] == 100


def test_scrub_keeps_components_touching_the_dilated_disc():
    from levelbuilder.api.mutation_scrub import scrub_scene

    clean = _scene()
    painted = clean.copy()
    # Bird spills beyond its disc (painted birds render ~2x the disc).
    painted[10:40, 10:40] = 220
    result = scrub_scene(painted, clean, hitboxes=[{"x": 25, "y": 25, "r": 8}])
    assert (result.scene[10:40, 10:40] == 220).all(), "spilling bird must survive whole"
    assert result.stats["revertedPixels"] == 0


def test_scrub_noop_when_nothing_changed():
    from levelbuilder.api.mutation_scrub import scrub_scene

    clean = _scene()
    result = scrub_scene(clean.copy(), clean, hitboxes=[{"x": 25, "y": 25, "r": 8}])
    assert result.stats["revertedPixels"] == 0 and result.stats["keptComponents"] == 0
