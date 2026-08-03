#!/usr/bin/env python3
"""Prepare and run the ticket #26 SAM 3 image-cutout benchmark.

Authoring sessions are read-only. ``prepare`` copies the fixed benchmark inputs
into an explicit work directory after resolving dog and hitbox records by their
stable id. ``infer`` runs one official checkpoint and writes candidates only
under the requested output root.
"""

from __future__ import annotations

import argparse
import inspect
import json
import math
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEFAULT_MANIFEST = (
    HERE.parent / "2026-08-03-cutout-benchmark" / "benchmark-manifest.json"
)
DEFAULT_SOURCE_ROOT = Path(
    "/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels"
)
PROMPTS = ("the bird", "the bird and what it holds")


class BenchmarkError(RuntimeError):
    """A source, prepared input, or model result violates the benchmark contract."""


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise BenchmarkError(f"cannot read JSON {path}: {exc}") from exc


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def _one_by_id(rows: list[dict[str, Any]], stable_id: str, *, label: str) -> dict[str, Any]:
    matches = [row for row in rows if row.get("id") == stable_id]
    if len(matches) != 1:
        raise BenchmarkError(
            f"{label}: expected one record with id={stable_id!r}, found {len(matches)}"
        )
    return matches[0]


def _local_geometry(case: dict[str, Any]) -> dict[str, float]:
    x0, y0, _, _ = map(float, case["sourceBox"])
    hitbox = case["hitbox"]
    return {
        "cx": float(hitbox["x"]) - x0,
        "cy": float(hitbox["y"]) - y0,
        "radius": float(hitbox["r"]),
    }


def _resolve_case(
    case: dict[str, Any], source_root: Path
) -> tuple[Image.Image, Image.Image, dict[str, float]]:
    level_dir = source_root / case["levelId"]
    session = _read_json(level_dir / "session.json")
    hitboxes = _read_json(level_dir / "hitboxes.json")
    stable_id = str(case["birdId"])
    dog = _one_by_id(session.get("dogs", []), stable_id, label=case["caseId"] + " dog")
    hitbox = _one_by_id(hitboxes, stable_id, label=case["caseId"] + " hitbox")

    expected_index = int(str(case["dogDir"]).removeprefix("dog_"))
    if int(dog["index"]) != expected_index:
        raise BenchmarkError(f"{case['caseId']}: dog index drift")
    if int(dog["activeVariant"]) != int(case["activeVariant"]):
        raise BenchmarkError(f"{case['caseId']}: active variant drift")
    actual_hitbox = {key: int(hitbox[key]) for key in ("x", "y", "r")}
    expected_hitbox = {key: int(case["hitbox"][key]) for key in ("x", "y", "r")}
    if actual_hitbox != expected_hitbox:
        raise BenchmarkError(f"{case['caseId']}: hitbox drift")

    variant_box_payload = _read_json(source_root / case["variantBox"])
    variant_box = (
        variant_box_payload.get("box")
        if isinstance(variant_box_payload, dict)
        else variant_box_payload
    )
    if not isinstance(variant_box, list) or list(map(int, variant_box)) != list(
        map(int, case["sourceBox"])
    ):
        raise BenchmarkError(f"{case['caseId']}: variant box drift")
    x0, y0, x1, y1 = map(int, case["sourceBox"])
    with Image.open(level_dir / "bg_00.png") as source:
        clean = source.convert("RGB").crop((x0, y0, x1, y1))
    with Image.open(source_root / case["paintedCrop"]) as source:
        painted = source.convert("RGB").copy()
    if clean.size != painted.size:
        raise BenchmarkError(f"{case['caseId']}: clean/painted size mismatch")
    return clean, painted, _local_geometry(case)


def prepare_inputs(manifest_path: Path, source_root: Path, work: Path) -> dict[str, Any]:
    manifest = _read_json(manifest_path)
    input_root = work.resolve() / "inputs"
    rows: list[dict[str, Any]] = []
    for index, case in enumerate(manifest["cases"], start=1):
        clean, painted, geometry = _resolve_case(case, source_root)
        case_dir = input_root / case["caseId"]
        case_dir.mkdir(parents=True, exist_ok=True)
        clean.save(case_dir / "clean.png", optimize=True)
        painted.save(case_dir / "painted.png", optimize=True)
        record = {
            "caseId": case["caseId"],
            "levelId": case["levelId"],
            "dogDir": case["dogDir"],
            "birdId": case["birdId"],
            "candidatePath": case["candidatePath"],
            "tags": case["tags"],
            "note": case["note"],
            "geometry": geometry,
            "sourceSize": list(painted.size),
        }
        _atomic_json(case_dir / "case.json", record)
        rows.append(record)
        print(f"[{index}/{len(manifest['cases'])}] prepared {case['caseId']}", flush=True)
    prepared = {
        "schemaVersion": 1,
        "manifest": str(manifest_path.resolve()),
        "sourceRoot": str(source_root.resolve()),
        "inputRoot": str(input_root),
        "cases": rows,
    }
    _atomic_json(work.resolve() / "prepared.json", prepared)
    return prepared


