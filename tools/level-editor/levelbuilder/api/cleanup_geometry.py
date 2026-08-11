"""Runtime-parity cleanup geometry for pickup previews and export gates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

CLEANUP_FOOTPRINT_SCALE = 2.0


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class Rect:
    left: float
    top: float
    right: float
    bottom: float


@dataclass(frozen=True)
class CleanupSite:
    bird_id: str
    x: float
    y: float
    cleanup: Rect | None


def _scale_rect(rect: Rect, scale: float) -> Rect:
    center_x = (rect.left + rect.right) / 2
    center_y = (rect.top + rect.bottom) / 2
    half_width = (rect.right - rect.left) * scale / 2
    half_height = (rect.bottom - rect.top) * scale / 2
    return Rect(center_x - half_width, center_y - half_height, center_x + half_width, center_y + half_height)


def _clip_rect(rect: Rect, width: float, height: float) -> Rect | None:
    clipped = Rect(max(0, rect.left), max(0, rect.top), min(width, rect.right), min(height, rect.bottom))
    return clipped if clipped.right > clipped.left and clipped.bottom > clipped.top else None


def _overlap(a: Rect, b: Rect) -> bool:
    return a.left < b.right and b.left < a.right and a.top < b.bottom and b.top < a.bottom


def _clip_nearer(polygon: list[Point], site: Point, other: Point) -> list[Point]:
    dx = other.x - site.x
    dy = other.y - site.y
    if dx == 0 and dy == 0:
        return list(polygon)
    middle_x = (site.x + other.x) / 2
    middle_y = (site.y + other.y) / 2

    def signed(point: Point) -> float:
        return dx * (middle_x - point.x) + dy * (middle_y - point.y)

    output: list[Point] = []
    for index, current in enumerate(polygon):
        following = polygon[(index + 1) % len(polygon)]
        current_distance = signed(current)
        following_distance = signed(following)
        if current_distance >= 0:
            output.append(current)
        if (current_distance >= 0) != (following_distance >= 0):
            ratio = current_distance / (current_distance - following_distance)
            output.append(Point(
                current.x + (following.x - current.x) * ratio,
                current.y + (following.y - current.y) * ratio,
            ))
    return output


def cleanup_polygons_for_site(
    site: CleanupSite,
    all_sites: list[CleanupSite],
    level_width: float,
    level_height: float,
    is_protected: Callable[[CleanupSite], bool],
) -> list[list[Point]]:
    """Match ``cleanupPolygonsForSite`` in the Find the Bird runtime."""
    if site.cleanup is None:
        return []
    expanded = _clip_rect(_scale_rect(site.cleanup, CLEANUP_FOOTPRINT_SCALE), level_width, level_height)
    if expanded is None:
        return []
    polygons = [[
        Point(expanded.left, expanded.top),
        Point(expanded.right, expanded.top),
        Point(expanded.right, expanded.bottom),
        Point(expanded.left, expanded.bottom),
    ]]
    for other in all_sites:
        if other.bird_id == site.bird_id or other.cleanup is None or not is_protected(other):
            continue
        protected = _clip_rect(other.cleanup, level_width, level_height)
        if protected is None or not _overlap(expanded, protected):
            continue
        polygons = [clipped for polygon in polygons if len(clipped := _clip_nearer(
            polygon, Point(site.x, site.y), Point(other.x, other.y),
        )) >= 3]
        if not polygons:
            break
    return polygons
