#!/usr/bin/env python3
"""Prepare, import, and measure ticket #17 cutout candidates.

Source authoring sessions are read-only. All generated inputs, model mattes,
sprites, and reports are written below the explicitly supplied work directory.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import time
from pathlib import Path
from typing import Any

import cv2
import httpx
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEFAULT_MANIFEST = HERE.parent / "2026-08-03-cutout-benchmark" / "benchmark-manifest.json"
DEFAULT_SOURCE_ROOT = Path(
    "/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels"
)


class CandidateError(RuntimeError):
    """The benchmark input or a candidate output violates its contract."""


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CandidateError(f"cannot read JSON {path}: {exc}") from exc


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def _open_case(case: dict[str, Any], source_root: Path) -> tuple[np.ndarray, np.ndarray]:
    x0, y0, x1, y1 = map(int, case["sourceBox"])
    level_dir = source_root / case["levelId"]
    with Image.open(level_dir / "bg_00.png") as source:
        clean = np.asarray(source.convert("RGB").crop((x0, y0, x1, y1)), dtype=np.uint8)
    with Image.open(source_root / case["paintedCrop"]) as source:
        painted = np.asarray(source.convert("RGB"), dtype=np.uint8)
    if clean.shape != painted.shape:
        raise CandidateError(f"{case['caseId']}: clean/painted size mismatch")
    return clean, painted


def _local_geometry(case: dict[str, Any]) -> tuple[float, float, float]:
    x0, y0, _, _ = map(float, case["sourceBox"])
    hitbox = case["hitbox"]
    return float(hitbox["x"]) - x0, float(hitbox["y"]) - y0, float(hitbox["r"])


def _sam2_masks(
    painted: np.ndarray,
    *,
    cx: float,
    cy: float,
    radius: float,
    base_url: str,
) -> tuple[np.ndarray, np.ndarray, float]:
    image_buffer = io.BytesIO()
    Image.fromarray(painted).save(image_buffer, format="PNG")
    height, width = painted.shape[:2]
    box_radius = radius * 1.2
    prompt_box = [
        max(0.0, cx - box_radius),
        max(0.0, cy - box_radius),
        min(float(width - 1), cx + box_radius),
        min(float(height - 1), cy + box_radius),
    ]
    started = time.perf_counter()
    response = httpx.post(
        base_url.rstrip("/") + "/predict",
        json={
            "image_png_b64": base64.b64encode(image_buffer.getvalue()).decode(),
            "point": [[cx, cy]],
            "point_labels": [1],
            "box": prompt_box,
            "multimask_output": True,
        },
        timeout=180.0,
    )
    response.raise_for_status()
    elapsed = time.perf_counter() - started
    payload = response.json()
    shape = tuple(int(value) for value in payload["shape"])
    packed = np.frombuffer(base64.b64decode(payload["masks_packed_b64"]), dtype=np.uint8)
    masks = np.unpackbits(packed, count=int(np.prod(shape))).reshape(shape).astype(bool)
    return masks, np.asarray(payload["scores"], dtype=np.float32), elapsed


def _focus_alpha(alpha: np.ndarray, *, cx: float, cy: float, radius: float) -> np.ndarray:
    """Keep the one foreground component anchored to the stable-id hitbox."""
    clipped = np.clip(alpha.astype(np.float32), 0.0, 1.0)
    binary = (clipped >= 0.08).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if count <= 1:
        return clipped

    height, width = binary.shape
    yy, xx = np.ogrid[:height, :width]
    core = ((xx - cx) ** 2 + (yy - cy) ** 2) <= max(3.0, radius * 0.72) ** 2
    best_label = 0
    best_score = -math.inf
    for label in range(1, count):
        component = labels == label
        area = int(stats[label, cv2.CC_STAT_AREA])
        overlap = int(np.count_nonzero(component & core))
        centroid_x, centroid_y = centroids[label]
        distance = math.hypot(float(centroid_x) - cx, float(centroid_y) - cy)
        score = overlap * 1000.0 + area - distance * max(1.0, radius)
        if score > best_score:
            best_score = score
            best_label = label
    if best_label == 0:
        return clipped
    return np.where(labels == best_label, clipped, 0.0)


def _choose_sam2_mask(
    masks: np.ndarray,
    scores: np.ndarray,
    *,
    clean: np.ndarray,
    painted: np.ndarray,
    cx: float,
    cy: float,
    radius: float,
) -> tuple[np.ndarray, int, list[dict[str, float]]]:
    difference = np.max(
        np.abs(painted.astype(np.int16) - clean.astype(np.int16)), axis=2
    ) >= 14
    yy, xx = np.ogrid[: difference.shape[0], : difference.shape[1]]
    roi = ((xx - cx) ** 2 + (yy - cy) ** 2) <= max(4.0, radius * 1.7) ** 2
    target = difference & roi
    target_count = max(1, int(np.count_nonzero(target)))
    diagnostics: list[dict[str, float]] = []
    best_index = 0
    best_score = -math.inf
    for index, raw in enumerate(masks):
        focused = _focus_alpha(raw.astype(np.float32), cx=cx, cy=cy, radius=radius) >= 0.5
        selected = max(1, int(np.count_nonzero(focused)))
        coverage = float(np.count_nonzero(focused & target)) / target_count
        background_fraction = float(np.count_nonzero(focused & ~difference)) / selected
        model_score = float(scores[index]) if index < len(scores) else 0.0
        combined = model_score + 1.4 * coverage - 0.9 * background_fraction
        diagnostics.append(
            {
                "modelScore": model_score,
                "changeCoverage": coverage,
                "lowChangeFraction": background_fraction,
                "selectionScore": combined,
            }
        )
        if combined > best_score:
            best_score = combined
            best_index = index
    chosen = _focus_alpha(
        masks[best_index].astype(np.float32), cx=cx, cy=cy, radius=radius
    )
    return chosen, best_index, diagnostics


def _soften_binary(mask: np.ndarray) -> np.ndarray:
    binary = (mask >= 0.5).astype(np.uint8)
    inside = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    outside = cv2.distanceTransform(1 - binary, cv2.DIST_L2, 5)
    signed = inside - outside
    return np.clip(0.5 + signed / 2.2, 0.0, 1.0).astype(np.float32)


def _trimap_from_mask(mask: np.ndarray, radius: float) -> np.ndarray:
    binary = (mask >= 0.5).astype(np.uint8)
    erode_px = max(1, round(radius * 0.045))
    dilate_px = max(2, round(radius * 0.12))
    erode_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (erode_px * 2 + 1, erode_px * 2 + 1)
    )
    dilate_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (dilate_px * 2 + 1, dilate_px * 2 + 1)
    )
    foreground = cv2.erode(binary, erode_kernel)
    possible = cv2.dilate(binary, dilate_kernel)
    trimap = np.full(binary.shape, 128, dtype=np.uint8)
    trimap[possible == 0] = 0
    trimap[foreground == 1] = 255
    return trimap


def _decontaminated_rgba(
    painted: np.ndarray,
    clean: np.ndarray,
    alpha: np.ndarray,
) -> np.ndarray:
    a = np.clip(alpha.astype(np.float32), 0.0, 1.0)[..., None]
    painted_f = painted.astype(np.float32) / 255.0
    clean_f = clean.astype(np.float32) / 255.0
    divisor = np.maximum(a, 0.035)
    foreground = (painted_f - (1.0 - a) * clean_f) / divisor
    foreground = np.where(a >= 0.035, foreground, painted_f)
    foreground = np.clip(foreground, 0.0, 1.0)
    rgba = np.zeros((*alpha.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.rint(foreground * 255.0).astype(np.uint8)
    rgba[..., 3] = np.rint(a[..., 0] * 255.0).astype(np.uint8)
    rgba[rgba[..., 3] == 0, :3] = 0
    return rgba


def _write_sprite(
    path: Path,
    *,
    painted: np.ndarray,
    clean: np.ndarray,
    alpha: np.ndarray,
    cx: float,
    cy: float,
    radius: float,
) -> dict[str, Any]:
    focused = _focus_alpha(alpha, cx=cx, cy=cy, radius=radius)
    rgba = _decontaminated_rgba(painted, clean, focused)
    ys, xs = np.nonzero(rgba[..., 3] >= 2)
    if not len(xs):
        raise CandidateError(f"empty alpha for {path}")
    padding = max(3, round(radius * 0.035))
    x0 = max(0, int(xs.min()) - padding)
    y0 = max(0, int(ys.min()) - padding)
    x1 = min(rgba.shape[1], int(xs.max()) + padding + 1)
    y1 = min(rgba.shape[0], int(ys.max()) + padding + 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA").save(path, optimize=True)
    return {
        "path": str(path),
        "cropBox": [x0, y0, x1, y1],
        "size": [x1 - x0, y1 - y0],
        "alphaMin": int(rgba[..., 3].min()),
        "alphaMax": int(rgba[..., 3].max()),
    }


def _prepare(args: argparse.Namespace) -> int:
    manifest = _read_json(args.manifest)
    work = args.work.resolve()
    input_root = work / "inputs"
    sam2_root = work / "candidates" / "sam2-native"
    records: list[dict[str, Any]] = []
    total_sam2_seconds = 0.0
    for index, case in enumerate(manifest["cases"], start=1):
        clean, painted = _open_case(case, args.source_root)
        cx, cy, radius = _local_geometry(case)
        masks, scores, elapsed = _sam2_masks(
            painted,
            cx=cx,
            cy=cy,
            radius=radius,
            base_url=args.sam2_url,
        )
        total_sam2_seconds += elapsed
        alpha, chosen_index, diagnostics = _choose_sam2_mask(
            masks,
            scores,
            clean=clean,
            painted=painted,
            cx=cx,
            cy=cy,
            radius=radius,
        )
        case_dir = input_root / case["caseId"]
        case_dir.mkdir(parents=True, exist_ok=True)
        Image.fromarray(clean).save(case_dir / "clean.png")
        Image.fromarray(painted).save(case_dir / "painted.png")
        Image.fromarray(np.uint8(alpha * 255), mode="L").save(case_dir / "sam2-mask.png")
        trimap = _trimap_from_mask(alpha, radius)
        Image.fromarray(trimap, mode="L").save(case_dir / "trimap.png")
        sprite_record = _write_sprite(
            sam2_root / case["candidatePath"],
            painted=painted,
            clean=clean,
            alpha=_soften_binary(alpha),
            cx=cx,
            cy=cy,
            radius=radius,
        )
        records.append(
            {
                "caseId": case["caseId"],
                "candidatePath": case["candidatePath"],
                "inputDir": str(Path("inputs") / case["caseId"]),
                "geometry": {"cx": cx, "cy": cy, "radius": radius},
                "sam2": {
                    "elapsedSeconds": round(elapsed, 4),
                    "chosenMask": chosen_index,
                    "masks": diagnostics,
                },
                "sam2Sprite": sprite_record,
            }
        )
        print(f"[{index}/{len(manifest['cases'])}] {case['caseId']}: SAM2 mask {chosen_index}")
    prepared = {
        "schemaVersion": 1,
        "sourceManifest": str(args.manifest.resolve()),
        "sourceRoot": str(args.source_root.resolve()),
        "sam2Url": args.sam2_url,
        "sam2ElapsedSeconds": round(total_sam2_seconds, 4),
        "cases": records,
    }
    _atomic_json(work / "prepared.json", prepared)
    print(f"prepared {len(records)} cases -> {work}")
    return 0


def _import_remote(args: argparse.Namespace) -> int:
    prepared = _read_json(args.work / "prepared.json")
    output_root = args.work / "candidates" / args.method
    records: list[dict[str, Any]] = []
    for index, case in enumerate(prepared["cases"], start=1):
        case_dir = args.work / case["inputDir"]
        with Image.open(case_dir / "clean.png") as image:
            clean = np.asarray(image.convert("RGB"), dtype=np.uint8)
        with Image.open(case_dir / "painted.png") as image:
            painted = np.asarray(image.convert("RGB"), dtype=np.uint8)
        source_path = args.remote_root / args.method / f"{case['caseId']}.png"
        if not source_path.is_file():
            raise CandidateError(f"missing remote matte: {source_path}")
        with Image.open(source_path) as image:
            alpha = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
        if alpha.shape != painted.shape[:2]:
            alpha = cv2.resize(
                alpha,
                (painted.shape[1], painted.shape[0]),
                interpolation=cv2.INTER_LANCZOS4,
            )
        geometry = case["geometry"]
        try:
            record = _write_sprite(
                output_root / case["candidatePath"],
                painted=painted,
                clean=clean,
                alpha=alpha,
                cx=float(geometry["cx"]),
                cy=float(geometry["cy"]),
                radius=float(geometry["radius"]),
            )
        except CandidateError as exc:
            record = {"path": str(output_root / case["candidatePath"]), "error": str(exc)}
        record["caseId"] = case["caseId"]
        record["sourceMatte"] = str(source_path)
        records.append(record)
        suffix = f": {record['error']}" if "error" in record else ""
        print(f"[{index}/{len(prepared['cases'])}] {case['caseId']}{suffix}")
    _atomic_json(output_root / "import.json", {"method": args.method, "cases": records})
    print(f"imported {len(records)} {args.method} mattes -> {output_root}")
    return 0


def _measure(args: argparse.Namespace) -> int:
    manifest = _read_json(args.manifest)
    report: dict[str, Any] = {"schemaVersion": 1, "methods": {}}
    for method in args.method:
        root = args.work / "candidates" / method
        rows: list[dict[str, Any]] = []
        for case in manifest["cases"]:
            path = root / case["candidatePath"]
            if not path.is_file():
                rows.append({"caseId": case["caseId"], "error": "missing candidate PNG"})
                continue
            with Image.open(path) as image:
                alpha = np.asarray(image.convert("RGBA").getchannel("A"), dtype=np.uint8)
            binary = (alpha >= 32).astype(np.uint8)
            components, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
            visible = int(np.count_nonzero(alpha))
            transition = int(np.count_nonzero((alpha > 0) & (alpha < 255)))
            satellite_pixels = 0
            if components > 2:
                areas = sorted(
                    (int(stats[label, cv2.CC_STAT_AREA]) for label in range(1, components)),
                    reverse=True,
                )
                satellite_pixels = sum(areas[1:])
            rows.append(
                {
                    "caseId": case["caseId"],
                    "visiblePixels": visible,
                    "partialAlphaFraction": round(transition / max(1, visible), 6),
                    "components": max(0, components - 1),
                    "satellitePixels": satellite_pixels,
                }
            )
        report["methods"][method] = {
            "cases": rows,
            "summary": {
                "cases": len(rows),
                "errors": sum("error" in row for row in rows),
                "multiComponentCases": sum(
                    row.get("components", 0) > 1 for row in rows
                ),
                "satellitePixels": sum(row.get("satellitePixels", 0) for row in rows),
                "meanPartialAlphaFraction": round(
                    sum(row.get("partialAlphaFraction", 0.0) for row in rows)
                    / max(1, sum("error" not in row for row in rows)),
                    6,
                ),
            },
        }
    _atomic_json(args.out, report)
    print(json.dumps({name: value["summary"] for name, value in report["methods"].items()}, indent=2))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="prepare SAM2 seed masks and baseline")
    prepare.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    prepare.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    prepare.add_argument("--sam2-url", default="http://localhost:8977")
    prepare.add_argument("--work", type=Path, required=True)
    prepare.set_defaults(func=_prepare)

    import_remote = subparsers.add_parser("import", help="turn remote alpha mattes into sprites")
    import_remote.add_argument("--work", type=Path, required=True)
    import_remote.add_argument("--remote-root", type=Path, required=True)
    import_remote.add_argument("--method", required=True)
    import_remote.set_defaults(func=_import_remote)

    measure = subparsers.add_parser("measure", help="record deterministic alpha diagnostics")
    measure.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    measure.add_argument("--work", type=Path, required=True)
    measure.add_argument("--method", action="append", required=True)
    measure.add_argument("--out", type=Path, required=True)
    measure.set_defaults(func=_measure)
    return parser


def main() -> int:
    args = _parser().parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