def _as_mask_array(value: Any) -> np.ndarray:
    array = value.detach().float().cpu().numpy()
    while array.ndim > 3 and array.shape[1] == 1:
        array = array[:, 0]
    if array.ndim != 3:
        raise BenchmarkError(f"unexpected SAM mask shape: {array.shape}")
    return array.astype(np.float32)


def choose_mask(
    predictions: list[dict[str, Any]],
    *,
    clean: np.ndarray,
    painted: np.ndarray,
    geometry: dict[str, float],
) -> tuple[np.ndarray | None, dict[str, Any]]:
    height, width = painted.shape[:2]
    cx = float(geometry["cx"])
    cy = float(geometry["cy"])
    radius = float(geometry["radius"])
    yy, xx = np.ogrid[:height, :width]
    core = ((xx - cx) ** 2 + (yy - cy) ** 2) <= max(3.0, radius * 0.72) ** 2
    roi = ((xx - cx) ** 2 + (yy - cy) ** 2) <= max(5.0, radius * 1.8) ** 2
    changed = np.max(
        np.abs(painted.astype(np.int16) - clean.astype(np.int16)), axis=2
    ) >= 14
    target = changed & roi
    target_count = max(1, int(np.count_nonzero(target)))
    core_count = max(1, int(np.count_nonzero(core)))

    best_alpha: np.ndarray | None = None
    best_row: dict[str, Any] | None = None
    candidates: list[dict[str, Any]] = []
    for prediction in predictions:
        prompt = str(prediction["prompt"])
        masks = np.asarray(prediction["masks"], dtype=np.float32)
        scores = np.asarray(prediction["scores"], dtype=np.float32)
        for mask_index, probability in enumerate(masks):
            binary = probability >= 0.5
            selected_count = max(1, int(np.count_nonzero(binary)))
            core_overlap = float(np.count_nonzero(binary & core)) / core_count
            target_coverage = float(np.count_nonzero(binary & target)) / target_count
            low_change_fraction = float(np.count_nonzero(binary & ~changed)) / selected_count
            ys, xs = np.nonzero(binary)
            if len(xs):
                mask_cx = (float(xs.min()) + float(xs.max())) / 2.0
                mask_cy = (float(ys.min()) + float(ys.max())) / 2.0
                normalized_distance = math.hypot(mask_cx - cx, mask_cy - cy) / max(
                    1.0, radius
                )
            else:
                normalized_distance = 100.0
            model_score = float(scores[mask_index]) if mask_index < len(scores) else 0.0
            selection_score = (
                4.0 * core_overlap
                + 2.0 * target_coverage
                + model_score
                - 1.2 * low_change_fraction
                - 0.15 * normalized_distance
            )
            row = {
                "prompt": prompt,
                "maskIndex": mask_index,
                "modelScore": round(model_score, 6),
                "coreOverlap": round(core_overlap, 6),
                "targetCoverage": round(target_coverage, 6),
                "lowChangeFraction": round(low_change_fraction, 6),
                "normalizedCenterDistance": round(normalized_distance, 6),
                "selectionScore": round(selection_score, 6),
                "selectedPixels": int(np.count_nonzero(binary)),
            }
            candidates.append(row)
            if best_row is None or selection_score > float(best_row["selectionScore"]):
                best_row = row
                best_alpha = probability
    diagnostics = {"candidates": candidates, "chosen": best_row}
    return best_alpha, diagnostics


def _soft_alpha(probability: np.ndarray) -> np.ndarray:
    """Keep the official soft mask edge while forcing confident background to zero."""
    return np.clip((probability.astype(np.float32) - 0.35) / 0.30, 0.0, 1.0)


