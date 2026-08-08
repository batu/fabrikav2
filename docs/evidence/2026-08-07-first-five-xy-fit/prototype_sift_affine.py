"""THROWAWAY PROTOTYPE: grayscale SIFT + RANSAC affine on three Toymaker birds."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3]
LEVEL_ID = "cozy_interiors_cozy_toymaker_workshop_bird_4e44"
LEVEL_DIR = ROOT / "games/find_the_bird/public/levels" / LEVEL_ID


def main():
    level = json.loads((LEVEL_DIR / "level.json").read_text())
    scene_rgb = np.asarray(Image.open(LEVEL_DIR / "color.png").convert("RGB"))
    sift = cv2.SIFT_create(nfeatures=1000, contrastThreshold=0.01, edgeThreshold=12)
    outputs = []
    for dog_id in ("dog_01", "dog_02", "dog_09"):
        dog = next(item for item in level["dogs"] if item["id"] == dog_id)
        meta = dog["sprite"]
        rel = meta["image"].split(f"levels/{LEVEL_ID}/", 1)[-1]
        rgba = np.asarray(Image.open(LEVEL_DIR / rel).convert("RGBA"))
        source = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2GRAY)
        source_mask = (rgba[:, :, 3] > 8).astype(np.uint8) * 255
        pad = 130
        x0, y0 = max(0, meta["x"] - pad), max(0, meta["y"] - pad)
        x1 = min(scene_rgb.shape[1], meta["x"] + meta["width"] + pad)
        y1 = min(scene_rgb.shape[0], meta["y"] + meta["height"] + pad)
        target_rgb = scene_rgb[y0:y1, x0:x1]
        target = cv2.cvtColor(target_rgb, cv2.COLOR_RGB2GRAY)
        kp1, des1 = sift.detectAndCompute(source, source_mask)
        kp2, des2 = sift.detectAndCompute(target, None)
        good = []
        if des1 is not None and des2 is not None:
            for pair in cv2.BFMatcher(cv2.NORM_L2).knnMatch(des1, des2, k=2):
                if len(pair) == 2 and pair[0].distance < 0.78 * pair[1].distance:
                    good.append(pair[0])
        matrix = inliers = None
        if len(good) >= 3:
            src = np.float32([kp1[item.queryIdx].pt for item in good])
            dst = np.float32([kp2[item.trainIdx].pt for item in good])
            matrix, inliers = cv2.estimateAffine2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
        panel = Image.fromarray(target_rgb).convert("RGB")
        draw = ImageDraw.Draw(panel)
        if matrix is not None:
            alpha = cv2.warpAffine(source_mask, matrix, (target.shape[1], target.shape[0]))
            contour = cv2.morphologyEx((alpha > 8).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8))
            overlay = np.zeros((*contour.shape, 4), dtype=np.uint8)
            overlay[contour > 0] = (255, 76, 216, 255)
            panel = Image.alpha_composite(panel.convert("RGBA"), Image.fromarray(overlay, "RGBA")).convert("RGB")
            for match, keep in zip(good, inliers.ravel()):
                if keep:
                    px, py = kp2[match.trainIdx].pt
                    ImageDraw.Draw(panel).ellipse((px - 3, py - 3, px + 3, py + 3), fill="#55ff99")
        panel.thumbnail((620, 440))
        inlier_count = int(inliers.sum()) if inliers is not None else 0
        outputs.append((dog_id, panel, len(kp1), len(kp2), len(good), inlier_count, matrix))

    canvas = Image.new("RGB", (660, 1500), "#0c0d11")
    draw = ImageDraw.Draw(canvas)
    for index, (dog_id, panel, n1, n2, matches, inliers, matrix) in enumerate(outputs):
        top = index * 500
        canvas.paste(panel, ((660 - panel.width) // 2, top + 42))
        draw.text((20, top + 14), f"{dog_id} sourceKP {n1} targetKP {n2} matches {matches} inliers {inliers} affine {None if matrix is None else np.round(matrix, 2).tolist()}", fill="white")
    out = Path(__file__).parent / "prototype-sift-affine.png"
    canvas.save(out)
    print(out)


if __name__ == "__main__":
    main()
