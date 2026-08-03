#!/usr/bin/env python3
"""Build the bounded synthetic pilot for wayfinder ticket 27.

The authoring sessions are read-only. Generated flat-key images, exact-alpha
training pairs, holdout priors, and ledgers are written only below ``--work``.
The 20-case benchmark is excluded from synthetic source selection by stable ID.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
EVIDENCE_ROOT = HERE.parent
BENCHMARK_MANIFEST = (
    EVIDENCE_ROOT / "2026-08-03-cutout-benchmark" / "benchmark-manifest.json"
)
GENERATION_SCRIPT = (
    EVIDENCE_ROOT / "2026-08-03-generation-time-extraction" / "run_experiment.py"
)
SOURCE_ROOT = Path(
    "/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels"
)
MODEL = "gpt-image-2"
SEED = 27082026
CANVAS_SIZE = 640
AUGMENTATIONS_PER_BIRD = 8
EXCLUDED_GENERATED = {
    "fairytale_forest_mushroom_cottage_glade_bird_d894__dog_17": (
        "manual synthetic-sheet review: generated cutout retained a perch branch"
    ),
    "square_hawaii_waterfall_flash_4k__dog_13": (
        "manual synthetic-sheet review: generated cutout retained detached ground debris"
    ),
}

# Related prompts/variants never cross this scene-level boundary.
TRAIN_LEVELS = (
    "fairytale_forest_mushroom_cottage_glade_bird_d894",
    "japan_morning_market_bird_a7a0",
    "japan_morning_market_bird_e99f",
    "morning_fairytale_glade_flash_close",
    "morning_japan_market_pro_standard",
    "morning_japan_market_pro_wide",
    "morning_pirate_cove_pro_standard",
    "pirate_shipwreck_island_dock_fragment_hideout_bird_f22b__cmp_crop",
    "pirate_shipwreck_island_jungle_cave_shore_bird_04e0__cmp_crop",
    "pirate_shipwreck_island_palm_root_ship_ribs_bird_0e47__cmp_crop",
    "square_grand_bazaar_flash_4k",
    "square_sami_aurora_flash_4k",
)
VALIDATION_LEVELS = (
    "italy_venice_canal_morning_bird_d570",
    "japan_morning_market_bird_a53a",
    "pirate_shipwreck_island_broken_bow_lagoon_bird_c8a9__cmp_crop",
    "square_hawaii_waterfall_flash_4k",
)


class PilotError(RuntimeError):
    """An input or output violates the locked pilot contract."""


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise PilotError(f"cannot read JSON {path}: {exc}") from exc


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def _load_generation_module():
    spec = importlib.util.spec_from_file_location(
        "ticket16_generation", GENERATION_SCRIPT
    )
    if spec is None or spec.loader is None:
        raise PilotError(f"cannot import {GENERATION_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _resolved_active_birds(level_id: str) -> list[dict[str, Any]]:
    level_dir = SOURCE_ROOT / level_id
    session = _read_json(level_dir / "session.json")
    hitboxes = _read_json(level_dir / "hitboxes.json")
    hitbox_by_id = {str(hitbox["id"]): hitbox for hitbox in hitboxes}
    if len(hitbox_by_id) != len(hitboxes):
        raise PilotError(f"{level_id}: duplicate hitbox IDs")
    rows: list[dict[str, Any]] = []
    for dog in session.get("dogs", []):
        bird_id = str(dog.get("id") or "")
        if not bird_id or bird_id not in hitbox_by_id:
            continue
        index = int(dog["index"])
        variant = int(dog["activeVariant"])
        dog_dir = f"dog_{index:02d}"
        variant_base = level_dir / "dogs" / dog_dir / f"variant_{variant:03d}"
        image_path = variant_base.with_suffix(".png")
        box_path = variant_base.with_suffix(".box.json")
        if not image_path.is_file() or not box_path.is_file():
            continue
        box = [int(value) for value in _read_json(box_path)["box"]]
        hitbox = hitbox_by_id[bird_id]
        rows.append(
            {
                "levelId": level_id,
                "birdId": bird_id,
                "dogDir": dog_dir,
                "activeVariant": variant,
                "hitbox": {
                    "x": int(hitbox["x"]),
                    "y": int(hitbox["y"]),
                    "r": int(hitbox["r"]),
                },
                "sourceBox": box,
                "paintedCrop": str(image_path.relative_to(SOURCE_ROOT)),
            }
        )
    return rows


def _pick_radius_extremes(
    rows: list[dict[str, Any]], excluded_ids: set[str]
) -> list[dict[str, Any]]:
    eligible = [row for row in rows if row["birdId"] not in excluded_ids]
    eligible.sort(key=lambda row: (int(row["hitbox"]["r"]), row["birdId"]))
    if len(eligible) < 2:
        raise PilotError("a selected scene has fewer than two non-holdout active birds")
    return [eligible[0], eligible[-1]]


def build_manifest(path: Path) -> dict[str, Any]:
    benchmark = _read_json(BENCHMARK_MANIFEST)
    holdout_ids = {str(case["birdId"]) for case in benchmark["cases"]}
    rows: list[dict[str, Any]] = []
    for split, levels in (("train", TRAIN_LEVELS), ("validation", VALIDATION_LEVELS)):
        for level_id in levels:
            for row in _pick_radius_extremes(
                _resolved_active_birds(level_id), holdout_ids
            ):
                row = dict(row)
                row["split"] = split
                row["caseId"] = f"{level_id}__{row['dogDir']}"
                rows.append(row)
    if len(rows) != 32 or len({row["birdId"] for row in rows}) != 32:
        raise PilotError("pilot selection must contain 32 unique birds")
    if holdout_ids & {row["birdId"] for row in rows}:
        raise PilotError("locked benchmark bird leaked into the synthetic pilot")
    payload = {
        "schemaVersion": 1,
        "ticket": "https://github.com/batu/fabrikav2/issues/27",
        "seed": SEED,
        "sourceRoot": str(SOURCE_ROOT),
        "sourceReadOnly": True,
        "lockedHoldoutManifest": str(BENCHMARK_MANIFEST),
        "lockedHoldoutBirdIds": sorted(holdout_ids),
        "selection": "Two radius-extreme non-holdout active birds per selected scene level.",
        "splitPolicy": "Scene-level split: no level, prompt family, bird, or variant crosses train/validation.",
        "generator": {"model": MODEL, "quality": "low", "size": "1024x1024"},
        "cases": rows,
    }
    _atomic_json(path, payload)
    return payload


def _generate_one(
    case: dict[str, Any], out_root: Path, generation: Any
) -> dict[str, Any]:
    case_dir = out_root / "flat-key" / case["caseId"]
    result_path = case_dir / "result.json"
    if result_path.is_file() and (case_dir / "cutout.png").is_file():
        return _read_json(result_path)
    case_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(SOURCE_ROOT / case["paintedCrop"]) as source:
        reference = source.convert("RGB")
    generated, usage, elapsed = generation._call_openai_edit(
        reference,
        generation._flat_prompt(),
        size="1024x1024",
        quality="low",
    )
    cutout = generation.chroma_key(generated)
    generated.save(case_dir / "generated-flat.png")
    cutout.save(case_dir / "cutout.png")
    alpha = np.asarray(cutout.getchannel("A"), dtype=np.uint8)
    record = {
        "caseId": case["caseId"],
        "birdId": case["birdId"],
        "levelId": case["levelId"],
        "split": case["split"],
        "model": MODEL,
        "quality": "low",
        "size": "1024x1024",
        "elapsedSeconds": round(elapsed, 3),
        "usage": usage,
        "estimatedCostUsd": generation._estimated_cost_usd(usage),
        "cutoutSize": list(cutout.size),
        "alphaPixels": int(np.count_nonzero(alpha)),
        "partialAlphaPixels": int(np.count_nonzero((alpha > 0) & (alpha < 255))),
    }
    _atomic_json(result_path, record)
    return record


def generate(manifest: dict[str, Any], work: Path, workers: int) -> dict[str, Any]:
    if not os.environ.get("OPENAI_API_KEY"):
        raise PilotError("OPENAI_API_KEY is not set")
    generation = _load_generation_module()
    started = time.monotonic()
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_generate_one, case, work, generation): case
            for case in manifest["cases"]
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            print(
                f"[{completed}/{len(futures)}] {result['caseId']} "
                f"${result.get('estimatedCostUsd') or 0:.4f}",
                flush=True,
            )
    results.sort(key=lambda row: row["caseId"])
    total_cost = round(sum(row.get("estimatedCostUsd") or 0 for row in results), 6)
    if total_cost > 1.0:
        raise PilotError(
            f"synthetic pilot exceeded its $1.00 generation cap: ${total_cost:.4f}"
        )
    ledger = {
        "schemaVersion": 1,
        "calls": len(results),
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "estimatedTotalCostUsd": total_cost,
        "results": results,
    }
    _atomic_json(work / "generation-ledger.json", ledger)
    return ledger


def _transformed_cutout(cutout: Image.Image, rng: random.Random) -> Image.Image:
    target = rng.randint(90, 350)
    scale = target / max(cutout.width, cutout.height)
    resized = cutout.resize(
        (max(1, round(cutout.width * scale)), max(1, round(cutout.height * scale))),
        Image.Resampling.LANCZOS,
    )
    return resized.rotate(
        rng.uniform(-8.0, 8.0), resample=Image.Resampling.BICUBIC, expand=True
    )


def _trimap_from_exact_alpha(alpha: np.ndarray, rng: random.Random) -> np.ndarray:
    subject = (alpha >= 4).astype(np.uint8)
    erode_px = rng.randint(2, 12)
    dilate_px = rng.randint(8, 42)
    foreground = cv2.erode(
        subject,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * erode_px + 1,) * 2),
    )
    possible = cv2.dilate(
        subject,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilate_px + 1,) * 2),
    )
    # Real registered differences retain changed scenery. Synthetic unknown-only
    # distractors teach the model that trimap topology is a hint, not truth.
    height, width = subject.shape
    for _ in range(rng.randint(0, 3)):
        cx = rng.randint(0, width - 1)
        cy = rng.randint(0, height - 1)
        radius = rng.randint(8, 45)
        cv2.circle(possible, (cx, cy), radius, 1, -1)
    trimap = np.full(subject.shape, 128, dtype=np.uint8)
    trimap[possible == 0] = 0
    trimap[foreground == 1] = 255
    return trimap


def compose(manifest: dict[str, Any], work: Path) -> dict[str, Any]:
    pairs_root = work / "synthetic-pairs"
    rows: list[dict[str, Any]] = []
    for case_index, case in enumerate(manifest["cases"]):
        if case["caseId"] in EXCLUDED_GENERATED:
            continue
        cutout_path = work / "flat-key" / case["caseId"] / "cutout.png"
        if not cutout_path.is_file():
            raise PilotError(f"missing generated cutout {cutout_path}")
        with Image.open(cutout_path) as source:
            cutout = source.convert("RGBA")
        with Image.open(SOURCE_ROOT / case["levelId"] / "bg_00.png") as source:
            background = source.convert("RGB")
        for augmentation in range(AUGMENTATIONS_PER_BIRD):
            pair_seed = SEED + case_index * 1009 + augmentation
            rng = random.Random(pair_seed)
            if background.width < CANVAS_SIZE or background.height < CANVAS_SIZE:
                raise PilotError(
                    f"{case['levelId']}: background smaller than training canvas"
                )
            crop_x = rng.randint(0, background.width - CANVAS_SIZE)
            crop_y = rng.randint(0, background.height - CANVAS_SIZE)
            canvas = background.crop(
                (crop_x, crop_y, crop_x + CANVAS_SIZE, crop_y + CANVAS_SIZE)
            ).convert("RGBA")
            sprite = _transformed_cutout(cutout, rng)
            x = rng.randint(10, max(10, CANVAS_SIZE - sprite.width - 10))
            y = rng.randint(10, max(10, CANVAS_SIZE - sprite.height - 10))
            alpha_canvas = Image.new("L", (CANVAS_SIZE, CANVAS_SIZE), 0)
            alpha_canvas.paste(sprite.getchannel("A"), (x, y))
            canvas.alpha_composite(sprite, (x, y))
            alpha = np.asarray(alpha_canvas, dtype=np.uint8)
            trimap = _trimap_from_exact_alpha(alpha, rng)
            pair_id = f"{case['caseId']}__a{augmentation:02d}"
            pair_dir = pairs_root / case["split"] / pair_id
            pair_dir.mkdir(parents=True, exist_ok=True)
            canvas.convert("RGB").save(pair_dir / "image.png", optimize=True)
            Image.fromarray(trimap, mode="L").save(
                pair_dir / "trimap.png", optimize=True
            )
            alpha_canvas.save(pair_dir / "alpha.png", optimize=True)
            rows.append(
                {
                    "pairId": pair_id,
                    "split": case["split"],
                    "caseId": case["caseId"],
                    "birdId": case["birdId"],
                    "levelId": case["levelId"],
                    "augmentation": augmentation,
                    "seed": pair_seed,
                    "backgroundCrop": [
                        crop_x,
                        crop_y,
                        crop_x + CANVAS_SIZE,
                        crop_y + CANVAS_SIZE,
                    ],
                    "spritePlacement": [x, y, x + sprite.width, y + sprite.height],
                    "path": str(pair_dir.relative_to(work)),
                }
            )
    dataset = {
        "schemaVersion": 1,
        "seed": SEED,
        "canvasSize": [CANVAS_SIZE, CANVAS_SIZE],
        "augmentationsPerBird": AUGMENTATIONS_PER_BIRD,
        "pairs": len(rows),
        "trainPairs": sum(row["split"] == "train" for row in rows),
        "validationPairs": sum(row["split"] == "validation" for row in rows),
        "splitPolicy": manifest["splitPolicy"],
        "excludedGenerated": [
            {"caseId": case_id, "reason": reason}
            for case_id, reason in EXCLUDED_GENERATED.items()
        ],
        "rows": rows,
    }
    _atomic_json(work / "synthetic-dataset.json", dataset)
    return dataset


def render_generated_sheet(manifest: dict[str, Any], work: Path) -> Path:
    cell = 300
    label_height = 42
    columns = 4
    rows = math.ceil(len(manifest["cases"]) / columns)
    sheet = Image.new(
        "RGBA", (columns * cell, rows * (cell + label_height)), (255, 248, 232, 255)
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, case in enumerate(manifest["cases"]):
        x = (index % columns) * cell
        y = (index // columns) * (cell + label_height)
        path = work / "flat-key" / case["caseId"] / "cutout.png"
        with Image.open(path) as source:
            cutout = source.convert("RGBA")
        scale = min((cell - 24) / cutout.width, (cell - 24) / cutout.height, 1.5)
        preview = cutout.resize(
            (max(1, round(cutout.width * scale)), max(1, round(cutout.height * scale))),
            Image.Resampling.LANCZOS,
        )
        sheet.alpha_composite(
            preview, (x + (cell - preview.width) // 2, y + (cell - preview.height) // 2)
        )
        draw.rectangle(
            (x, y + cell, x + cell, y + cell + label_height), fill=(41, 38, 34, 255)
        )
        draw.text(
            (x + 8, y + cell + 7),
            f"{case['split']} | {case['levelId'][:25]}\n{case['dogDir']}",
            fill=(255, 248, 232, 255),
            font=font,
        )
    output = work / "synthetic-flat-key-sheet.png"
    sheet.convert("RGB").save(output, optimize=True)
    return output


def _focus_changed_mask(
    clean: np.ndarray,
    painted: np.ndarray,
    *,
    cx: float,
    cy: float,
    radius: float,
) -> np.ndarray:
    delta = np.max(np.abs(painted.astype(np.int16) - clean.astype(np.int16)), axis=2)
    height, width = delta.shape
    yy, xx = np.ogrid[:height, :width]
    roi = ((xx - cx) ** 2 + (yy - cy) ** 2) <= max(6.0, radius * 2.15) ** 2
    changed = ((delta >= 11) & roi).astype(np.uint8)
    bridge = max(1, round(radius * 0.07))
    changed = cv2.morphologyEx(
        changed,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bridge * 2 + 1,) * 2),
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(changed, connectivity=8)
    core = ((xx - cx) ** 2 + (yy - cy) ** 2) <= max(4.0, radius * 0.78) ** 2
    selected = np.zeros_like(changed)
    for label in range(1, count):
        component = labels == label
        if (
            np.count_nonzero(component & core)
            or int(stats[label, cv2.CC_STAT_AREA]) >= radius**2 * 0.025
        ):
            selected[component] = 1
    if not np.any(selected):
        cv2.circle(selected, (round(cx), round(cy)), max(2, round(radius * 0.4)), 1, -1)
    return selected


def _holdout_trimap(mask: np.ndarray, delta: np.ndarray, radius: float) -> np.ndarray:
    possible_px = max(4, round(radius * 0.22))
    possible = cv2.dilate(
        mask,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (possible_px * 2 + 1,) * 2),
    )
    strong = ((delta >= 48) & (mask > 0)).astype(np.uint8)
    foreground_px = max(1, round(radius * 0.035))
    foreground = cv2.erode(
        strong,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (foreground_px * 2 + 1,) * 2),
    )
    trimap = np.full(mask.shape, 128, dtype=np.uint8)
    trimap[possible == 0] = 0
    trimap[foreground == 1] = 255
    return trimap


def prepare_holdout(work: Path) -> dict[str, Any]:
    manifest = _read_json(BENCHMARK_MANIFEST)
    input_root = work / "holdout-inputs"
    rows: list[dict[str, Any]] = []
    for case in manifest["cases"]:
        x0, y0, x1, y1 = map(int, case["sourceBox"])
        with Image.open(SOURCE_ROOT / case["levelId"] / "bg_00.png") as source:
            clean = np.asarray(
                source.convert("RGB").crop((x0, y0, x1, y1)), dtype=np.uint8
            )
        with Image.open(SOURCE_ROOT / case["paintedCrop"]) as source:
            painted = np.asarray(source.convert("RGB"), dtype=np.uint8)
        if clean.shape != painted.shape:
            raise PilotError(f"{case['caseId']}: holdout clean/painted mismatch")
        cx = float(case["hitbox"]["x"]) - x0
        cy = float(case["hitbox"]["y"]) - y0
        radius = float(case["hitbox"]["r"])
        mask = _focus_changed_mask(clean, painted, cx=cx, cy=cy, radius=radius)
        delta = np.max(
            np.abs(painted.astype(np.int16) - clean.astype(np.int16)), axis=2
        )
        trimap = _holdout_trimap(mask, delta, radius)
        case_dir = input_root / case["caseId"]
        case_dir.mkdir(parents=True, exist_ok=True)
        Image.fromarray(clean).save(case_dir / "clean.png", optimize=True)
        Image.fromarray(painted).save(case_dir / "painted.png", optimize=True)
        Image.fromarray(mask * 255, mode="L").save(
            case_dir / "registered-mask.png", optimize=True
        )
        Image.fromarray(trimap, mode="L").save(
            case_dir / "registered-trimap.png", optimize=True
        )
        rows.append(
            {
                "caseId": case["caseId"],
                "candidatePath": case["candidatePath"],
                "geometry": {"cx": cx, "cy": cy, "radius": radius},
                "inputDir": str(case_dir.relative_to(work)),
                "changedPixels": int(np.count_nonzero(mask)),
                "unknownPixels": int(np.count_nonzero(trimap == 128)),
                "foregroundPixels": int(np.count_nonzero(trimap == 255)),
            }
        )
    payload = {
        "schemaVersion": 1,
        "locked": True,
        "manifest": str(BENCHMARK_MANIFEST),
        "cases": rows,
    }
    _atomic_json(work / "holdout-prepared.json", payload)
    return payload


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("manifest", "generate", "compose", "sheet", "prepare-holdout", "all"),
    )
    parser.add_argument("--work", type=Path, default=Path(".work/cutout-ticket-27"))
    parser.add_argument("--workers", type=int, default=3)
    return parser


def main() -> int:
    args = _parser().parse_args()
    work = args.work.resolve()
    manifest_path = work / "synthetic-manifest.json"
    manifest = build_manifest(manifest_path)
    if args.command == "manifest":
        print(manifest_path)
        return 0
    if args.command in {"generate", "all"}:
        ledger = generate(manifest, work, args.workers)
        print(
            json.dumps(
                {"calls": ledger["calls"], "cost": ledger["estimatedTotalCostUsd"]}
            )
        )
    if args.command in {"compose", "all"}:
        dataset = compose(manifest, work)
        print(
            json.dumps(
                {
                    "pairs": dataset["pairs"],
                    "train": dataset["trainPairs"],
                    "validation": dataset["validationPairs"],
                }
            )
        )
    if args.command in {"sheet", "all"}:
        print(render_generated_sheet(manifest, work))
    if args.command in {"prepare-holdout", "all"}:
        holdout = prepare_holdout(work)
        print(json.dumps({"holdoutCases": len(holdout["cases"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
