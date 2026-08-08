"""THROWAWAY PROTOTYPE: affine ECC on painted-change masks for three birds."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3]
LEVEL_ID = "cozy_interiors_cozy_toymaker_workshop_bird_4e44"
LEVEL_DIR = ROOT / "games/find_the_bird/public/levels" / LEVEL_ID
REPORT = json.loads((Path(__file__).parent / "report.json").read_text())


def main():
    level = json.loads((LEVEL_DIR / "level.json").read_text())
    scene = np.asarray(Image.open(LEVEL_DIR / "color.png").convert("RGB"))
    clean = np.asarray(Image.open(LEVEL_DIR / "bg_00.png").convert("RGB"))
    diff = np.abs(scene.astype(np.int16) - clean.astype(np.int16)).sum(axis=2)
    level_report = next(item for item in REPORT["levels"] if item["levelId"] == LEVEL_ID)
    report_birds = {bird["dogId"]: bird for bird in level_report["birds"]}
    outputs = []

    for dog_id in ("dog_01", "dog_02", "dog_09"):
        dog = next(item for item in level["dogs"] if item["id"] == dog_id)
        meta = dog["sprite"]
        original = [meta["x"], meta["y"], meta["x"] + meta["width"], meta["y"] + meta["height"]]
        color_box = report_birds[dog_id]["colorAlignment"]["fittedBox"]
        pad = 130
        x0, y0 = max(0, original[0] - pad), max(0, original[1] - pad)
        x1, y1 = min(scene.shape[1], original[2] + pad), min(scene.shape[0], original[3] + pad)
        target = (diff[y0:y1, x0:x1] > 30).astype(np.uint8)
        target = cv2.morphologyEx(target, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(target, 8)
        anchor = (round((original[0] + original[2]) / 2) - x0, round((original[1] + original[3]) / 2) - y0)
        label = int(labels[min(max(anchor[1], 0), labels.shape[0] - 1), min(max(anchor[0], 0), labels.shape[1] - 1)])
        if label == 0:
            overlaps = []
            ox0, oy0, ox1, oy1 = original[0] - x0, original[1] - y0, original[2] - x0, original[3] - y0
            for index in range(1, count):
                overlaps.append((int((labels[oy0:oy1, ox0:ox1] == index).sum()), index))
            label = max(overlaps)[1]
        target = (labels == label).astype(np.uint8)

        rel = meta["image"].split(f"levels/{LEVEL_ID}/", 1)[-1]
        alpha = np.asarray(Image.open(LEVEL_DIR / rel).convert("RGBA"))[:, :, 3]
        source = np.zeros_like(target)
        resized = cv2.resize(alpha, (meta["width"], meta["height"]), interpolation=cv2.INTER_AREA)
        px, py = original[0] - x0, original[1] - y0
        source[py:py + meta["height"], px:px + meta["width"]] = resized > 8
        template = cv2.GaussianBlur(target.astype(np.float32), (11, 11), 0)
        moving = cv2.GaussianBlur(source.astype(np.float32), (11, 11), 0)
        warp = np.eye(2, 3, dtype=np.float32)
        try:
            ecc, warp = cv2.findTransformECC(
                template, moving, warp, cv2.MOTION_AFFINE,
                (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-7),
                None, 5,
            )
            fitted = cv2.warpAffine(source, warp, (target.shape[1], target.shape[0]), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP)
            intersection = float((fitted & target).sum())
            dice = 2 * intersection / max(1.0, float(fitted.sum() + target.sum()))
        except cv2.error:
            ecc, dice = -1.0, 0.0

        panel = Image.fromarray(scene[y0:y1, x0:x1]).convert("RGB")
        draw = ImageDraw.Draw(panel)
        draw.rectangle(tuple(color_box[index] - (x0 if index % 2 == 0 else y0) for index in range(4)), outline="#43bfff", width=3)
        contour = cv2.morphologyEx((fitted > 0).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8)) if ecc >= 0 else np.zeros_like(target)
        rgba = np.zeros((*contour.shape, 4), dtype=np.uint8)
        rgba[contour > 0] = (255, 76, 216, 255)
        panel = Image.alpha_composite(panel.convert("RGBA"), Image.fromarray(rgba, "RGBA")).convert("RGB")
        panel.thumbnail((620, 440))
        outputs.append((dog_id, panel, ecc, dice, warp.copy()))

    canvas = Image.new("RGB", (660, len(outputs) * 500), "#0c0d11")
    draw = ImageDraw.Draw(canvas)
    for index, (dog_id, panel, ecc, dice, warp) in enumerate(outputs):
        top = index * 500
        canvas.paste(panel, ((660 - panel.width) // 2, top + 42))
        draw.text((20, top + 14), f"{dog_id}  ECC {ecc:.3f}  Dice {dice:.3f}  affine {np.round(warp, 3).tolist()}", fill="white")
    out = Path(__file__).parent / "prototype-affine-contour.png"
    canvas.save(out)
    print(out)


if __name__ == "__main__":
    main()
