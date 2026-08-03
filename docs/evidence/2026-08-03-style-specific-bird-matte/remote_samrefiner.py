#!/usr/bin/env python3
"""Run registered-difference -> SAMRefiner(HQ-SAM) -> stock ViTMatte."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from PIL import Image
from scipy.ndimage import distance_transform_edt
from transformers import VitMatteForImageMatting, VitMatteImageProcessor


VITMATTE_MODEL = "hustvl/vitmatte-small-distinctions-646"
VITMATTE_REVISION = "6a0e75d7214b01f4d1163ede0f15b23afbbd480b"


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def _trimap(mask: np.ndarray, radius: float) -> Image.Image:
    binary = (mask > 0).astype(np.uint8)
    erode_px = max(1, round(radius * 0.045))
    dilate_px = max(3, round(radius * 0.16))
    foreground = cv2.erode(
        binary,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_px * 2 + 1,) * 2),
    )
    possible = cv2.dilate(
        binary,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_px * 2 + 1,) * 2),
    )
    trimap = np.full(binary.shape, 128, dtype=np.uint8)
    trimap[possible == 0] = 0
    trimap[foreground == 1] = 255
    return Image.fromarray(trimap, mode="L")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samrefiner-repo", type=Path, required=True)
    parser.add_argument("--samhq-repo", type=Path, required=True)
    parser.add_argument("--hq-checkpoint", type=Path, required=True)
    args = parser.parse_args()

    sys.path.insert(0, str(args.samrefiner_repo.resolve()))
    sys.path.insert(0, str(args.samhq_repo.resolve()))
    import FastGeodis

    def exact_cpu_edt(image, seed, value, lamb, iterations):
        del image, value, iterations
        if float(lamb) != 0.0:
            raise RuntimeError(
                "CPU FastGeodis fallback is exact only for SAMRefiner lambda=0"
            )
        planes = [
            distance_transform_edt(plane != 0) for plane in seed.detach().cpu().numpy()
        ]
        return torch.from_numpy(np.stack(planes).astype(np.float32)).to(seed.device)

    # The host has no CUDA toolkit, so FastGeodis cannot build its CUDA extension.
    # SAMRefiner hard-codes lambda=0, where its generalized distance is exactly EDT.
    FastGeodis.generalised_geodesic2d = exact_cpu_edt
    from sam_refiner import sam_refiner
    from segment_anything import sam_model_registry

    sam = (
        sam_model_registry["vit_h"](checkpoint=str(args.hq_checkpoint))
        .to("cuda")
        .eval()
    )
    processor = VitMatteImageProcessor.from_pretrained(
        VITMATTE_MODEL, revision=VITMATTE_REVISION
    )
    vitmatte = (
        VitMatteForImageMatting.from_pretrained(
            VITMATTE_MODEL, revision=VITMATTE_REVISION
        )
        .to("cuda")
        .eval()
    )
    prepared = _read_json(args.work / "holdout-prepared.json")
    method_root = args.output / "samrefiner-hqsam-vitmatte"
    method_root.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    torch.cuda.reset_peak_memory_stats()
    total_started = time.perf_counter()
    for index, case in enumerate(prepared["cases"], start=1):
        case_dir = args.work / case["inputDir"]
        image_path = case_dir / "painted.png"
        image = Image.open(image_path).convert("RGB")
        initial = np.asarray(
            Image.open(case_dir / "registered-mask.png").convert("L"), dtype=np.uint8
        )
        started = time.perf_counter()
        with torch.inference_mode():
            refined = sam_refiner(
                str(image_path), [initial / 255.0], sam, use_samhq=True
            )[0][0]
        trimap = _trimap(
            np.asarray(refined, dtype=np.uint8), float(case["geometry"]["radius"])
        )
        inputs = processor(images=image, trimaps=trimap, return_tensors="pt")
        inputs = {key: value.to("cuda") for key, value in inputs.items()}
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            alpha = vitmatte(**inputs).alphas[0, 0].float().cpu().numpy()
        elapsed = time.perf_counter() - started
        alpha_image = Image.fromarray(
            np.uint8(np.clip(alpha, 0.0, 1.0) * 255), mode="L"
        )
        if alpha_image.size != image.size:
            alpha_image = alpha_image.resize(image.size, Image.Resampling.LANCZOS)
        alpha_image.save(method_root / f"{case['caseId']}.png", optimize=True)
        rows.append({"caseId": case["caseId"], "elapsedSeconds": round(elapsed, 4)})
        print(
            f"[{index}/{len(prepared['cases'])}] {case['caseId']}: {elapsed:.3f}s",
            flush=True,
        )
    report = {
        "method": "registered-difference -> SAMRefiner(HQ-SAM) -> ViTMatte",
        "samRefinerCommit": "4bb7f95738c7a2e805f189210fb09e02a2197557",
        "hqSamSource": (
            "SAMRefiner 4bb7f95738c7a2e805f189210fb09e02a2197557 "
            "vendored sam-hq tree a097774e71ab472b52d74dc5001442ad8f6a6355"
        ),
        "vitmatteRevision": VITMATTE_REVISION,
        "distanceTransform": "SciPy EDT CPU; exact SAMRefiner lambda=0 equivalent",
        "cases": rows,
        "elapsedSeconds": round(time.perf_counter() - total_started, 3),
        "peakCudaMemoryBytes": int(torch.cuda.max_memory_allocated()),
        "torch": torch.__version__,
    }
    _atomic_json(method_root / "run.json", report)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
