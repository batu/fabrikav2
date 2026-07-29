"""RED: the dead zones must cover the MEASURED game chrome, not a hand-written
guess.

Measured 2026-07-29 from the running game across 10 device presets with
simulated safe-area insets (scripts capture; see docs/evidence). Mapped into
768x1376 reference level space via inverse cover-scaling, unioned across
devices, padded 8px. The old table under-blocked both zones:
HUD real 0..230 (table said 191); hint chip real x531..744 y1117..1255
(table said x551..688 y1151..1251).
"""

MEASURED_HUD_BOTTOM = 230
MEASURED_HINT = {"x1": 531, "y1": 1117, "x2": 744, "y2": 1255}


def _zone(label: str):
    from levelbuilder.sections import PORTRAIT_REFERENCE_DEADZONES

    for name, x, y, w, h in PORTRAIT_REFERENCE_DEADZONES:
        if name == label:
            return x, y, x + w, y + h
    raise AssertionError(f"zone {label} missing")


def test_hud_zone_covers_measured_chrome():
    x1, y1, x2, y2 = _zone("HUD")
    assert y2 >= MEASURED_HUD_BOTTOM, f"HUD zone ends at {y2}, chrome reaches {MEASURED_HUD_BOTTOM}"
    assert (x1, y1, x2) == (0, 0, 768)


def test_hint_zone_covers_measured_chrome():
    x1, y1, x2, y2 = _zone("HINT_CHIP")
    m = MEASURED_HINT
    assert x1 <= m["x1"] and y1 <= m["y1"] and x2 >= m["x2"] and y2 >= m["y2"], (
        f"hint zone ({x1},{y1},{x2},{y2}) does not cover measured "
        f"({m['x1']},{m['y1']},{m['x2']},{m['y2']})"
    )


def test_hud_fraction_matches_zone():
    """The visibility check blocks by HUD_FRACTION; it must agree with the
    reference zone or the two enforcement paths drift."""
    from levelbuilder.sections import HUD_FRACTION, PORTRAIT_REF_HEIGHT

    _, _, _, hud_bottom = _zone("HUD")
    assert abs(HUD_FRACTION * PORTRAIT_REF_HEIGHT - hud_bottom) <= 2
