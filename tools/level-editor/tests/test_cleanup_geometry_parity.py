import json
from pathlib import Path

from levelbuilder.api.cleanup_geometry import CleanupSite, Point, Rect, cleanup_polygons_for_site


FIXTURES = Path(__file__).parents[1] / "fixtures" / "cleanup_geometry_parity.json"


def test_shared_runtime_cleanup_fixtures():
    cases = json.loads(FIXTURES.read_text())["cases"]
    for case in cases:
        sites = [CleanupSite(
            bird_id=item["id"], x=item["x"], y=item["y"],
            cleanup=Rect(*item["cleanup"]),
        ) for item in case["sites"]]
        target = next(site for site in sites if site.bird_id == case["target"])
        protected = set(case["protected"])
        actual = cleanup_polygons_for_site(
            target, sites, case["width"], case["height"],
            lambda site: site.bird_id in protected,
        )
        assert [
            [[point.x, point.y] for point in polygon]
            for polygon in actual
        ] == case["polygons"], case["name"]


def test_close_pair_keeps_each_pickup_site_in_its_own_half_plane():
    sites = [
        CleanupSite("a", 50, 50, Rect(42, 42, 58, 58)),
        CleanupSite("b", 60, 50, Rect(52, 42, 68, 58)),
    ]

    first = cleanup_polygons_for_site(sites[0], sites, 100, 100, lambda _site: True)

    assert first == [[Point(34, 34), Point(55, 34), Point(55, 66), Point(34, 66)]]


def test_edge_cleanup_expands_then_clips_to_scene():
    edge = CleanupSite("edge", 3, 4, Rect(0, 0, 10, 12))

    polygons = cleanup_polygons_for_site(edge, [edge], 100, 80, lambda _site: True)

    assert polygons == [[Point(0, 0), Point(15, 0), Point(15, 18), Point(0, 18)]]
