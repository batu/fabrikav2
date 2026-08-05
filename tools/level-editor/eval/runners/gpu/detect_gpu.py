"""Tiled open-vocab bird detection on the 4090 (runs on ubuntu-server).

Usage: .venv/bin/python detect_gpu.py --backend owlv2|gdino|yoloworld \
    --out runs/<name> [--tile 1024] [--overlap 256] [--conf 0.1] [--prompt "bird"]

Reads ~/hitbox-lab/scenes/<sid>/color.png (from manifest.json).
Writes runs/<name>/<sid>.json: [{"x","y","w","h","score"}] in scene px,
plus _run.json with backend, weights, params, timings, GPU mem.
Deterministic: no sampling; fixed weights; NMS is deterministic.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
LAB = Path.home() / "hitbox-lab"

WEIGHTS = {
    "owlv2": "google/owlv2-large-patch14-ensemble",
    "gdino": "IDEA-Research/grounding-dino-base",
    "yoloworld": "yolov8x-worldv2.pt",
}


def tiles_for(W: int, H: int, tile: int, overlap: int):
    step = tile - overlap
    xs = list(range(0, max(1, W - tile) + 1, step))
    ys = list(range(0, max(1, H - tile) + 1, step))
    if xs[-1] + tile < W:
        xs.append(W - tile)
    if ys[-1] + tile < H:
        ys.append(H - tile)
    for y in ys:
        for x in xs:
            yield x, y


def nms(boxes: list[dict], iou_thr: float = 0.5) -> list[dict]:
    boxes = sorted(boxes, key=lambda b: -b["score"])
    kept: list[dict] = []
    for b in boxes:
        ok = True
        for k in kept:
            ix0 = max(b["x"], k["x"]); iy0 = max(b["y"], k["y"])
            ix1 = min(b["x"] + b["w"], k["x"] + k["w"])
            iy1 = min(b["y"] + b["h"], k["y"] + k["h"])
            inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
            union = b["w"] * b["h"] + k["w"] * k["h"] - inter
            if union > 0 and inter / union > iou_thr:
                ok = False
                break
        if ok:
            kept.append(b)
    return kept


class Owlv2Backend:
    def __init__(self, prompt: str):
        from transformers import Owlv2Processor, Owlv2ForObjectDetection
        self.proc = Owlv2Processor.from_pretrained(WEIGHTS["owlv2"])
        self.model = Owlv2ForObjectDetection.from_pretrained(WEIGHTS["owlv2"]).cuda().eval()
        self.prompt = [[prompt]]

    @torch.no_grad()
    def detect(self, img: Image.Image, conf: float) -> list[dict]:
        inputs = self.proc(text=self.prompt, images=img, return_tensors="pt").to("cuda")
        out = self.model(**inputs)
        res = self.proc.post_process_grounded_object_detection(
            out, threshold=conf, target_sizes=torch.tensor([img.size[::-1]]).cuda())[0]
        dets = []
        for box, score in zip(res["boxes"].tolist(), res["scores"].tolist()):
            x0, y0, x1, y1 = box
            dets.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "score": score})
        return dets


class GdinoBackend:
    def __init__(self, prompt: str):
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        self.proc = AutoProcessor.from_pretrained(WEIGHTS["gdino"])
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(WEIGHTS["gdino"]).cuda().eval()
        self.prompt = prompt if prompt.endswith(".") else prompt + "."

    @torch.no_grad()
    def detect(self, img: Image.Image, conf: float) -> list[dict]:
        inputs = self.proc(images=img, text=self.prompt, return_tensors="pt").to("cuda")
        out = self.model(**inputs)
        res = self.proc.post_process_grounded_object_detection(
            out, inputs.input_ids, threshold=conf, text_threshold=conf,
            target_sizes=[img.size[::-1]])[0]
        dets = []
        for box, score in zip(res["boxes"].tolist(), res["scores"].tolist()):
            x0, y0, x1, y1 = box
            dets.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "score": score})
        return dets


class YoloWorldBackend:
    def __init__(self, prompt: str):
        from ultralytics import YOLOWorld
        self.model = YOLOWorld(WEIGHTS["yoloworld"])
        self.model.set_classes([prompt])

    def detect(self, img: Image.Image, conf: float) -> list[dict]:
        res = self.model.predict(img, conf=conf, verbose=False, device=0)[0]
        dets = []
        for b in res.boxes:
            x0, y0, x1, y1 = b.xyxy[0].tolist()
            dets.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
                         "score": float(b.conf[0])})
        return dets


class YoloCustomBackend:
    def __init__(self, weights: str):
        from ultralytics import YOLO
        self.model = YOLO(weights)

    def detect(self, img: Image.Image, conf: float) -> list[dict]:
        res = self.model.predict(img, conf=conf, verbose=False, device=0)[0]
        dets = []
        for b in res.boxes:
            x0, y0, x1, y1 = b.xyxy[0].tolist()
            dets.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
                         "score": float(b.conf[0])})
        return dets


BACKENDS = {"owlv2": Owlv2Backend, "gdino": GdinoBackend, "yoloworld": YoloWorldBackend,
            "yolo-custom": YoloCustomBackend}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", required=True, choices=list(BACKENDS))
    ap.add_argument("--out", required=True)
    ap.add_argument("--tile", type=int, default=1024)
    ap.add_argument("--overlap", type=int, default=256)
    ap.add_argument("--conf", type=float, default=0.08)
    ap.add_argument("--prompt", default="bird")
    ap.add_argument("--weights", default=None, help="custom .pt for yolo-custom backend")
    ap.add_argument("--full-pass", action="store_true",
                    help="also run one downscaled full-image pass and merge")
    args = ap.parse_args()

    torch.manual_seed(0)
    out_dir = LAB / args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((LAB / "manifest.json").read_text())
    backend = (YoloCustomBackend(args.weights) if args.backend == "yolo-custom"
               else BACKENDS[args.backend](args.prompt))

    timings = {}
    for sid in manifest:
        t0 = time.time()
        img = Image.open(LAB / "scenes" / sid / "color.png").convert("RGB")
        W, H = img.size
        tile = min(args.tile, W)
        all_dets: list[dict] = []
        for x, y in tiles_for(W, H, tile, args.overlap):
            crop = img.crop((x, y, x + tile, y + tile))
            for d in backend.detect(crop, args.conf):
                d["x"] += x
                d["y"] += y
                all_dets.append(d)
        if args.full_pass:
            small = img.resize((1024, 1024), Image.LANCZOS)
            s = W / 1024.0
            for d in backend.detect(small, args.conf):
                all_dets.append({"x": d["x"] * s, "y": d["y"] * s,
                                 "w": d["w"] * s, "h": d["h"] * s,
                                 "score": d["score"]})
        merged = nms(all_dets)
        timings[sid] = round(time.time() - t0, 2)
        (out_dir / f"{sid}.json").write_text(json.dumps(
            [{k: round(v, 1) if isinstance(v, float) else v for k, v in d.items()}
             for d in merged]))
        print(f"{sid}: {len(merged)} dets ({len(all_dets)} pre-NMS) in {timings[sid]}s",
              flush=True)
    (out_dir / "_run.json").write_text(json.dumps({
        "backend": args.backend, "weights": args.weights or WEIGHTS.get(args.backend),
        "params": vars(args), "timings_s": timings,
        "gpu_mem_mb": int(torch.cuda.max_memory_allocated() / 1e6) if torch.cuda.is_available() else None,
        "torch": torch.__version__}, indent=2))


if __name__ == "__main__":
    main()
