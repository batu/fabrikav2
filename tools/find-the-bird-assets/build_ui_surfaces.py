"""Build deterministic Cozy Garden UI textures and nine-slice frames.

The generated source paintings live in design/source-textures. This script
turns them into exact seamless tiles and reusable transparent frames; individual
screens compose those primitives instead of baking text into one-off images.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageOps, ImageStat


ROOT = Path(__file__).resolve().parents[2] / "games" / "find_the_bird"
SOURCE_DIR = ROOT / "design" / "source-textures"
TEXTURE_DIR = ROOT / "public" / "ui" / "textures"
SURFACE_DIR = ROOT / "public" / "ui" / "surfaces"
MANIFEST_PATH = ROOT / "design" / "ui-surfaces.json"


def mirror_tile(source: Path, size: int = 256) -> Image.Image:
    """Create a tile whose opposite edges are pixel-identical."""
    quadrant_size = size // 2
    source_image = Image.open(source).convert("RGB")
    crop_size = min(source_image.size)
    left = (source_image.width - crop_size) // 2
    top = (source_image.height - crop_size) // 2
    quadrant = source_image.crop((left, top, left + crop_size, top + crop_size))
    quadrant = quadrant.resize((quadrant_size, quadrant_size), Image.Resampling.LANCZOS)

    tile = Image.new("RGB", (size, size))
    tile.paste(quadrant, (0, 0))
    tile.paste(ImageOps.mirror(quadrant), (quadrant_size, 0))
    tile.paste(ImageOps.flip(quadrant), (0, quadrant_size))
    tile.paste(ImageOps.flip(ImageOps.mirror(quadrant)), (quadrant_size, quadrant_size))
    return tile


def tint_texture(texture: Image.Image, dark: str, light: str) -> Image.Image:
    gray = ImageOps.grayscale(texture)
    gray = ImageEnhance.Contrast(gray).enhance(0.72)
    return ImageOps.colorize(gray, black=dark, white=light)


def tiled_texture(texture: Image.Image, size: tuple[int, int]) -> Image.Image:
    output = Image.new("RGB", size)
    for y in range(0, size[1], texture.height):
        for x in range(0, size[0], texture.width):
            output.paste(texture, (x, y))
    return output


def rounded_mask(
    size: tuple[int, int],
    *,
    inset: int,
    radius: int,
) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (inset, inset, size[0] - 1 - inset, size[1] - 1 - inset),
        radius=radius,
        fill=255,
    )
    return mask


def build_frame(
    texture: Image.Image,
    *,
    size: tuple[int, int],
    outer_inset: int,
    outer_radius: int,
    inner_inset: int,
    inner_radius: int,
    highlight: str,
    shadow: str,
) -> Image.Image:
    base = tiled_texture(texture, size).convert("RGBA")
    outer = rounded_mask(size, inset=outer_inset, radius=outer_radius)
    inner = rounded_mask(size, inset=inner_inset, radius=inner_radius)
    ring = ImageChops.subtract(outer, inner)
    base.putalpha(ring)

    draw = ImageDraw.Draw(base)
    outer_box = (
        outer_inset + 2,
        outer_inset + 2,
        size[0] - 3 - outer_inset,
        size[1] - 3 - outer_inset,
    )
    inner_box = (
        inner_inset - 2,
        inner_inset - 2,
        size[0] + 1 - inner_inset,
        size[1] + 1 - inner_inset,
    )
    draw.rounded_rectangle(outer_box, radius=max(1, outer_radius - 2), outline=highlight, width=4)
    draw.rounded_rectangle(inner_box, radius=inner_radius + 2, outline=shadow, width=5)
    return base


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def edge_error(image: Image.Image) -> dict[str, float]:
    rgb = image.convert("RGB")
    left = rgb.crop((0, 0, 1, rgb.height))
    right = rgb.crop((rgb.width - 1, 0, rgb.width, rgb.height))
    top = rgb.crop((0, 0, rgb.width, 1))
    bottom = rgb.crop((0, rgb.height - 1, rgb.width, rgb.height))

    def mean_abs(a: Image.Image, b: Image.Image) -> float:
        diff = ImageChops.difference(a, b)
        return sum(ImageStat.Stat(diff).mean) / 3

    return {
        "horizontal": mean_abs(left, right),
        "vertical": mean_abs(top, bottom),
    }


def main() -> None:
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    SURFACE_DIR.mkdir(parents=True, exist_ok=True)

    canvas = mirror_tile(SOURCE_DIR / "canvas-cream-source.png")
    olive = mirror_tile(SOURCE_DIR / "painted-olive-source.png")
    honey = mirror_tile(SOURCE_DIR / "wood-honey-source.png")
    sky = tint_texture(olive, "#2f7598", "#8bc6df")

    textures = {
        "canvas-cream": canvas,
        "painted-olive": olive,
        "wood-honey": honey,
        "painted-sky": sky,
    }
    texture_manifest: dict[str, dict[str, object]] = {}
    for name, image in textures.items():
        path = TEXTURE_DIR / f"{name}-seamless.png"
        image.save(path, optimize=True)
        errors = edge_error(image)
        if errors["horizontal"] != 0 or errors["vertical"] != 0:
            raise RuntimeError(f"{name} is not exactly seamless: {errors}")
        texture_manifest[name] = {
            "runtime": f"/ui/textures/{path.name}",
            "repeat": "repeat",
            "tileSize": [256, 256],
            "edgeMeanAbsoluteError": errors,
            "sha256": sha256(path),
        }

    frame_specs = {
        "panel-honey": {
            "texture": honey,
            "size": (256, 256),
            "slice": 52,
            "outer_inset": 8,
            "outer_radius": 48,
            "inner_inset": 44,
            "inner_radius": 26,
            "highlight": "#f4ddb0",
            "shadow": "#76522e",
        },
        "panel-olive": {
            "texture": olive,
            "size": (256, 256),
            "slice": 52,
            "outer_inset": 8,
            "outer_radius": 48,
            "inner_inset": 44,
            "inner_radius": 26,
            "highlight": "#dce3bf",
            "shadow": "#465536",
        },
        "button-olive": {
            "texture": olive,
            "size": (256, 128),
            "slice": 34,
            "outer_inset": 6,
            "outer_radius": 48,
            "inner_inset": 27,
            "inner_radius": 27,
            "highlight": "#dce3bf",
            "shadow": "#465536",
        },
        "button-sky": {
            "texture": sky,
            "size": (256, 128),
            "slice": 34,
            "outer_inset": 6,
            "outer_radius": 48,
            "inner_inset": 27,
            "inner_radius": 27,
            "highlight": "#d8f1fb",
            "shadow": "#2f7598",
        },
    }
    surface_manifest: dict[str, dict[str, object]] = {}
    for name, spec in frame_specs.items():
        frame = build_frame(
            spec["texture"],
            size=spec["size"],
            outer_inset=spec["outer_inset"],
            outer_radius=spec["outer_radius"],
            inner_inset=spec["inner_inset"],
            inner_radius=spec["inner_radius"],
            highlight=spec["highlight"],
            shadow=spec["shadow"],
        )
        path = SURFACE_DIR / f"{name}-9s.png"
        frame.save(path, optimize=True)
        surface_manifest[name] = {
            "runtime": f"/ui/surfaces/{path.name}",
            "size": list(spec["size"]),
            "slice": spec["slice"],
            "fill": False,
            "repeat": "stretch",
            "center": "transparent",
            "sha256": sha256(path),
        }

    manifest = {
        "version": 1,
        "style": "cozy-garden-3d",
        "generatedFrom": {
            "canvas-cream": "design/source-textures/canvas-cream-source.png",
            "painted-olive": "design/source-textures/painted-olive-source.png",
            "wood-honey": "design/source-textures/wood-honey-source.png",
        },
        "textures": texture_manifest,
        "nineSliceSurfaces": surface_manifest,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
