#!/usr/bin/env python3
"""Run GPU matte models over inputs prepared by run_benchmark.py."""

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


def _atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def _load_birefnet(model_name: str):
    from transformers import AutoModelForImageSegmentation

    model = AutoModelForImageSegmentation.from_pretrained(model_name, trust_remote_code=True)
    model.to("cuda").eval().half()
    return model


def _birefnet_alpha(model, image: Image.Image, image_size: int) -> np.ndarray:
    from torchvision import transforms

    transform = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    tensor = transform(image).unsqueeze(0).to("cuda", dtype=torch.float16)
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
        prediction = model(tensor)[-1].sigmoid()[0, 0].float().cpu().numpy()
    alpha = Image.fromarray(np.uint8(np.clip(prediction, 0, 1) * 255), mode="L")
    return np.asarray(alpha.resize(image.size, Image.Resampling.LANCZOS), dtype=np.uint8)


def _load_vitmatte(model_name: str):
    from transformers import VitMatteForImageMatting, VitMatteImageProcessor

    processor = VitMatteImageProcessor.from_pretrained(model_name)
    model = VitMatteForImageMatting.from_pretrained(model_name).to("cuda").eval()
    return processor, model


def _vitmatte_alpha(bundle, image: Image.Image, trimap: Image.Image) -> np.ndarray:
    processor, model = bundle
    inputs = processor(images=image, trimaps=trimap, return_tensors="pt")
    inputs = {key: value.to("cuda") for key, value in inputs.items()}
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
        alpha = model(**inputs).alphas[0, 0].float().cpu().numpy()
    alpha_image = Image.fromarray(np.uint8(np.clip(alpha, 0, 1) * 255), mode="L")
    if alpha_image.size != image.size:
        alpha_image = alpha_image.resize(image.size, Image.Resampling.LANCZOS)
    return np.asarray(alpha_image, dtype=np.uint8)


def _trimap_from_mask(mask: np.ndarray, radius: float) -> Image.Image:
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
    return Image.fromarray(trimap, mode="L")


def _load_hqsam2_vitmatte(repo: Path, checkpoint: Path, model_name: str):
    sys.path.insert(0, str(repo.resolve()))
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    predictor = SAM2ImagePredictor(
        build_sam2("configs/sam2.1/sam2.1_hq_hiera_l.yaml", str(checkpoint))
    )
    return predictor, _load_vitmatte(model_name)


def _hqsam2_vitmatte_alpha(
    bundle,
    image: Image.Image,
    *,
    cx: float,
    cy: float,
    radius: float,
) -> np.ndarray:
    predictor, vitmatte = bundle
    width, height = image.size
    box_radius = radius * 1.2
    box = np.array(
        [
            max(0.0, cx - box_radius),
            max(0.0, cy - box_radius),
            min(float(width - 1), cx + box_radius),
            min(float(height - 1), cy + box_radius),
        ],
        dtype=np.float32,
    )
    predictor.set_image(np.asarray(image))
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        masks, scores, _ = predictor.predict(
            point_coords=np.array([[cx, cy]], dtype=np.float32),
            point_labels=np.array([1], dtype=np.int32),
            box=box,
            multimask_output=True,
            hq_token_only=False,
        )
    mask = np.asarray(masks[int(np.argmax(scores))], dtype=np.float32)
    trimap = _trimap_from_mask(mask, radius)
    return _vitmatte_alpha(vitmatte, image, trimap)


def _load_sam2matting(repo: Path, checkpoint: Path, variant: str):
    sys.path.insert(0, str(repo.resolve()))
    from sam2.build_sam import build_sam2matting
    from sam2.sam2matting_image_predictor import SAM2MattingImagePredictor

    configs = {
        "tiny": "configs/sam2matting-sam2.1tiny.yaml",
        "base+": "configs/sam2matting-sam2.1base+.yaml",
    }
    return SAM2MattingImagePredictor(build_sam2matting(configs[variant], str(checkpoint)))


