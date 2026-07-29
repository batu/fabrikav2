"""RED: the crop band on tall phones must be enforced, not just warned about.

Cover-scaling crops up to ~75 level px per side on the narrowest supported
phones. The placer avoids that band (CROP_L/R), but: the widest devices were
missing from the visibility viewports, `clipped` did not block Lineup, and
recentering could move a tap point into the band after placement was clean.
"""

import json


def test_widest_device_class_is_checked():
    from levelbuilder.api.session import MOBILE_VISIBILITY_VIEWPORTS

    aspects = [vp["width"] / vp["height"] for vp in MOBILE_VISIBILITY_VIEWPORTS]
    assert min(aspects) <= 0.449, (
        "the narrowest supported aspect (448x998 Pixel 8 Pro class) must be "
        f"in the visibility viewports; narrowest checked is {min(aspects):.4f}"
    )


def test_edge_bird_reports_clipped_on_wide_device(isolated_session):
    from levelbuilder.api.session import mobile_visibility_report

    report = mobile_visibility_report({
        "width": 768, "height": 1376,
        "dogs": [{"id": "edge_bird", "x": 30, "y": 700, "r": 26}],
    })
    issues = report["issues"]
    clipped = [i for i in issues if i["type"] == "clipped" and i["dogId"] == "edge_bird"]
    assert clipped, f"a bird at x=30 must clip on tall phones; got {issues}"


def test_clipped_is_blocking_in_the_ui_filter():
    from pathlib import Path

    source = (Path(__file__).parent.parent / "ui/src/lib/visibilityWarnings.ts").read_text()
    for fn in ("blockingVisibilityIssues", "blockingVisibilitySummaries"):
        segment = source[source.index(fn):]
        segment = segment[:segment.index("}")]
        assert "clipped" in segment, f"{fn} must treat 'clipped' as blocking"


def test_recenter_reports_crop_risk(isolated_session):
    from tests.test_recenter import _make_session

    sess = isolated_session
    # Sprite center at x=40 — inside the CROP_L band for a 768-wide level.
    hitboxes = [{"x": 300, "y": 700, "r": 26}]
    sprites = [[15, 675, 65, 725]]
    _make_session(sess, "crop_risk_probe_1", hitboxes, sprites)
    result = sess.recenter_hitboxes_to_sprites("crop_risk_probe_1")
    assert [m["index"] for m in result["moved"]] == [0]
    assert result["moved"][0].get("cropRisk") is True, (
        "a recenter landing inside the crop band must be flagged"
    )
