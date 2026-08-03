#!/usr/bin/env python3
"""Cost-bounded generation-time cutout probes for Wayfinder ticket 16.

Source sessions are always read-only. All generated assets and ledgers are
written beneath ``--out`` (normally the gitignored ``.work/`` directory).
Dogs and hitboxes are resolved independently by stable ``id``.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage


HERE = Path(__file__).resolve().parent
DEFAULT_CASES = HERE / "experiment-cases.json"
MODEL = "gpt-image-2"
CREAM = (255, 248, 232, 255)


@dataclass(frozen=True)
class ResolvedCase:
    config: dict[str, Any]
    hitbox: dict[str, Any]
    source_box: tuple[int, int, int, int]
    sprite_box: tuple[int, int, int, int]
    clean: Image.Image
    painted: Image.Image

    @property
    def case_id(self) -> str:
        return str(self.config["caseId"])

    @property
    def level_id(self) -> str:
        return str(self.config["levelId"])

    @property
    def dog_dir(self) -> str:
        return str(self.config["expectedDogDir"])


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def _atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")
    temporary.replace(path)


def resolve_case(config: dict[str, Any], source_root: Path) -> ResolvedCase:
    level_dir = source_root / str(config["levelId"])
    session = _read_json(level_dir / "session.json")
    hitboxes = _read_json(level_dir / "hitboxes.json")

    dog_matches = [dog for dog in session.get("dogs", []) if dog.get("id") == config["birdId"]]
    hitbox_matches = [hitbox for hitbox in hitboxes if hitbox.get("id") == config["birdId"]]
    if len(dog_matches) != 1 or len(hitbox_matches) != 1:
        raise RuntimeError(
            f"{config['caseId']}: stable-id join failed "
            f"(dogs={len(dog_matches)}, hitboxes={len(hitbox_matches)})"
        )
    dog = dog_matches[0]
    hitbox = hitbox_matches[0]
    dog_dir = f"dog_{int(dog['index']):02d}"
    variant = int(dog["activeVariant"])
    if dog_dir != config["expectedDogDir"] or variant != int(config["expectedVariant"]):
        raise RuntimeError(
            f"{config['caseId']}: source drift; resolved {dog_dir}/variant_{variant:03d}"
        )

    variant_base = level_dir / "dogs" / dog_dir / f"variant_{variant:03d}"
    source_box_raw = _read_json(variant_base.with_suffix(".box.json"))["box"]
    if len(source_box_raw) != 4:
        raise RuntimeError(f"{config['caseId']}: malformed source box")
    source_box = tuple(int(value) for value in source_box_raw)
    sprite_meta = _read_json(level_dir / "dogs" / dog_dir / f"sprite_{variant:03d}.json")
    sprite_box = tuple(int(value) for value in sprite_meta["spriteBox"])

    with Image.open(level_dir / "bg_00.png") as background:
        clean = background.convert("RGB").crop(source_box).copy()
    with Image.open(variant_base.with_suffix(".png")) as painted_source:
        painted = painted_source.convert("RGB").copy()
    if clean.size != painted.size:
        raise RuntimeError(f"{config['caseId']}: clean and painted crop sizes differ")

    return ResolvedCase(
        config=config,
        hitbox=hitbox,
        source_box=source_box,
        sprite_box=sprite_box,
        clean=clean,
        painted=painted,
    )


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _call_openai_edit(
    image: Image.Image,
    prompt: str,
    *,
    size: str,
    quality: str,
) -> tuple[Image.Image, dict[str, Any], float]:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    started = time.monotonic()
    response = httpx.post(
        "https://api.openai.com/v1/images/edits",
        files={"image": ("reference.png", _png_bytes(image), "image/png")},
        data={
            "model": MODEL,
            "prompt": prompt,
            "size": size,
            "quality": quality,
            "output_format": "png",
            "n": "1",
        },
        headers={"Authorization": f"Bearer {key}"},
        timeout=420.0,
    )
    elapsed = time.monotonic() - started
    if response.status_code != 200:
        raise RuntimeError(f"OpenAI image edit failed {response.status_code}: {response.text[:500]}")
    payload = response.json()
    try:
        raw = base64.b64decode(payload["data"][0]["b64_json"])
        generated = Image.open(io.BytesIO(raw)).convert("RGB")
    except (KeyError, IndexError, ValueError) as exc:
        raise RuntimeError("OpenAI response did not contain a decodable image") from exc
    return generated, payload.get("usage") or {}, elapsed


def _estimated_cost_usd(usage: dict[str, Any]) -> float | None:
    """Estimate standard-tier cost from the 2026-08-03 official token rates."""
    details = usage.get("input_tokens_details") or {}
    output_details = usage.get("output_tokens_details") or {}
    text_input = int(details.get("text_tokens") or 0)
    image_input = int(details.get("image_tokens") or 0)
    image_output = int(output_details.get("image_tokens") or usage.get("output_tokens") or 0)
    if not any((text_input, image_input, image_output)):
        return None
    return round(text_input * 5e-6 + image_input * 8e-6 + image_output * 30e-6, 6)


def _estimate_background_field(rgb: np.ndarray) -> tuple[np.ndarray, float]:
    """Fit the model's unwanted smooth magenta gradient from border pixels."""
    height, width, _ = rgb.shape
    border_width = max(4, round(min(width, height) * 0.035))
    yy, xx = np.mgrid[0:height, 0:width]
    x = xx.astype(np.float32) / max(1, width - 1)
    y = yy.astype(np.float32) / max(1, height - 1)
    features = np.stack(
        (
            np.ones_like(x),
            x,
            y,
            x * y,
            x * x,
            y * y,
            x * x * x,
            y * y * y,
        ),
        axis=-1,
    )
    border = (xx < border_width) | (xx >= width - border_width) | (yy < border_width) | (
        yy >= height - border_width
    )
    coefficients, *_ = np.linalg.lstsq(features[border], rgb[border], rcond=None)
    background = np.clip(features @ coefficients, 0.0, 255.0)
    channel_range = np.maximum(background, 255.0 - background)
    residual = np.max(np.abs(rgb - background) / np.maximum(channel_range, 1.0), axis=2)
    noise_floor = float(np.quantile(residual[border], 0.997))
    return background, min(noise_floor, 0.12)


