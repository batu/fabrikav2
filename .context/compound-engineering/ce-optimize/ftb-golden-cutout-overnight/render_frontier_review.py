from __future__ import annotations

import importlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[4]
EDITOR = ROOT / "tools/level-editor"
LEVELS = ROOT / "games/find_the_bird/public/levels"
ROWS_PATH = EDITOR / "eval/results/golden-cutout-v1/placement-evaluation.json"
BASELINE_CONFIG = EDITOR / "eval/overnight-hillclimb/candidate.json"
WINNER_CONFIG = Path(__file__).resolve().parent / "frontier/placement-gradient-depth-2/candidate.json"
OUT = Path(__file__).resolve().parent / "visual-review"

sys.path.insert(0, str(EDITOR))
placement_box_metrics = importlib.import_module("levelbuilder.golden_cutouts").placement_box_metrics

spec = importlib.util.spec_from_file_location("overnight_measure", EDITOR / "eval/overnight-hillclimb/measure.py")
assert spec and spec.loader
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)

COLORS = [(201, 126, 39), (82, 120, 190), (57, 142, 91), (38, 45, 40)]


def crop_bounds(boxes: list[list[int]], scene: Image.Image) -> tuple[int, int, int, int]:
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[2] for box in boxes)
    bottom = max(box[3] for box in boxes)
    pad = max(40, round(max(right - left, bottom - top) * 0.55))
    return max(0, left - pad), max(0, top - pad), min(scene.width, right + pad), min(scene.height, bottom + pad)


def panel(scene: Image.Image, sprite: Image.Image, box: list[int], crop: tuple[int, int, int, int], label: str, color: tuple[int, int, int]) -> Image.Image:
    base = scene.crop(crop).convert("RGBA")
    x0, y0, x1, y1 = box
    width, height = max(1, x1 - x0), max(1, y1 - y0)
    alpha = sprite.getchannel("A").resize((width, height), Image.Resampling.LANCZOS)
    expanded = alpha.filter(ImageFilter.MaxFilter(7))
    contour = Image.frombytes("L", alpha.size, bytes(max(0, a - b) for a, b in zip(expanded.tobytes(), alpha.tobytes(), strict=True)))
    tint = Image.new("RGBA", alpha.size, (*color, 255))
    tint.putalpha(alpha.point(lambda value: min(92, value)))
    edge = Image.new("RGBA", alpha.size, (*color, 255))
    edge.putalpha(contour)
    px, py = x0 - crop[0], y0 - crop[1]
    base.alpha_composite(tint, (px, py))
    base.alpha_composite(edge, (px, py))
    draw = ImageDraw.Draw(base)
    draw.rectangle((px, py, px + width - 1, py + height - 1), outline=(*color, 255), width=3)
    draw.rectangle((0, 0, base.width, 28), fill=(20, 23, 21, 225))
    draw.text((8, 8), label, fill=(*color, 255))
    return ImageOps.fit(base.convert("RGB"), (300, 210), method=Image.Resampling.LANCZOS)


def selected_box(row: dict[str, Any]) -> list[int]:
    return row["hybridPrediction"] if row["applied"] else row["initialBox"]


def loss(row: dict[str, Any], box: list[int]) -> float:
    return float(placement_box_metrics(box, row["targetBox"])["loss"])


baseline_config = json.loads(BASELINE_CONFIG.read_text())["placement"]
winner_config = json.loads(WINNER_CONFIG.read_text())["placement"]
_, baseline_rows = measure.evaluate_placement(baseline_config)
_, winner_rows = measure.evaluate_placement(winner_config)
raw_rows = json.loads(ROWS_PATH.read_text())["rows"]
baseline = {(row["levelId"], row["dogId"]): row for row in baseline_rows}
winner = {(row["levelId"], row["dogId"]): row for row in winner_rows}
raw = {(row["levelId"], row["dogId"]): row for row in raw_rows}

changed = {key for key in raw if baseline[key]["applied"] != winner[key]["applied"]}
hard = {
    ("cozy_interiors_cozy_toymaker_workshop_bird_4e44", "dog_01"),
    ("cozy_interiors_cozy_toymaker_workshop_bird_4e44", "dog_02"),
    ("cozy_interiors_cozy_toymaker_workshop_bird_4e44", "dog_09"),
}
worst = sorted(raw, key=lambda key: loss(raw[key], selected_box(winner[key])), reverse=True)[:6]
keys = sorted(changed | hard | set(worst))
OUT.mkdir(parents=True, exist_ok=True)
summary = []
cards = []
for key in keys:
    row = raw[key]
    baseline_row = baseline[key]
    winner_row = winner[key]
    baseline_box = selected_box(baseline_row)
    winner_box = selected_box(winner_row)
    scene = Image.open(LEVELS / key[0] / "color.png").convert("RGB")
    sprite = Image.open(LEVELS / key[0] / row["sprite"]).convert("RGBA")
    boxes = [row["initialBox"], baseline_box, winner_box, row["targetBox"]]
    crop = crop_bounds(boxes, scene)
    labels = [
        "CURRENT",
        f"LOGISTIC {'APPLY' if baseline_row['applied'] else 'KEEP'} {baseline_row['probability']:.0%}",
        f"BOOST {'APPLY' if winner_row['applied'] else 'KEEP'} {winner_row['probability']:.0%}",
        "HUMAN TARGET",
    ]
    images = [panel(scene, sprite, box, crop, label, color) for box, label, color in zip(boxes, labels, COLORS, strict=True)]
    card = Image.new("RGB", (1200, 258), "#eeeae0")
    for index, image in enumerate(images):
        card.paste(image, (index * 300, 48))
    draw = ImageDraw.Draw(card)
    delta = loss(row, baseline_box) - loss(row, winner_box)
    draw.text((10, 9), f"{key[0]} / {key[1]}  {row['trialType']}  winner delta {delta:+.4f}", fill="#20251f")
    draw.text((10, 27), f"initial {loss(row, row['initialBox']):.4f}  logistic {loss(row, baseline_box):.4f}  boost {loss(row, winner_box):.4f}", fill="#5c625b")
    cards.append(card)
    summary.append({
        "levelId": key[0],
        "dogId": key[1],
        "trialType": row["trialType"],
        "baselineApplied": baseline_row["applied"],
        "winnerApplied": winner_row["applied"],
        "baselineProbability": baseline_row["probability"],
        "winnerProbability": winner_row["probability"],
        "initialLoss": loss(row, row["initialBox"]),
        "baselineLoss": loss(row, baseline_box),
        "winnerLoss": loss(row, winner_box),
        "winnerDelta": delta,
        "changedDecision": key in changed,
        "namedHardCase": key in hard,
        "worstCase": key in worst,
    })
    scene.close()
    sprite.close()

for page_index in range(0, len(cards), 4):
    page_cards = cards[page_index:page_index + 4]
    page = Image.new("RGB", (1200, len(page_cards) * 258), "#eeeae0")
    for row_index, card in enumerate(page_cards):
        page.paste(card, (0, row_index * 258))
    page.save(OUT / f"frontier-{page_index // 4 + 1:02d}.png", optimize=True)

(OUT / "cases.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
print(json.dumps({"cases": len(summary), "pages": (len(cards) + 3) // 4, "output": str(OUT)}, sort_keys=True))
