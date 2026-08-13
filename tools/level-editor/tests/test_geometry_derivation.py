"""Geometry vNEXT derivation core (CL-11/CL-12 foundation): quality-gated
paint-diff, per-pixel Voronoi ownership (components split across the
partition — never the indivisible unit), owned-paint restore regions, and the
residue gate. Pure functions over arrays; dependency-hashed."""
import numpy as np
import pytest


def _scene_pair():
    """96x128 clean bg + scene with two painted blobs and one shared blob
    straddling the bisector between two birds."""
    clean = np.full((96, 128, 3), 40, dtype=np.uint8)
    scene = clean.copy()
    scene[20:36, 20:36] = [220, 40, 40]      # blob owned by bird A (center 28,28)
    scene[60:76, 90:106] = [40, 220, 40]     # blob owned by bird B (center 68,98)
    scene[40:56, 56:72] = [220, 220, 40]     # straddling blob (between both)
    birds = [
        {"birdId": "A", "hitbox": {"x": 28, "y": 28, "r": 10}},
        {"birdId": "B", "hitbox": {"x": 98, "y": 68, "r": 10}},
    ]
    return scene, clean, birds


def test_paint_diff_and_perpixel_ownership():
    from levelbuilder.api.geometry_derivation import derive_ownership, derive_paint_diff

    scene, clean, birds = _scene_pair()
    diff = derive_paint_diff(scene, clean)
    assert diff.mask[28, 28] and diff.mask[68, 98]
    assert not diff.mask[5, 5]
    assert diff.needs_review is False

    ownership = derive_ownership(diff.mask, birds)
    assert ownership.owner[28, 28] == 0        # A's blob
    assert ownership.owner[68, 98] == 1        # B's blob
    # The straddling blob splits per pixel: its left edge belongs to A,
    # right edge to B — the component is NOT one indivisible unit.
    assert ownership.owner[48, 57] == 0
    assert ownership.owner[48, 71] == 1
    # Conservation: every diff pixel has exactly one owner; nothing else does.
    assert ((ownership.owner >= 0) == diff.mask).all()


def test_restore_regions_cover_owned_paint_with_margin():
    from levelbuilder.api.geometry_derivation import (
        derive_ownership, derive_paint_diff, derive_restore_regions,
    )

    scene, clean, birds = _scene_pair()
    diff = derive_paint_diff(scene, clean)
    ownership = derive_ownership(diff.mask, birds)
    regions = derive_restore_regions(ownership, birds, margin=4)
    a = regions["A"]
    assert a["x"] <= 16 and a["y"] <= 16
    assert a["x"] + a["width"] >= 40 and a["y"] + a["height"] >= 40
    # A's region must include its share of the straddling blob.
    assert a["x"] + a["width"] >= 60


def test_globally_distributed_footprint_fails_closed():
    from levelbuilder.api.geometry_derivation import derive_paint_diff

    clean = np.full((96, 128, 3), 40, dtype=np.uint8)
    scene = clean.copy()
    rng = np.random.default_rng(7)
    speckle = rng.random((96, 128)) < 0.4     # repaint-drift style global noise
    scene[speckle] = [200, 200, 200]
    diff = derive_paint_diff(scene, clean)
    assert diff.needs_review is True           # vNEXT §2: fail closed


def test_residue_gate_counts_surviving_paint():
    from levelbuilder.api.geometry_derivation import residue_report

    scene, clean, birds = _scene_pair()
    # Perfect restore: composite == clean → zero residue.
    perfect = residue_report(clean, clean)
    assert perfect.residue_pixels == 0
    # One blob left behind → counted, heatmap marks it.
    partial = clean.copy()
    partial[20:36, 20:36] = [220, 40, 40]
    report = residue_report(partial, clean)
    assert report.residue_pixels == 16 * 16
    assert report.heatmap[28, 28]


def test_dependency_hash_changes_with_inputs():
    from levelbuilder.api.geometry_derivation import derivation_dependency_hash

    scene, clean, birds = _scene_pair()
    base = derivation_dependency_hash("scenesha", "cleansha", birds)
    moved = [dict(birds[0], hitbox={"x": 29, "y": 28, "r": 10}), birds[1]]
    assert derivation_dependency_hash("scenesha", "cleansha", moved) != base
    assert derivation_dependency_hash("othersha", "cleansha", birds) != base
    assert derivation_dependency_hash("scenesha", "cleansha", birds) == base