def chroma_key(image: Image.Image) -> Image.Image:
    """Recover antialiased RGBA from a model-rendered magenta background."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    background, noise_floor = _estimate_background_field(rgb)
    # C=aF+(1-a)B. The largest channel departure from the fitted background,
    # normalized by that channel's possible range, is a conservative alpha
    # estimate when magenta is forbidden in the subject.
    channel_range = np.maximum(background, 255.0 - background)
    raw_alpha = np.max(np.abs(rgb - background) / np.maximum(channel_range, 1.0), axis=2)
    alpha = np.clip((raw_alpha - noise_floor) / max(1e-6, 1.0 - noise_floor), 0.0, 1.0)
    # Keep only the subject connected component, then retain two pixels of its
    # low-alpha antialiased fringe. This removes smooth-fit residual at the
    # canvas borders and guarantees there are no satellite fragments.
    labels, component_count = ndimage.label(alpha >= 0.10)
    if component_count == 0:
        raise RuntimeError("chroma key found no foreground component")
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    subject = labels == int(np.argmax(areas))
    support = ndimage.binary_dilation(subject, iterations=2)
    alpha[~support] = 0.0
    alpha[alpha < 0.008] = 0.0
    # Color distance only provides a lower bound on alpha: an opaque pale bird
    # can share red/blue values with magenta. Make the component interior fully
    # opaque and reserve decontamination for its narrow antialiased boundary.
    interior = ndimage.binary_erosion(subject, iterations=2)
    alpha[interior] = 1.0
    safe_alpha = np.maximum(alpha[:, :, None], 1.0 / 255.0)
    foreground = (rgb - (1.0 - alpha[:, :, None]) * background) / safe_alpha
    foreground = np.clip(foreground, 0.0, 255.0)
    rgba = np.dstack((foreground, alpha[:, :, None] * 255.0)).astype(np.uint8)
    result = Image.fromarray(rgba, mode="RGBA")
    bbox = result.getchannel("A").point(lambda value: 255 if value >= 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("chroma key produced an empty cutout")
    left, top, right, bottom = bbox
    padding = max(4, round(max(right - left, bottom - top) * 0.025))
    crop_box = (
        max(0, left - padding),
        max(0, top - padding),
        min(result.width, right + padding),
        min(result.height, bottom + padding),
    )
    return result.crop(crop_box)


def _composite_exact_cutout(case: ResolvedCase, cutout: Image.Image) -> Image.Image:
    sx0, sy0, sx1, sy1 = case.sprite_box
    source_x0, source_y0, _, _ = case.source_box
    target_w = max(1, sx1 - sx0)
    target_h = max(1, sy1 - sy0)
    scale = min(target_w / cutout.width, target_h / cutout.height)
    resized = cutout.resize(
        (max(1, round(cutout.width * scale)), max(1, round(cutout.height * scale))),
        Image.Resampling.LANCZOS,
    )
    target_cx = (sx0 + sx1) / 2 - source_x0
    target_cy = (sy0 + sy1) / 2 - source_y0
    paste_x = round(target_cx - resized.width / 2)
    paste_y = round(target_cy - resized.height / 2)
    composite = case.clean.convert("RGBA")
    composite.alpha_composite(resized, (paste_x, paste_y))
    return composite


def _cream_preview(cutout: Image.Image, size: int = 768) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), CREAM)
    max_subject = round(size * 0.82)
    scale = min(max_subject / cutout.width, max_subject / cutout.height, 2.0)
    preview = cutout.resize(
        (max(1, round(cutout.width * scale)), max(1, round(cutout.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas.alpha_composite(preview, ((size - preview.width) // 2, (size - preview.height) // 2))
    return canvas


def _flat_prompt() -> str:
    return (
        "Create a reusable 2D game sprite from the reference image. Repaint the exact same individual "
        "bird alone, centered, on a perfectly uniform solid chroma-key background #FF00FF. Preserve its "
        "pose, proportions, species, colors, markings, expression, thick dark sticker outline, feet, wings, "
        "tail, and every held or worn object. Remove all scenery, perches, rocks, water, reflections, and cast "
        "shadows. Keep the whole bird and its object fully visible with generous padding. Exactly one bird. "
        "Do not use magenta, pink, or fuchsia anywhere on the bird. The background must be flat pixel-solid "
        "#FF00FF edge to edge, with no texture, vignette, gradient, shadow, or other marks. Output only the image."
    )


def _paired_prompt() -> str:
    return (
        "Return one 2:1 landscape image containing two equal square panels and no border or labels. LEFT panel: "
        "reproduce the reference scene crop exactly, including the bird. RIGHT panel: the exact same individual "
        "bird in the exact same pose and with every held object, isolated on perfectly flat solid #FF00FF. The bird "
        "must be identical between panels. In the right panel remove all scenery, perches, water, reflections, and "
        "shadows; keep the whole dark outline and generous padding. Do not use magenta on the bird. Output only the "
        "two-panel image."
    )


def run_flat(case: ResolvedCase, out_root: Path, quality: str) -> dict[str, Any]:
    case_dir = out_root / "flat-first" / case.case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    generated, usage, elapsed = _call_openai_edit(
        case.painted,
        _flat_prompt(),
        size="1024x1024",
        quality=quality,
    )
    cutout = chroma_key(generated)
    composite = _composite_exact_cutout(case, cutout)
    candidate_path = out_root / "candidates" / case.level_id / f"{case.dog_dir}.png"
    candidate_path.parent.mkdir(parents=True, exist_ok=True)

    case.clean.save(case_dir / "clean.png")
    case.painted.save(case_dir / "painted-reference.png")
    generated.save(case_dir / "generated-flat.png")
    cutout.save(case_dir / "cutout.png")
    cutout.save(candidate_path)
    _cream_preview(cutout).save(case_dir / "cutout-on-cream.png")
    composite.save(case_dir / "deterministic-composite.png")
    result = {
        "caseId": case.case_id,
        "mode": "flat-first",
        "model": MODEL,
        "quality": quality,
        "size": "1024x1024",
        "elapsedSeconds": round(elapsed, 3),
        "usage": usage,
        "estimatedCostUsd": _estimated_cost_usd(usage),
        "candidatePath": str(candidate_path),
        "note": case.config["note"],
    }
    _atomic_json(case_dir / "result.json", result)
    return result


def rekey_flat(case: ResolvedCase, out_root: Path) -> dict[str, Any]:
    case_dir = out_root / "flat-first" / case.case_id
    raw_path = case_dir / "generated-flat.png"
    if not raw_path.exists():
        raise RuntimeError(f"{case.case_id}: missing paid-call output {raw_path}")
    with Image.open(raw_path) as raw:
        cutout = chroma_key(raw)
    composite = _composite_exact_cutout(case, cutout)
    candidate_path = out_root / "candidates" / case.level_id / f"{case.dog_dir}.png"
    candidate_path.parent.mkdir(parents=True, exist_ok=True)
    cutout.save(case_dir / "cutout.png")
    cutout.save(candidate_path)
    _cream_preview(cutout).save(case_dir / "cutout-on-cream.png")
    composite.save(case_dir / "deterministic-composite.png")
    return {"caseId": case.case_id, "mode": "rekey", "candidatePath": str(candidate_path)}


def run_paired(case: ResolvedCase, out_root: Path, quality: str) -> dict[str, Any]:
    case_dir = out_root / "paired-output" / case.case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    generated, usage, elapsed = _call_openai_edit(
        case.painted,
        _paired_prompt(),
        size="2048x1024",
        quality=quality,
    )
    midpoint = generated.width // 2
    scene_panel = generated.crop((0, 0, midpoint, generated.height))
    flat_panel = generated.crop((midpoint, 0, generated.width, generated.height))
    cutout = chroma_key(flat_panel)
    generated.save(case_dir / "generated-pair.png")
    scene_panel.save(case_dir / "scene-panel.png")
    flat_panel.save(case_dir / "flat-panel.png")
    cutout.save(case_dir / "cutout.png")
    _cream_preview(cutout).save(case_dir / "cutout-on-cream.png")
    result = {
        "caseId": case.case_id,
        "mode": "paired-output",
        "model": MODEL,
        "quality": quality,
        "size": "2048x1024",
        "elapsedSeconds": round(elapsed, 3),
        "usage": usage,
        "estimatedCostUsd": _estimated_cost_usd(usage),
        "note": case.config["note"],
    }
    _atomic_json(case_dir / "result.json", result)
    return result


def _fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    source = image.convert("RGBA")
    scale = min(target_w / source.width, target_h / source.height)
    resized = source.resize(
        (max(1, round(source.width * scale)), max(1, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", size, (255, 255, 255, 255))
    canvas.alpha_composite(resized, ((target_w - resized.width) // 2, (target_h - resized.height) // 2))
    return canvas


def render_sheet(cases: list[ResolvedCase], out_root: Path) -> Path:
    cell_w, cell_h = 360, 330
    label_w, header_h = 420, 74
    columns = ["clean source", "current painted", "generated flat", "cutout on cream", "exact composite"]
    canvas = Image.new("RGB", (label_w + len(columns) * cell_w, header_h + len(cases) * cell_h), (41, 38, 34))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    for index, label in enumerate(columns):
        draw.text((label_w + index * cell_w + 14, 28), label, fill=(255, 247, 228), font=font)
    for row, case in enumerate(cases):
        y = header_h + row * cell_h
        draw.rectangle((0, y, label_w, y + cell_h), fill=(240, 231, 211))
        draw.multiline_text(
            (18, y + 24),
            f"{case.case_id}\n{case.level_id}/{case.dog_dir}\nr={case.hitbox['r']}\n{case.config['note']}",
            fill=(43, 39, 34),
            font=font,
            spacing=7,
        )
        case_dir = out_root / "flat-first" / case.case_id
        paths = [
            case_dir / "clean.png",
            case_dir / "painted-reference.png",
            case_dir / "generated-flat.png",
            case_dir / "cutout-on-cream.png",
            case_dir / "deterministic-composite.png",
        ]
        for column, path in enumerate(paths):
            cell_x = label_w + column * cell_w
            draw.rectangle((cell_x, y, cell_x + cell_w, y + cell_h), fill=(255, 255, 255))
            if path.exists():
                with Image.open(path) as image:
                    fitted = _fit(image, (cell_w - 16, cell_h - 16)).convert("RGB")
                canvas.paste(fitted, (cell_x + 8, y + 8))
            else:
                draw.text((cell_x + 18, y + 24), f"missing:\n{path.name}", fill=(140, 40, 40), font=font)
    sheet = out_root / "flat-first-samples.png"
    canvas.save(sheet)
    return sheet


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("validate", "flat", "rekey", "paired", "sheet"))
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--case", action="append", dest="case_ids")
    parser.add_argument("--out", type=Path, default=Path(".work/cutout-ticket-16"))
    parser.add_argument("--quality", choices=("low", "medium", "high"), default="low")
    args = parser.parse_args()

    manifest = _read_json(args.cases)
    source_root = Path(manifest["sourceRoot"])
    selected = [
        config
        for config in manifest["cases"]
        if not args.case_ids or config["caseId"] in set(args.case_ids)
    ]
    if args.case_ids and len(selected) != len(set(args.case_ids)):
        known = {config["caseId"] for config in manifest["cases"]}
        raise RuntimeError(f"unknown cases: {sorted(set(args.case_ids) - known)}")
    cases = [resolve_case(config, source_root) for config in selected]
    if args.command == "validate":
        for case in cases:
            print(f"valid {case.case_id}: {case.level_id}/{case.dog_dir} id={case.config['birdId']}")
        return 0
    if args.command == "flat":
        results = [run_flat(case, args.out, args.quality) for case in cases]
    elif args.command == "rekey":
        results = [rekey_flat(case, args.out) for case in cases]
    elif args.command == "paired":
        results = [run_paired(case, args.out, args.quality) for case in cases]
    else:
        print(render_sheet(cases, args.out))
        return 0
    ledger_path = args.out / f"{args.command}-ledger.json"
    _atomic_json(
        ledger_path,
        {
            "model": MODEL,
            "quality": args.quality,
            "results": results,
            "estimatedTotalCostUsd": round(
                sum(item.get("estimatedCostUsd") or 0 for item in results), 6
            ),
        },
    )
    print(ledger_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
