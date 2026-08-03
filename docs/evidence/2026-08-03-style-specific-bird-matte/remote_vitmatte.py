#!/usr/bin/env python3
"""Train and evaluate the ticket-27 ViTMatte pilot on the RTX 4090."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from transformers import VitMatteForImageMatting, VitMatteImageProcessor


BASE_MODEL = "hustvl/vitmatte-small-distinctions-646"
BASE_REVISION = "6a0e75d7214b01f4d1163ede0f15b23afbbd480b"
SEED = 27082026


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


class PairDataset(Dataset):
    def __init__(self, work: Path, split: str, processor: VitMatteImageProcessor):
        dataset = _read_json(work / "synthetic-dataset.json")
        self.rows = [row for row in dataset["rows"] if row["split"] == split]
        self.work = work
        self.processor = processor

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        row = self.rows[index]
        root = self.work / row["path"]
        image = Image.open(root / "image.png").convert("RGB")
        trimap = Image.open(root / "trimap.png").convert("L")
        alpha = torch.from_numpy(
            np.asarray(
                Image.open(root / "alpha.png").convert("L"), dtype=np.float32
            ).copy()
            / 255.0
        ).unsqueeze(0)
        inputs = self.processor(images=image, trimaps=trimap, return_tensors="pt")
        return {
            "pixel_values": inputs["pixel_values"][0],
            "alpha": alpha,
            "trimap": torch.from_numpy(
                np.asarray(trimap, dtype=np.uint8).copy()
            ).unsqueeze(0),
        }


def _gradient(value: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    dx = value[..., :, 1:] - value[..., :, :-1]
    dy = value[..., 1:, :] - value[..., :-1, :]
    return dx, dy


def _loss(
    prediction: torch.Tensor, alpha: torch.Tensor, trimap: torch.Tensor
) -> torch.Tensor:
    unknown = (trimap == 128).float()
    overall = F.l1_loss(prediction, alpha)
    unknown_loss = (
        torch.abs(prediction - alpha) * unknown
    ).sum() / unknown.sum().clamp_min(1.0)
    pred_dx, pred_dy = _gradient(prediction)
    alpha_dx, alpha_dy = _gradient(alpha)
    gradient_loss = F.l1_loss(pred_dx, alpha_dx) + F.l1_loss(pred_dy, alpha_dy)
    return 0.5 * overall + unknown_loss + 0.25 * gradient_loss


@torch.no_grad()
def _validate(model: VitMatteForImageMatting, loader: DataLoader) -> dict[str, float]:
    model.eval()
    total_abs = 0.0
    total_pixels = 0
    total_unknown_abs = 0.0
    total_unknown = 0
    for batch in loader:
        pixel_values = batch["pixel_values"].to("cuda", non_blocking=True)
        alpha = batch["alpha"].to("cuda", non_blocking=True)
        trimap = batch["trimap"].to("cuda", non_blocking=True)
        with torch.autocast("cuda", dtype=torch.bfloat16):
            prediction = model(pixel_values=pixel_values).alphas.float()
        absolute = torch.abs(prediction - alpha)
        unknown = trimap == 128
        total_abs += float(absolute.sum())
        total_pixels += absolute.numel()
        total_unknown_abs += float(absolute[unknown].sum())
        total_unknown += int(unknown.sum())
    return {
        "mad": total_abs / max(1, total_pixels),
        "unknownMad": total_unknown_abs / max(1, total_unknown),
        "sad": total_abs / 1000.0,
    }


def train(args: argparse.Namespace) -> int:
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.cuda.manual_seed_all(SEED)
    torch.backends.cudnn.benchmark = False
    processor = VitMatteImageProcessor.from_pretrained(
        BASE_MODEL, revision=BASE_REVISION
    )
    model = VitMatteForImageMatting.from_pretrained(
        BASE_MODEL, revision=BASE_REVISION
    ).to("cuda")
    for parameter in model.backbone.parameters():
        parameter.requires_grad = False
    train_dataset = PairDataset(args.work, "train", processor)
    validation_dataset = PairDataset(args.work, "validation", processor)
    generator = torch.Generator().manual_seed(SEED)
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        generator=generator,
        num_workers=2,
        pin_memory=True,
    )
    validation_loader = DataLoader(
        validation_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=2,
        pin_memory=True,
    )
    optimizer = torch.optim.AdamW(
        model.decoder.parameters(), lr=args.learning_rate, weight_decay=0.01
    )
    scaler = torch.amp.GradScaler("cuda")
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    torch.cuda.reset_peak_memory_stats()
    best_unknown = float("inf")
    history: list[dict[str, Any]] = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        model.backbone.eval()
        running = 0.0
        for batch in train_loader:
            optimizer.zero_grad(set_to_none=True)
            pixel_values = batch["pixel_values"].to("cuda", non_blocking=True)
            alpha = batch["alpha"].to("cuda", non_blocking=True)
            trimap = batch["trimap"].to("cuda", non_blocking=True)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                prediction = model(pixel_values=pixel_values).alphas
                loss = _loss(prediction, alpha, trimap)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.decoder.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
            running += float(loss.detach())
        metrics = _validate(model, validation_loader)
        row = {
            "epoch": epoch,
            "trainLoss": running / max(1, len(train_loader)),
            **metrics,
        }
        history.append(row)
        print(json.dumps(row), flush=True)
        if metrics["unknownMad"] < best_unknown:
            best_unknown = metrics["unknownMad"]
            model.save_pretrained(args.output / "best")
            processor.save_pretrained(args.output / "best")
            _atomic_json(args.output / "best" / "selection.json", row)
    report = {
        "schemaVersion": 1,
        "baseModel": BASE_MODEL,
        "baseRevision": BASE_REVISION,
        "codeLicense": "MIT",
        "checkpointLicense": "Apache-2.0",
        "seed": SEED,
        "trainPairs": len(train_dataset),
        "validationPairs": len(validation_dataset),
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "learningRate": args.learning_rate,
        "trainedParameters": sum(
            parameter.numel()
            for parameter in model.parameters()
            if parameter.requires_grad
        ),
        "totalParameters": sum(parameter.numel() for parameter in model.parameters()),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "peakCudaMemoryBytes": int(torch.cuda.max_memory_allocated()),
        "torch": torch.__version__,
        "history": history,
        "best": min(history, key=lambda row: row["unknownMad"]),
    }
    _atomic_json(args.output / "training-report.json", report)
    return 0


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def infer(args: argparse.Namespace) -> int:
    prepared = _read_json(args.work / "holdout-prepared.json")
    processor = VitMatteImageProcessor.from_pretrained(args.checkpoint)
    model = VitMatteForImageMatting.from_pretrained(args.checkpoint).to("cuda").eval()
    output_root = args.output / args.method
    output_root.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    torch.cuda.reset_peak_memory_stats()
    started = time.perf_counter()
    for index, case in enumerate(prepared["cases"], start=1):
        case_dir = args.work / case["inputDir"]
        image = Image.open(case_dir / "painted.png").convert("RGB")
        trimap = Image.open(case_dir / "registered-trimap.png").convert("L")
        inputs = processor(images=image, trimaps=trimap, return_tensors="pt")
        inputs = {key: value.to("cuda") for key, value in inputs.items()}
        case_started = time.perf_counter()
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            alpha = model(**inputs).alphas[0, 0].float().cpu().numpy()
        elapsed = time.perf_counter() - case_started
        alpha_image = Image.fromarray(
            np.uint8(np.clip(alpha, 0.0, 1.0) * 255), mode="L"
        )
        if alpha_image.size != image.size:
            alpha_image = alpha_image.resize(image.size, Image.Resampling.LANCZOS)
        alpha_image.save(output_root / f"{case['caseId']}.png", optimize=True)
        rows.append({"caseId": case["caseId"], "elapsedSeconds": round(elapsed, 4)})
        print(
            f"[{index}/{len(prepared['cases'])}] {case['caseId']}: {elapsed:.3f}s",
            flush=True,
        )
    weights = args.checkpoint / "model.safetensors"
    report = {
        "method": args.method,
        "checkpoint": str(args.checkpoint),
        "checkpointSha256": _sha256(weights),
        "cases": rows,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "peakCudaMemoryBytes": int(torch.cuda.max_memory_allocated()),
        "torch": torch.__version__,
    }
    _atomic_json(output_root / "run.json", report)
    print(json.dumps(report, indent=2))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    train_parser = subparsers.add_parser("train")
    train_parser.add_argument("--work", type=Path, required=True)
    train_parser.add_argument("--output", type=Path, required=True)
    train_parser.add_argument("--epochs", type=int, default=20)
    train_parser.add_argument("--batch-size", type=int, default=2)
    train_parser.add_argument("--learning-rate", type=float, default=2e-5)
    train_parser.set_defaults(func=train)
    infer_parser = subparsers.add_parser("infer")
    infer_parser.add_argument("--work", type=Path, required=True)
    infer_parser.add_argument("--checkpoint", type=Path, required=True)
    infer_parser.add_argument("--output", type=Path, required=True)
    infer_parser.add_argument("--method", default="finetuned-vitmatte")
    infer_parser.set_defaults(func=infer)
    return parser


def main() -> int:
    args = _parser().parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
