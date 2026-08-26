#!/usr/bin/env python3
"""Trim and place a transparent source image on a predictable runtime canvas."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--size", required=True, type=int)
    parser.add_argument("--margin", default=8, type=int)
    parser.add_argument(
        "--chroma-green",
        action="store_true",
        help="Remove a generated pure-green backdrop before trimming.",
    )
    return parser.parse_args()


def remove_chroma_green(source: Image.Image) -> Image.Image:
    pixels = []
    for red, green, blue, alpha in source.getdata():
        green_dominance = green - max(red, blue)
        # Generated chroma plates are anti-aliased at the subject edge. Merely
        # lowering alpha leaves a bright green fringe after resizing, so remove
        # the strongly keyed pixels and de-spill the narrow transition band.
        if green >= 140 and green_dominance >= 48:
            key_strength = min(1.0, (green_dominance - 48) / 72)
            alpha = min(alpha, round(255 * (1.0 - key_strength)))
            if alpha > 0:
                green = min(green, max(red, blue) + 18)
        pixels.append((red, green, blue, alpha))
    source.putdata(pixels)
    return source


def clean_resample_fringe(source: Image.Image) -> Image.Image:
    """Remove chroma-colored Lanczos ringing introduced at transparent edges."""
    pixels = []
    for red, green, blue, alpha in source.getdata():
        green_dominance = green - max(red, blue)
        if alpha <= 32 and green_dominance >= 24:
            alpha = 0
        elif green >= 110 and green_dominance >= 36:
            green = min(green, max(red, blue) + 14)
        pixels.append((red, green, blue, alpha))
    source.putdata(pixels)
    return source


def main() -> None:
    args = parse_args()
    source = Image.open(args.input).convert("RGBA")
    if args.chroma_green:
        source = remove_chroma_green(source)
    alpha_bounds = source.getchannel("A").getbbox()
    if alpha_bounds is None:
        raise SystemExit(f"{args.input} contains no visible pixels")

    trimmed = source.crop(alpha_bounds)
    content_size = args.size - (args.margin * 2)
    if content_size <= 0:
        raise SystemExit("--margin must leave positive content space")

    scale = min(content_size / trimmed.width, content_size / trimmed.height)
    resized = trimmed.resize(
        (round(trimmed.width * scale), round(trimmed.height * scale)),
        Image.Resampling.LANCZOS,
    )
    if args.chroma_green:
        resized = clean_resample_fringe(resized)
    canvas = Image.new("RGBA", (args.size, args.size), (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((args.size - resized.width) // 2, (args.size - resized.height) // 2),
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output, optimize=True)

    output_bounds = canvas.getchannel("A").getbbox()
    print(
        f"Wrote {args.output}: source_bounds={alpha_bounds}, "
        f"output_bounds={output_bounds}, canvas={args.size}x{args.size}"
    )


if __name__ == "__main__":
    main()
