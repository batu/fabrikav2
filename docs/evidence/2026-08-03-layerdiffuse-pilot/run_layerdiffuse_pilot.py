#!/usr/bin/env python3
"""Reproduce the LayerDiffuse background-conditioned pilot for Wayfinder ticket 25.

The source authoring sessions are read-only. ``prepare`` validates the dog and
hitbox stable-id joins and writes 512px conditioned inputs under ``--out``.
``run`` executes the official ComfyUI-layerdiffuse SD1.5 background-conditioned
graph against a running ComfyUI server. ``sheets`` renders review images after
the remote outputs have been copied back beneath the same output directory.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
DEFAULT_CASES = HERE / "pilot-cases.json"
CREAM = (255, 248, 232, 255)
PANEL_BG = (244, 239, 226, 255)


@dataclass(frozen=True)
class ResolvedCase:
    config: dict[str, Any]
    dog_dir: str
    variant: int
    hitbox: dict[str, Any]
    source_box: tuple[int, int, int, int]
    square_box: tuple[int, int, int, int]
    source_size: tuple[int, int]
    clean_square: Image.Image
    painted_square: Image.Image
    target_variant: Image.Image

    @property
    def case_id(self) -> str:
        return str(self.config["caseId"])


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")
    temporary.replace(path)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _square_box(
    source_box: tuple[int, int, int, int], source_size: tuple[int, int]
) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = source_box
    image_width, image_height = source_size
    side = max(x1 - x0, y1 - y0)
    center_x = (x0 + x1) / 2
    center_y = (y0 + y1) / 2
    square_x0 = round(center_x - side / 2)
    square_y0 = round(center_y - side / 2)
    square_x0 = min(max(0, square_x0), image_width - side)
    square_y0 = min(max(0, square_y0), image_height - side)
    return square_x0, square_y0, square_x0 + side, square_y0 + side


def resolve_case(config: dict[str, Any], source_root: Path) -> ResolvedCase:
    level_dir = source_root / str(config["levelId"])
    session = _read_json(level_dir / "session.json")
    hitboxes = _read_json(level_dir / "hitboxes.json")
    dog_matches = [dog for dog in session["dogs"] if dog.get("id") == config["birdId"]]
    hitbox_matches = [hitbox for hitbox in hitboxes if hitbox.get("id") == config["birdId"]]
    if len(dog_matches) != 1 or len(hitbox_matches) != 1:
        raise RuntimeError(
            f"{config['caseId']}: stable-id join failed "
            f"(dogs={len(dog_matches)}, hitboxes={len(hitbox_matches)})"
        )
    dog = dog_matches[0]
    dog_dir = f"dog_{int(dog['index']):02d}"
    variant = int(dog["activeVariant"])
    if dog_dir != config["expectedDogDir"] or variant != int(config["expectedVariant"]):
        raise RuntimeError(
            f"{config['caseId']}: source drift; resolved {dog_dir}/variant_{variant:03d}"
        )

    variant_base = level_dir / "dogs" / dog_dir / f"variant_{variant:03d}"
    box_values = _read_json(variant_base.with_suffix(".box.json"))["box"]
    source_box = tuple(int(value) for value in box_values)
    if len(source_box) != 4:
        raise RuntimeError(f"{config['caseId']}: malformed source box")

    with Image.open(level_dir / "bg_00.png") as background_source:
        background = background_source.convert("RGB")
        source_size = background.size
        square_box = _square_box(source_box, source_size)
        clean_square = background.crop(square_box).copy()
    with Image.open(variant_base.with_suffix(".png")) as variant_source:
        target_variant = variant_source.convert("RGB").copy()
    expected_variant_size = (source_box[2] - source_box[0], source_box[3] - source_box[1])
    if target_variant.size != expected_variant_size:
        raise RuntimeError(
            f"{config['caseId']}: variant {target_variant.size} != box {expected_variant_size}"
        )
    painted_square = clean_square.copy()
    painted_square.paste(
        target_variant,
        (source_box[0] - square_box[0], source_box[1] - square_box[1]),
    )
    return ResolvedCase(
        config=config,
        dog_dir=dog_dir,
        variant=variant,
        hitbox=hitbox_matches[0],
        source_box=source_box,
        square_box=square_box,
        source_size=source_size,
        clean_square=clean_square,
        painted_square=painted_square,
        target_variant=target_variant,
    )


def prepare(cases_path: Path, out_root: Path) -> None:
    manifest = _read_json(cases_path)
    source_root = Path(manifest["sourceRoot"])
    width = int(manifest["generation"]["width"])
    height = int(manifest["generation"]["height"])
    if (width, height) != (512, 512):
        raise RuntimeError("this official SD1.5 pilot is pinned to 512x512")
    resolved_records: list[dict[str, Any]] = []
    for config in manifest["cases"]:
        resolved = resolve_case(config, source_root)
        case_dir = out_root / "inputs" / resolved.case_id
        case_dir.mkdir(parents=True, exist_ok=True)
        conditioned = resolved.clean_square.resize((width, height), Image.Resampling.LANCZOS)
        reference = resolved.painted_square.resize((width, height), Image.Resampling.LANCZOS)
        conditioned.save(case_dir / "background.png")
        reference.save(case_dir / "painted-reference.png")
        resolved.target_variant.save(case_dir / "target-variant.png")
        source_side = resolved.square_box[2] - resolved.square_box[0]
        resolved_records.append(
            {
                "caseId": resolved.case_id,
                "levelId": config["levelId"],
                "birdId": config["birdId"],
                "dogDir": resolved.dog_dir,
                "activeVariant": resolved.variant,
                "hitbox": resolved.hitbox,
                "sourceSize": list(resolved.source_size),
                "sourceBox": list(resolved.source_box),
                "squareConditioningBox": list(resolved.square_box),
                "squareConditioningSide": source_side,
                "conditionedSize": [width, height],
                "conditioningScale": round(width / source_side, 6),
                "conditioningResample": "Pillow LANCZOS",
                "prompt": config["prompt"],
                "seed": config["seed"],
            }
        )
    _write_json(
        out_root / "resolved-cases.json",
        {
            "schemaVersion": 1,
            "sourceRoot": str(source_root),
            "generation": manifest["generation"],
            "cases": resolved_records,
        },
    )


def _http_json(url: str, payload: dict[str, Any] | None = None) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="GET" if data is None else "POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {details[:1000]}") from exc


def _workflow(case: dict[str, Any], generation: dict[str, Any]) -> dict[str, Any]:
    case_id = str(case["caseId"])
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "dreamshaper_8.safetensors"},
        },
        "2": {
            "class_type": "LoadImage",
            "inputs": {"image": f"{case_id}-background.png"},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": case["prompt"], "clip": ["1", 1]},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": generation["negativePrompt"], "clip": ["1", 1]},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": generation["width"],
                "height": generation["height"],
                "batch_size": 2,
            },
        },
        "6": {
            "class_type": "LayeredDiffusionCondJointApply",
            "inputs": {
                "model": ["1", 0],
                "image": ["2", 0],
                "config": "SD15, Background, attn_sharing, Batch size (2N)",
            },
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["6", 0],
                "seed": case["seed"],
                "steps": generation["steps"],
                "cfg": generation["cfg"],
                "sampler_name": generation["sampler"],
                "scheduler": generation["scheduler"],
                "positive": ["3", 0],
                "negative": ["4", 0],
                "latent_image": ["5", 0],
                "denoise": 1.0,
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["7", 0], "vae": ["1", 2]},
        },
        "9": {
            "class_type": "LayeredDiffusionDecodeSplit",
            "inputs": {
                "samples": ["7", 0],
                "images": ["8", 0],
                "frames": 2,
                "sd_version": "SD15",
                "sub_batch_size": 2,
            },
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": f"{case_id}/foreground"},
        },
        "11": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 1], "filename_prefix": f"{case_id}/model-blend"},
        },
    }


def _gpu_used_mib() -> int:
    completed = subprocess.run(
        [
            "nvidia-smi",
            "--query-compute-apps=used_memory",
            "--format=csv,noheader,nounits",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    values = [int(line.strip()) for line in completed.stdout.splitlines() if line.strip().isdigit()]
    return sum(values)


def _command_output(command: list[str]) -> str:
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return completed.stdout.strip()


def _environment_metadata(setup_root: Path) -> dict[str, Any]:
    comfy_root = setup_root / "ComfyUI"
    extension_root = comfy_root / "custom_nodes" / "ComfyUI-layerdiffuse"
    checkpoint = comfy_root / "models" / "checkpoints" / "dreamshaper_8.safetensors"
    layer_root = comfy_root / "models" / "layer_model"
    layer_files = [
        layer_root / "layer_sd15_bg2fg.safetensors",
        layer_root / "layer_sd15_vae_transparent_decoder.safetensors",
    ]
    files = [checkpoint, *layer_files]
    missing = [str(path) for path in files if not path.exists()]
    if missing:
        raise RuntimeError(f"required model files missing: {missing}")
    return {
        "comfyUICommit": _command_output(["git", "-C", str(comfy_root), "rev-parse", "HEAD"]),
        "layerDiffuseCommit": _command_output(
            ["git", "-C", str(extension_root), "rev-parse", "HEAD"]
        ),
        "python": platform.python_version(),
        "packages": {
            name: importlib.metadata.version(name)
            for name in ("torch", "torchvision", "diffusers", "numpy", "Pillow")
        },
        "nvidiaSmi": _command_output(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,driver_version",
                "--format=csv,noheader",
            ]
        ),
        "models": {
            path.name: {"sha256": _sha256(path), "bytes": path.stat().st_size}
            for path in files
        },
    }


def _monitor_gpu(stop: threading.Event, readings: list[int]) -> None:
    while not stop.wait(0.25):
        readings.append(_gpu_used_mib())


def _wait_for_history(server: str, prompt_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        history = _http_json(f"{server}/history/{prompt_id}")
        if prompt_id in history:
            record = history[prompt_id]
            status = record.get("status") or {}
            if status.get("status_str") == "error" or status.get("completed") is False:
                messages = status.get("messages") or []
                raise RuntimeError(f"ComfyUI prompt {prompt_id} failed: {messages[-1:]}")
            return record
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for prompt {prompt_id}")


def _saved_image_path(output_root: Path, history: dict[str, Any], node_id: str) -> Path:
    images = history.get("outputs", {}).get(node_id, {}).get("images", [])
    if len(images) != 1:
        raise RuntimeError(f"node {node_id} returned {len(images)} images")
    record = images[0]
    return output_root / str(record.get("subfolder") or "") / str(record["filename"])


def _component_count(alpha: np.ndarray, threshold: int = 8) -> int:
    active = alpha >= threshold
    visited = np.zeros(active.shape, dtype=bool)
    count = 0
    height, width = active.shape
    for start_y, start_x in np.argwhere(active):
        if visited[start_y, start_x]:
            continue
        count += 1
        queue = deque([(int(start_y), int(start_x))])
        visited[start_y, start_x] = True
        while queue:
            y, x = queue.popleft()
            for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and active[next_y, next_x]
                    and not visited[next_y, next_x]
                ):
                    visited[next_y, next_x] = True
                    queue.append((next_y, next_x))
    return count


def _normalize_outputs(
    case: dict[str, Any], input_root: Path, output_root: Path, history: dict[str, Any]
) -> dict[str, Any]:
    case_id = str(case["caseId"])
    case_dir = output_root / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    foreground_source = _saved_image_path(output_root, history, "10")
    blend_source = _saved_image_path(output_root, history, "11")
    foreground_path = case_dir / "foreground.png"
    blend_path = case_dir / "model-blend.png"
    background_path = case_dir / "background.png"
    shutil.copy2(foreground_source, foreground_path)
    shutil.copy2(blend_source, blend_path)
    shutil.copy2(input_root / f"{case_id}-background.png", background_path)
    with Image.open(foreground_path) as source:
        foreground = source.convert("RGBA")
    with Image.open(background_path) as source:
        background = source.convert("RGBA")
    if foreground.size != background.size:
        raise RuntimeError(f"{case_id}: foreground {foreground.size} != background {background.size}")
    composite = Image.alpha_composite(background, foreground)
    composite_path = case_dir / "deterministic-composite.png"
    composite.convert("RGB").save(composite_path)
    alpha = np.asarray(foreground.getchannel("A"))
    border_max = int(
        max(alpha[0].max(), alpha[-1].max(), alpha[:, 0].max(), alpha[:, -1].max())
    )
    bbox = foreground.getchannel("A").point(lambda value: 255 if value >= 8 else 0).getbbox()
    return {
        "caseId": case_id,
        "files": {
            path.name: {"sha256": _sha256(path), "bytes": path.stat().st_size}
            for path in (foreground_path, background_path, blend_path, composite_path)
        },
        "alpha": {
            "mode": foreground.mode,
            "bboxAt8": list(bbox) if bbox else None,
            "borderMax": border_max,
            "componentCountAt8": _component_count(alpha),
            "transparentPixels": int(np.count_nonzero(alpha == 0)),
            "opaquePixels": int(np.count_nonzero(alpha == 255)),
        },
    }


def run(
    cases_path: Path,
    server: str,
    input_root: Path,
    output_root: Path,
    setup_root: Path,
) -> None:
    manifest = _read_json(cases_path)
    system_stats = _http_json(f"{server}/system_stats")
    records: list[dict[str, Any]] = []
    for case in manifest["cases"]:
        baseline = _gpu_used_mib()
        readings = [baseline]
        stop = threading.Event()
        monitor = threading.Thread(target=_monitor_gpu, args=(stop, readings), daemon=True)
        monitor.start()
        started = time.monotonic()
        try:
            response = _http_json(f"{server}/prompt", {"prompt": _workflow(case, manifest["generation"])})
            prompt_id = str(response["prompt_id"])
            history = _wait_for_history(server, prompt_id)
        finally:
            elapsed = time.monotonic() - started
            stop.set()
            monitor.join(timeout=2)
        record = _normalize_outputs(case, input_root, output_root, history)
        record.update(
            {
                "promptId": prompt_id,
                "elapsedSeconds": round(elapsed, 3),
                "baselineGpuMiB": baseline,
                "peakGpuMiB": max(readings),
                "incrementalPeakGpuMiB": max(readings) - baseline,
            }
        )
        records.append(record)
    summary = {
        "schemaVersion": 1,
        "createdAtUnix": time.time(),
        "host": platform.node(),
        "workflow": "ComfyUI-layerdiffuse SD1.5 Background attn_sharing, batch 2",
        "generation": manifest["generation"],
        "systemStats": system_stats,
        "environment": _environment_metadata(setup_root),
        "cases": records,
    }
    _write_json(output_root / "run-summary.json", summary)


def _fit(image: Image.Image, box: tuple[int, int, int, int]) -> tuple[Image.Image, tuple[int, int]]:
    x0, y0, x1, y1 = box
    max_width = x1 - x0
    max_height = y1 - y0
    scale = min(max_width / image.width, max_height / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    return resized, (x0 + (max_width - resized.width) // 2, y0 + (max_height - resized.height) // 2)


def _foreground_preview(path: Path) -> Image.Image:
    with Image.open(path) as source:
        foreground = source.convert("RGBA")
    preview = Image.new("RGBA", foreground.size, CREAM)
    preview.alpha_composite(foreground)
    return preview


def sheets(cases_path: Path, out_root: Path) -> None:
    manifest = _read_json(cases_path)
    font = ImageFont.load_default(size=24)
    small_font = ImageFont.load_default(size=18)
    margin = 24
    column_width = 360
    image_box = 328
    labels = ("Painted target", "RGBA on cream", "Model blend", "Exact composite")
    sheet_width = margin * 2 + column_width * len(labels)
    sheet_height = 690
    for case in manifest["cases"]:
        case_id = str(case["caseId"])
        case_dir = out_root / case_id
        input_dir = out_root.parent / "inputs" / case_id
        paths = (
            input_dir / "painted-reference.png",
            case_dir / "foreground.png",
            case_dir / "model-blend.png",
            case_dir / "deterministic-composite.png",
        )
        images: list[Image.Image] = []
        for index, path in enumerate(paths):
            if index == 1:
                images.append(_foreground_preview(path))
            else:
                with Image.open(path) as source:
                    images.append(source.convert("RGBA").copy())
        sheet = Image.new("RGBA", (sheet_width, sheet_height), PANEL_BG)
        draw = ImageDraw.Draw(sheet)
        draw.text((margin, 18), case_id, fill=(35, 33, 28, 255), font=font)
        for index, (label, current) in enumerate(zip(labels, images, strict=True)):
            x = margin + index * column_width
            draw.text((x, 62), label, fill=(45, 43, 38, 255), font=small_font)
            fitted, position = _fit(current, (x, 100, x + image_box, 100 + image_box))
            sheet.alpha_composite(fitted, position)
        draw.text(
            (margin, 460),
            f"Seed {case['seed']} | 512x512 | 28 steps | DPM++ 2M Karras | DreamShaper 8",
            fill=(65, 61, 53, 255),
            font=small_font,
        )
        prompt = str(case["prompt"])
        words = prompt.split()
        lines: list[str] = []
        current_line: list[str] = []
        for word in words:
            proposal = " ".join(current_line + [word])
            if draw.textlength(proposal, font=small_font) > sheet_width - margin * 2 and current_line:
                lines.append(" ".join(current_line))
                current_line = [word]
            else:
                current_line.append(word)
        if current_line:
            lines.append(" ".join(current_line))
        draw.multiline_text(
            (margin, 500),
            "\n".join(lines[:5]),
            fill=(65, 61, 53, 255),
            font=small_font,
            spacing=5,
        )
        sheet.convert("RGB").save(out_root / f"sheet-{case_id}.png")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--out", type=Path, required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--server", default="http://127.0.0.1:8990")
    run_parser.add_argument("--input-root", type=Path, required=True)
    run_parser.add_argument("--output-root", type=Path, required=True)
    run_parser.add_argument("--setup-root", type=Path, required=True)

    sheets_parser = subparsers.add_parser("sheets")
    sheets_parser.add_argument("--out", type=Path, required=True)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "prepare":
        prepare(args.cases, args.out)
    elif args.command == "run":
        run(args.cases, args.server, args.input_root, args.output_root, args.setup_root)
    elif args.command == "sheets":
        sheets(args.cases, args.out)


if __name__ == "__main__":
    main()