def decontaminated_rgba(
    painted: np.ndarray, clean: np.ndarray, alpha: np.ndarray
) -> np.ndarray:
    a = np.clip(alpha.astype(np.float32), 0.0, 1.0)[..., None]
    painted_f = painted.astype(np.float32) / 255.0
    clean_f = clean.astype(np.float32) / 255.0
    foreground = (painted_f - (1.0 - a) * clean_f) / np.maximum(a, 0.035)
    foreground = np.where(a >= 0.035, foreground, painted_f)
    rgba = np.zeros((*alpha.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.rint(np.clip(foreground, 0.0, 1.0) * 255.0).astype(np.uint8)
    rgba[..., 3] = np.rint(a[..., 0] * 255.0).astype(np.uint8)
    rgba[rgba[..., 3] == 0, :3] = 0
    return rgba


def write_candidate(
    path: Path, *, painted: np.ndarray, clean: np.ndarray, probability: np.ndarray | None
) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    if probability is None:
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(path)
        return {"path": str(path), "empty": True, "size": [1, 1]}
    alpha = _soft_alpha(probability)
    rgba = decontaminated_rgba(painted, clean, alpha)
    ys, xs = np.nonzero(rgba[..., 3] >= 2)
    if not len(xs):
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(path)
        return {"path": str(path), "empty": True, "size": [1, 1]}
    x0 = max(0, int(xs.min()) - 3)
    y0 = max(0, int(ys.min()) - 3)
    x1 = min(rgba.shape[1], int(xs.max()) + 4)
    y1 = min(rgba.shape[0], int(ys.max()) + 4)
    Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA").save(path, optimize=True)
    return {
        "path": str(path),
        "empty": False,
        "cropBox": [x0, y0, x1, y1],
        "size": [x1 - x0, y1 - y0],
        "alphaNonzero": int(np.count_nonzero(rgba[..., 3])),
    }


def _git_revision(repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _predict_sam3_image(processor: Any, image: Image.Image) -> list[dict[str, Any]]:
    import torch

    predictions: list[dict[str, Any]] = []
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        state = processor.set_image(image)
        for prompt in PROMPTS:
            output = processor.set_text_prompt(prompt=prompt, state=state)
            predictions.append(
                {
                    "prompt": prompt,
                    "masks": _as_mask_array(output["masks_logits"]),
                    "scores": output["scores"].detach().float().cpu().numpy(),
                }
            )
    return predictions


def _predict_sam3p1_frame(predictor: Any, image_path: Path) -> list[dict[str, Any]]:
    """Use the official 3.1 video API with one PNG as a one-frame resource."""
    predictions: list[dict[str, Any]] = []
    for prompt in PROMPTS:
        session_id: str | None = None
        try:
            init_kwargs = {
                "resource_path": str(image_path.resolve()),
                "offload_video_to_cpu": False,
                "offload_state_to_cpu": False,
                "async_loading_frames": False,
                "video_loader_type": getattr(predictor, "video_loader_type", None),
            }
            init_parameters = inspect.signature(predictor.model.init_state).parameters
            inference_state = predictor.model.init_state(
                **{
                    key: value
                    for key, value in init_kwargs.items()
                    if key in init_parameters and value is not None
                }
            )
            session_id = str(uuid.uuid4())
            now = time.time()
            predictor._all_inference_states[session_id] = {
                "state": inference_state,
                "session_id": session_id,
                "start_time": now,
                "last_use_time": now,
            }
            response = predictor.handle_request(
                {
                    "type": "add_prompt",
                    "session_id": session_id,
                    "frame_index": 0,
                    "text": prompt,
                    "output_prob_thresh": 0.05,
                }
            )
            output = response["outputs"]
            masks = np.asarray(output["out_binary_masks"], dtype=np.float32)
            scores = np.asarray(
                output.get("out_probs", np.ones(len(masks), dtype=np.float32)),
                dtype=np.float32,
            )
            predictions.append({"prompt": prompt, "masks": masks, "scores": scores})
        finally:
            if session_id is not None:
                predictor.handle_request(
                    {
                        "type": "close_session",
                        "session_id": session_id,
                        "run_gc_collect": False,
                    }
                )
    return predictions


def run_inference(
    prepared_path: Path,
    input_root: Path,
    output_root: Path,
    checkpoint_version: str,
    *,
    case_ids: set[str] | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    import torch
    from huggingface_hub import model_info
    import sam3
    from sam3.model_builder import (
        build_sam3_image_model,
        build_sam3_predictor,
        download_ckpt_from_hf,
    )

    prepared = _read_json(prepared_path)
    checkpoint_path = Path(download_ckpt_from_hf(version=checkpoint_version))
    repo_id = "facebook/sam3.1" if checkpoint_version == "sam3.1" else "facebook/sam3"
    torch.cuda.reset_peak_memory_stats()
    model_started = time.perf_counter()
    if checkpoint_version == "sam3":
        from sam3.model.sam3_image_processor import Sam3Processor

        model = build_sam3_image_model(
            checkpoint_path=str(checkpoint_path), load_from_HF=False, device="cuda"
        )
        predictor = Sam3Processor(model, confidence_threshold=0.05)
        public_api = "build_sam3_image_model + Sam3Processor"
        alpha_source = "masks_logits"
    else:
        predictor = build_sam3_predictor(
            checkpoint_path=None,
            version="sam3.1",
            use_fa3=False,
            compile=False,
            warm_up=False,
            async_loading_frames=False,
        )
        public_api = "build_sam3_predictor(version='sam3.1') on one-frame PNG"
        alpha_source = "out_binary_masks"
    model_load_seconds = time.perf_counter() - model_started

    method_name = "sam3p1-zero-shot" if checkpoint_version == "sam3.1" else "sam3-zero-shot"
    method_root = output_root.resolve() / method_name
    selected_cases = [
        case
        for case in prepared["cases"]
        if case_ids is None or case["caseId"] in case_ids
    ]
    if case_ids is not None:
        missing = case_ids - {case["caseId"] for case in selected_cases}
        if missing:
            raise BenchmarkError(f"unknown case ids: {sorted(missing)}")
    if limit is not None:
        selected_cases = selected_cases[:limit]
    rows: list[dict[str, Any]] = []
    total_started = time.perf_counter()
    for index, case in enumerate(selected_cases, start=1):
        case_dir = input_root / case["caseId"]
        with Image.open(case_dir / "painted.png") as image_file:
            image = image_file.convert("RGB")
        painted = np.asarray(image, dtype=np.uint8)
        with Image.open(case_dir / "clean.png") as clean_file:
            clean = np.asarray(clean_file.convert("RGB"), dtype=np.uint8)

        started = time.perf_counter()
        if checkpoint_version == "sam3":
            predictions = _predict_sam3_image(predictor, image)
        else:
            predictions = _predict_sam3p1_frame(predictor, case_dir / "painted.png")
        probability, diagnostics = choose_mask(
            predictions, clean=clean, painted=painted, geometry=case["geometry"]
        )
        candidate_path = method_root / case["candidatePath"]
        artifact = write_candidate(
            candidate_path, painted=painted, clean=clean, probability=probability
        )
        elapsed = time.perf_counter() - started
        row = {
            "caseId": case["caseId"],
            "elapsedSeconds": round(elapsed, 4),
            "promptMaskCounts": {
                item["prompt"]: int(len(item["masks"])) for item in predictions
            },
            "selection": diagnostics,
            "artifact": artifact,
        }
        rows.append(row)
        chosen = diagnostics["chosen"]
        chosen_text = "no-mask" if chosen is None else f"{chosen['prompt']} score={chosen['selectionScore']}"
        print(
            f"[{index}/{len(selected_cases)}] {case['caseId']}: "
            f"{elapsed:.3f}s {chosen_text}",
            flush=True,
        )

    report = {
        "schemaVersion": 1,
        "method": method_name,
        "checkpointVersion": checkpoint_version,
        "checkpointRepo": repo_id,
        "checkpointRevision": model_info(repo_id).sha,
        "checkpointFile": checkpoint_path.name,
        "sam3CodeRevision": _git_revision(Path(sam3.__file__).resolve().parent.parent),
        "publicApi": public_api,
        "alphaSource": alpha_source,
        "prompts": list(PROMPTS),
        "processorResolution": 1008,
        "confidenceThreshold": 0.05,
        "modelLoadSeconds": round(model_load_seconds, 4),
        "inferenceSeconds": round(time.perf_counter() - total_started, 4),
        "peakCudaMemoryBytes": int(torch.cuda.max_memory_allocated()),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "selectedCases": [case["caseId"] for case in selected_cases],
        "cases": rows,
    }
    _atomic_json(method_root / "run.json", report)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="validate and copy fixed inputs")
    prepare.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    prepare.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    prepare.add_argument("--work", type=Path, required=True)

    infer = subparsers.add_parser("infer", help="run one official SAM checkpoint")
    infer.add_argument("--prepared", type=Path, required=True)
    infer.add_argument("--input-root", type=Path, required=True)
    infer.add_argument("--output-root", type=Path, required=True)
    infer.add_argument("--checkpoint-version", choices=("sam3", "sam3.1"), required=True)
    infer.add_argument("--case", action="append", dest="case_ids")
    infer.add_argument("--limit", type=int)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "prepare":
        prepared = prepare_inputs(args.manifest, args.source_root, args.work)
        print(f"prepared {len(prepared['cases'])} cases -> {args.work.resolve()}")
        return 0
    report = run_inference(
        args.prepared,
        args.input_root,
        args.output_root,
        args.checkpoint_version,
        case_ids=set(args.case_ids) if args.case_ids else None,
        limit=args.limit,
    )
    print(json.dumps({key: report[key] for key in ("method", "inferenceSeconds", "peakCudaMemoryBytes")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
