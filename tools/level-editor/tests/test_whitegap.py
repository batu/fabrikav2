"""Guard tests for levelbuilder.api.whitegap: known gaps are found (and only where the
legs are), known white plumage is left alone, and punching touches nothing else."""
from pathlib import Path

import pytest

from levelbuilder.api.whitegap import find_gaps, load, punch_gaps

FX = Path(__file__).parent / "fixtures" / "whitegap"
GAP = sorted((FX / "gap").glob("*.png"))
KEEP = sorted((FX / "keep").glob("*.png"))


@pytest.mark.parametrize("path", GAP, ids=[p.stem for p in GAP])
def test_known_gap_is_found_once_between_the_legs(path):
    a = load(path)
    gaps = find_gaps(a)
    assert len(gaps) == 1, [(g["size"], g["bbox"]) for g in gaps]
    x0, y0, x1, y1 = gaps[0]["bbox"]
    assert y0 > a.shape[0] * 0.5, "the fixture gaps are all between the legs (lower half)"
    assert gaps[0]["size"] <= 200


@pytest.mark.parametrize("path", KEEP, ids=[p.stem for p in KEEP])
def test_white_plumage_is_left_alone(path):
    gaps = find_gaps(load(path))
    assert gaps == [], [(g["size"], g["bbox"], round(g["std"], 1)) for g in gaps]


@pytest.mark.parametrize("path", GAP, ids=[p.stem for p in GAP])
def test_punch_only_touches_the_gap(path):
    a = load(path)
    gaps = find_gaps(a)
    b, px = punch_gaps(a, gaps)
    assert px <= gaps[0]["size"] * 3
    changed = a[..., 3] != b[..., 3]
    assert changed.sum() == px
    assert find_gaps(b) == []  # idempotent: nothing left to find
    assert (a[~changed] == b[~changed]).all()  # everything else is byte-identical
