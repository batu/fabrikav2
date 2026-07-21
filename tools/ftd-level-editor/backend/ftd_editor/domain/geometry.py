"""FTD HUD, safe-area, and three-section geometry."""

from __future__ import annotations

from dataclasses import dataclass


HUD_FRACTION = 0.139
BANNER_FRACTION = 0.071
SECTION_BOUNDARY_BUFFER = 60
LANDSCAPE_EDGE_SAFE_AREA = 60
VIEWPORT_SAFE_FRACTION = 60.0 / 640.0
PORTRAIT_REF_WIDTH = 768
PORTRAIT_REF_HEIGHT = 1376
PORTRAIT_REFERENCE_DEADZONES: list[tuple[str, int, int, int, int]] = [
    ("HUD", 0, 0, 768, 191),
    ("AD", 0, 1278, 768, 98),
    ("CROP_L", 0, 0, 90, 1376),
    ("CROP_R", 678, 0, 90, 1376),
    ("HINT_CHIP", 551, 1151, 137, 100),
]
N_SECTIONS = 3


@dataclass(frozen=True, slots=True)
class Rect:
    x: int
    y: int
    w: int
    h: int

    def contains_circle(self, cx: int, cy: int, radius: int) -> bool:
        closest_x = max(self.x, min(cx, self.x + self.w))
        closest_y = max(self.y, min(cy, self.y + self.h))
        dx = cx - closest_x
        dy = cy - closest_y
        return (dx * dx + dy * dy) < radius * radius

    def overlaps_box(self, left: float, top: float, right: float, bottom: float) -> bool:
        return (
            left < self.x + self.w
            and right > self.x
            and top < self.y + self.h
            and bottom > self.y
        )


def hud_band(level_height: int) -> int:
    return int(level_height * HUD_FRACTION)


def banner_band(level_height: int) -> int:
    return int(level_height * BANNER_FRACTION)


def section_forbidden_zones(
    section_index: int,
    section_width: int,
    level_height: int,
) -> list[Rect]:
    hud = hud_band(level_height)
    banner = banner_band(level_height)
    zones = [
        Rect(x=0, y=0, w=section_width, h=hud),
        Rect(x=0, y=level_height - banner, w=section_width, h=banner),
    ]
    left_width = SECTION_BOUNDARY_BUFFER if section_index > 0 else LANDSCAPE_EDGE_SAFE_AREA
    right_width = (
        SECTION_BOUNDARY_BUFFER
        if section_index < N_SECTIONS - 1
        else LANDSCAPE_EDGE_SAFE_AREA
    )
    zones.append(Rect(x=0, y=0, w=left_width, h=level_height))
    zones.append(
        Rect(
            x=section_width - right_width,
            y=0,
            w=right_width,
            h=level_height,
        )
    )
    return zones


def section_ranges(level_width: int) -> list[dict[str, int]]:
    return [
        {
            "xStart": level_width * index // N_SECTIONS,
            "xEnd": level_width * (index + 1) // N_SECTIONS,
        }
        for index in range(N_SECTIONS)
    ]