def _sam2matting_alpha(predictor, image: Image.Image, mask: Image.Image) -> np.ndarray:
    mask_np = np.asarray(mask.convert("L"), dtype=np.uint8)
    raw_mask = torch.from_numpy(mask_np.copy()) > 0
    mask_input = (torch.from_numpy(mask_np.copy()) > 0).float() * 20 - 10
    mask_input = torch.nn.functional.interpolate(
        mask_input.unsqueeze(0).unsqueeze(0),
        size=(256, 256),
        mode="bilinear",
        align_corners=False,
    )
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        encoded = predictor.set_image(image)
        _, alpha, _ = predictor.predict(
            img=encoded,
            raw_mask=raw_mask,
            mask_input=mask_input,
            multimask_output=False,
        )
    return np.uint8(np.clip(np.squeeze(alpha), 0, 1) * 255)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument(
        "--method",
        choices=("birefnet", "vitmatte", "sam2matting", "hqsam2-vitmatte"),
        required=True,
    )
    parser.add_argument("--model")
    parser.add_argument("--image-size", type=int, default=2048)
    parser.add_argument("--sam2matting-repo", type=Path)
    parser.add_argument("--hqsam2-repo", type=Path)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--variant", choices=("tiny", "base+"), default="tiny")
    args = parser.parse_args()

    prepared = json.loads(args.prepared.read_text())
    if args.method == "birefnet":
        model_name = args.model or "ZhengPeng7/BiRefNet_HR-matting"
        bundle = _load_birefnet(model_name)
    elif args.method == "vitmatte":
        model_name = args.model or "hustvl/vitmatte-small-distinctions-646"
        bundle = _load_vitmatte(model_name)
    elif args.method == "sam2matting":
        if not args.sam2matting_repo or not args.checkpoint:
            parser.error("sam2matting requires --sam2matting-repo and --checkpoint")
        model_name = f"SAM2Matting-SAM2.1-{args.variant}"
        bundle = _load_sam2matting(args.sam2matting_repo, args.checkpoint, args.variant)
    else:
        if not args.hqsam2_repo or not args.checkpoint:
            parser.error("hqsam2-vitmatte requires --hqsam2-repo and --checkpoint")
        model_name = args.model or "hustvl/vitmatte-small-distinctions-646"
        bundle = _load_hqsam2_vitmatte(args.hqsam2_repo, args.checkpoint, model_name)

    method_root = args.output_root / args.method
    method_root.mkdir(parents=True, exist_ok=True)
    torch.cuda.reset_peak_memory_stats()
    total_started = time.perf_counter()
    rows: list[dict[str, Any]] = []
    for index, case in enumerate(prepared["cases"], start=1):
        case_dir = args.input_root / case["caseId"]
        image = Image.open(case_dir / "painted.png").convert("RGB")
        started = time.perf_counter()
        if args.method == "birefnet":
            alpha = _birefnet_alpha(bundle, image, args.image_size)
        elif args.method == "vitmatte":
            alpha = _vitmatte_alpha(bundle, image, Image.open(case_dir / "trimap.png").convert("L"))
        elif args.method == "sam2matting":
            alpha = _sam2matting_alpha(
                bundle, image, Image.open(case_dir / "sam2-mask.png").convert("L")
            )
        else:
            geometry = case["geometry"]
            alpha = _hqsam2_vitmatte_alpha(
                bundle,
                image,
                cx=float(geometry["cx"]),
                cy=float(geometry["cy"]),
                radius=float(geometry["radius"]),
            )
        elapsed = time.perf_counter() - started
        output = method_root / f"{case['caseId']}.png"
        Image.fromarray(alpha, mode="L").save(output, optimize=True)
        rows.append({"caseId": case["caseId"], "elapsedSeconds": round(elapsed, 4)})
        print(f"[{index}/{len(prepared['cases'])}] {case['caseId']}: {elapsed:.3f}s", flush=True)

    report = {
        "method": args.method,
        "model": model_name,
        "cases": rows,
        "elapsedSeconds": round(time.perf_counter() - total_started, 4),
        "peakCudaMemoryBytes": int(torch.cuda.max_memory_allocated()),
        "torch": torch.__version__,
    }
    _atomic_json(method_root / "run.json", report)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
