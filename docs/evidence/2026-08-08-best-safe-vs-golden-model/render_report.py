from __future__ import annotations

import base64
import html
import io
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from levelbuilder.api.sprite_eval import BirdInputs, level_noise_floor, match_cutout
from levelbuilder.golden_cutouts import (
    cutout_quality_features,
    predict_portable_logistic,
    should_apply_portable_placement,
)


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LEVELS = ROOT / "games/find_the_bird/public/levels"
SOURCE_REPORT = ROOT / "docs/evidence/2026-08-07-all-level-cutout-matching/report.json"
MODEL_REPORT = ROOT / "tools/level-editor/eval/results/golden-cutout-v1/placement-evaluation.json"
REDO_REPORT = ROOT / "tools/level-editor/eval/results/golden-cutout-v1/redo-evaluation.json"
OUTPUT = HERE / "report.html"
DATA_OUTPUT = HERE / "report-data.json"
LIMIT = 98
EXCLUDED_LEVELS = {"ad_campaigns_ad_autumn_forest_bird_389c_gpro"}

INK = (236, 239, 232)
SAFE = (90, 205, 137)
MODEL = (67, 170, 220)


def _rgb(path: Path) -> np.ndarray:
    with Image.open(path) as source:
        return np.asarray(source.convert("RGB"), dtype=np.uint8)


def _sprite_path(level_dir: Path, level_id: str, sprite: dict[str, Any]) -> Path:
    relative = str(sprite["image"])
    prefix = f"levels/{level_id}/"
    if relative.startswith(prefix):
        relative = relative[len(prefix):]
    return level_dir / relative


def _inputs(level_dir: Path, level: dict[str, Any], dog: dict[str, Any]) -> BirdInputs:
    level_id = level_dir.name
    clean = _rgb(level_dir / "bg_00.png")
    scene = _rgb(level_dir / "color.png")
    if clean.shape != scene.shape:
        raise ValueError(f"clean/painted dimensions differ for {level_id}")
    cleanup_boxes = []
    for other in level.get("dogs", []):
        cleanup = (other.get("sprite") or {}).get("cleanup")
        if cleanup:
            cleanup_boxes.append((
                cleanup["x"], cleanup["y"],
                cleanup["x"] + cleanup["width"], cleanup["y"] + cleanup["height"],
            ))
    noise_floor = level_noise_floor(clean, scene, cleanup_boxes)
    sprite_meta = dog["sprite"]
    sx, sy = int(sprite_meta["x"]), int(sprite_meta["y"])
    sw, sh = int(sprite_meta["width"]), int(sprite_meta["height"])
    sprite_box = (sx, sy, sx + sw, sy + sh)
    sprite_path = _sprite_path(level_dir, level_id, sprite_meta)
    sidecar_path = sprite_path.with_suffix(".json")
    sidecar = json.loads(sidecar_path.read_text()) if sidecar_path.is_file() else {}
    crop = tuple(sidecar.get("sourceBox") or ())
    if len(crop) != 4:
        pad = max(sw, sh) // 2
        crop = (sx - pad, sy - pad, sx + sw + pad, sy + sh + pad)
    anchor_x = round(sx + float(sprite_meta.get("anchorX", 0.5)) * sw)
    anchor_y = round(sy + float(sprite_meta.get("anchorY", 0.5)) * sh)
    search_pad = max(sw, sh) + 96
    crop = (
        min(int(crop[0]), sx - 96, anchor_x - search_pad),
        min(int(crop[1]), sy - 96, anchor_y - search_pad),
        max(int(crop[2]), sx + sw + 96, anchor_x + search_pad),
        max(int(crop[3]), sy + sh + 96, anchor_y + search_pad),
    )
    width = int(level.get("width") or scene.shape[1])
    height = int(level.get("height") or scene.shape[0])
    crop = (
        max(0, crop[0]), max(0, crop[1]),
        min(width, crop[2]), min(height, crop[3]),
    )
    neighbors = []
    for other in level.get("dogs", []):
        if other is dog:
            continue
        other_sprite = other.get("sprite") or {}
        if all(key in other_sprite for key in ("x", "y", "width", "height")):
            ox, oy = int(other_sprite["x"]), int(other_sprite["y"])
            neighbors.append((ox, oy, ox + int(other_sprite["width"]), oy + int(other_sprite["height"])))
    x0, y0, x1, y1 = crop
    return BirdInputs(
        dog_id=str(dog["id"]),
        sprite=Image.open(sprite_path).convert("RGBA"),
        sprite_box=sprite_box,
        crop_box=crop,
        clean_crop=clean[y0:y1, x0:x1],
        scene_crop=scene[y0:y1, x0:x1],
        noise_floor=noise_floor,
        neighbor_boxes=tuple(neighbors),
        target_point=(anchor_x, anchor_y),
    )


def _selection_features(inputs: BirdInputs, color: dict[str, Any], hybrid: dict[str, Any]) -> dict[str, float]:
    cx0, cy0, _, _ = inputs.crop_box
    sx0, sy0, sx1, sy1 = inputs.sprite_box
    quality = cutout_quality_features(
        inputs.clean_crop,
        inputs.scene_crop,
        inputs.sprite,
        (sx0 - cx0, sy0 - cy0, sx1 - cx0, sy1 - cy0),
    )
    fitted = hybrid.get("fittedBox") or list(inputs.sprite_box)
    movement = math.hypot(
        (fitted[0] + fitted[2] - sx0 - sx1) / 2,
        (fitted[1] + fitted[3] - sy0 - sy1) / 2,
    )
    components = hybrid.get("components") or {}
    return {
        **quality,
        "hybridScore": float(hybrid.get("score") or 0.0),
        "hybridColor": float(components.get("color") or 0.0),
        "hybridSilhouette": float(components.get("silhouette") or 0.0),
        "hybridEdge": float(components.get("edge") or 0.0),
        "hybridScale": float(hybrid.get("scale") or 1.0),
        "hybridMovementNorm": movement / max(1.0, math.hypot(sx1 - sx0, sy1 - sy0)),
        "colorScore": float(color.get("score") or 0.0),
    }


def _selected_box(match: dict[str, Any], fallback: tuple[int, int, int, int]) -> list[int]:
    accepted = match.get("accepted", match.get("verdict") == "pass")
    return list(match.get("fittedBox") or fallback) if accepted else list(fallback)


def _crop_bounds(scene: Image.Image, boxes: list[list[int]]) -> tuple[int, int, int, int]:
    x0 = min(box[0] for box in boxes)
    y0 = min(box[1] for box in boxes)
    x1 = max(box[2] for box in boxes)
    y1 = max(box[3] for box in boxes)
    pad = max(52, round(max(x1 - x0, y1 - y0) * 0.65))
    return max(0, x0 - pad), max(0, y0 - pad), min(scene.width, x1 + pad), min(scene.height, y1 + pad)


def _overlay(
    scene: Image.Image,
    sprite: Image.Image,
    box: list[int],
    crop: tuple[int, int, int, int],
    color: tuple[int, int, int],
    label: str,
    detail: str,
) -> Image.Image:
    panel = scene.crop(crop).convert("RGBA")
    x0, y0, x1, y1 = box
    width, height = max(1, x1 - x0), max(1, y1 - y0)
    alpha = sprite.getchannel("A").resize((width, height), Image.Resampling.LANCZOS)
    expanded = alpha.filter(ImageFilter.MaxFilter(9))
    contour = Image.frombytes("L", alpha.size, bytes(max(0, a - b) for a, b in zip(expanded.tobytes(), alpha.tobytes())))
    tint = Image.new("RGBA", alpha.size, (*color, 64))
    tint.putalpha(alpha.point(lambda value: min(82, value)))
    edge = Image.new("RGBA", alpha.size, (*color, 255))
    edge.putalpha(contour)
    px, py = x0 - crop[0], y0 - crop[1]
    panel.alpha_composite(tint, (px, py))
    panel.alpha_composite(edge, (px, py))
    draw = ImageDraw.Draw(panel)
    draw.rectangle((px, py, px + width - 1, py + height - 1), outline=(*color, 245), width=4)
    panel.thumbnail((520, 360), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (540, 410), "#101411")
    canvas.paste(panel.convert("RGB"), ((540 - panel.width) // 2, 42 + (350 - panel.height) // 2))
    label_draw = ImageDraw.Draw(canvas)
    label_draw.text((16, 13), label, fill=color)
    label_draw.text((526 - len(detail) * 6, 14), detail, fill=INK)
    return canvas


def _data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, "JPEG", quality=78, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()


def _candidate_keys(source: dict[str, Any]) -> list[tuple[str, str]]:
    output = []
    for level in source["levels"]:
        level_id = str(level["levelId"])
        if level_id in EXCLUDED_LEVELS:
            continue
        level_path = LEVELS / level_id / "level.json"
        if not level_path.is_file():
            continue
        live = json.loads(level_path.read_text())
        live_dogs = {str(dog.get("id")): dog for dog in live.get("dogs", [])}
        for bird in level.get("birds", []):
            dog_id = str(bird.get("dogId"))
            dog = live_dogs.get(dog_id)
            if dog is None or not dog.get("sprite"):
                continue
            if _sprite_path(LEVELS / level_id, level_id, dog["sprite"]).is_file():
                output.append((level_id, dog_id))
            if len(output) == LIMIT:
                return output
    raise RuntimeError(f"only found {len(output)} eligible birds; expected {LIMIT}")


def _binary_metrics(predictions: list[dict[str, Any]], *, actual_key: str, predicted_key: str) -> dict[str, Any]:
    tp = sum(bool(row[actual_key]) and bool(row[predicted_key]) for row in predictions)
    fp = sum(not bool(row[actual_key]) and bool(row[predicted_key]) for row in predictions)
    tn = sum(not bool(row[actual_key]) and not bool(row[predicted_key]) for row in predictions)
    fn = sum(bool(row[actual_key]) and not bool(row[predicted_key]) for row in predictions)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    return {
        "samples": len(predictions), "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "accuracy": (tp + tn) / len(predictions) if predictions else 0.0,
        "balancedAccuracy": (recall + specificity) / 2,
        "precision": precision, "recall": recall, "specificity": specificity,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
    }


def main() -> None:
    source = json.loads(SOURCE_REPORT.read_text())
    evaluation = json.loads(MODEL_REPORT.read_text())
    redo_evaluation = json.loads(REDO_REPORT.read_text())
    model = evaluation["productionModel"]
    keys = _candidate_keys(source)
    by_level: dict[str, list[str]] = {}
    for level_id, dog_id in keys:
        by_level.setdefault(level_id, []).append(dog_id)

    rows = []
    cards = []
    for index, (level_id, dog_id) in enumerate(keys, start=1):
        level_dir = LEVELS / level_id
        level = json.loads((level_dir / "level.json").read_text())
        dog = next(item for item in level["dogs"] if str(item.get("id")) == dog_id)
        inputs = _inputs(level_dir, level, dog)
        try:
            matches = match_cutout(inputs, ("best", "hybrid", "color"))
            best = matches["best"]
            hybrid = matches["hybrid"]
            features = _selection_features(inputs, matches["color"], hybrid)
            probability = predict_portable_logistic(model, features)
            model_applied = should_apply_portable_placement(model, features)
            original_box = list(inputs.sprite_box)
            safe_box = _selected_box(best, inputs.sprite_box)
            model_box = list(hybrid.get("fittedBox") or original_box) if model_applied else original_box
            scene = Image.fromarray(inputs.scene_crop, "RGB")
            local_safe = [safe_box[0] - inputs.crop_box[0], safe_box[1] - inputs.crop_box[1], safe_box[2] - inputs.crop_box[0], safe_box[3] - inputs.crop_box[1]]
            local_model = [model_box[0] - inputs.crop_box[0], model_box[1] - inputs.crop_box[1], model_box[2] - inputs.crop_box[0], model_box[3] - inputs.crop_box[1]]
            crop = _crop_bounds(scene, [local_safe, local_model])
            safe_method = str(best.get("method") or "rejected")
            left = _overlay(scene, inputs.sprite, local_safe, crop, SAFE, "BEST SAFE · NO GOLDEN DATA", safe_method.upper())
            model_detail = f"USE NEW FIT {probability:.0%}" if model_applied else f"KEEP CURRENT {probability:.0%}"
            right = _overlay(scene, inputs.sprite, local_model, crop, MODEL, "CURRENT GOLDEN MODEL", model_detail)
            visual = Image.new("RGB", (1080, 410), "#0b0e0c")
            visual.paste(left, (0, 0))
            visual.paste(right, (540, 0))
            distance = math.hypot(
                (safe_box[0] + safe_box[2] - model_box[0] - model_box[2]) / 2,
                (safe_box[1] + safe_box[3] - model_box[1] - model_box[3]) / 2,
            )
            same = safe_box == model_box
            row = {
                "index": index,
                "levelId": level_id,
                "dogId": dog_id,
                "bestSafeMethod": safe_method,
                "bestSafeBox": safe_box,
                "modelBox": model_box,
                "modelProbability": round(probability, 6),
                "modelApplied": model_applied,
                "sameBox": same,
                "centerDeltaPx": round(distance, 2),
            }
            rows.append(row)
            cards.append(
                f'''<article class="case" data-search="{html.escape((level_id + ' ' + dog_id).lower())}" data-different="{str(not same).lower()}">
                <div class="visual"><img loading="lazy" src="{_data_url(visual)}" alt="Best Safe and calibrated model placement comparison for {html.escape(level_id)} {html.escape(dog_id)}"></div>
                <div class="meta"><span class="number">{index:02d}</span><div><h2>{html.escape(dog_id)}</h2><p>{html.escape(level_id)}</p></div><div class="facts"><b>{'same placement' if same else f'{distance:.1f}px apart'}</b><span>Best Safe: {html.escape(safe_method)} · model: {'use new fit' if model_applied else 'keep current placement'} {probability:.0%}</span></div></div>
                </article>'''
            )
        finally:
            inputs.sprite.close()

    method_counts = Counter(row["bestSafeMethod"] for row in rows)
    same_count = sum(row["sameBox"] for row in rows)
    applied_count = sum(row["modelApplied"] for row in rows)
    level_count = len(by_level)
    placement_name = evaluation["recommendedProduction"]
    placement_evaluation = evaluation["learnedSelectors"][placement_name]
    placement_binary = _binary_metrics(
        placement_evaluation["predictions"], actual_key="actualCorrection", predicted_key="applied",
    )
    placement_binary.update({"name": placement_name, "threshold": placement_evaluation["threshold"]})
    redo_name = redo_evaluation["recommendedProduction"]
    redo_model = redo_evaluation["models"][redo_name]
    redo_binary = _binary_metrics(redo_model["predictions"], actual_key="actual", predicted_key="predicted")
    redo_binary.update({
        "name": redo_name,
        "threshold": redo_model["threshold"],
        "rocAuc": redo_model["rocAuc"],
        "averagePrecision": redo_model["averagePrecision"],
        "predictionMode": redo_evaluation["predictionMode"],
    })
    data = {
        "schemaVersion": 1,
        "source": str(SOURCE_REPORT.relative_to(ROOT)),
        "model": str(MODEL_REPORT.relative_to(ROOT)),
        "excludedLevels": sorted(EXCLUDED_LEVELS),
        "summary": {
            "birds": len(rows), "levels": level_count, "sameBox": same_count,
            "differentBox": len(rows) - same_count, "modelApplied": applied_count,
            "modelKept": len(rows) - applied_count, "bestSafeMethods": dict(method_counts),
        },
        "binaryMetrics": {
            "shouldApplyPlacement": placement_binary,
            "shouldRegenerate": redo_binary,
        },
        "rows": rows,
    }
    DATA_OUTPUT.write_text(json.dumps(data, indent=2) + "\n")

    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Best Safe vs Golden Model · 98 Birds</title><style>
:root{{--paper:#e9ebe4;--ink:#172019;--muted:#667168;--line:#b8c0b7;--safe:#2f8755;--model:#216f9b;--panel:#f8faf5}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 Charter,"Iowan Old Style",Georgia,serif}}main{{width:min(1240px,calc(100% - 28px));margin:auto;padding:30px 0 80px}}header{{display:grid;grid-template-columns:1.35fr .65fr;gap:36px;border-top:8px solid var(--ink);padding:22px 0 30px}}.eyebrow,.facts,.toolbar,.number{{font-family:"SFMono-Regular",Consolas,monospace}}.eyebrow{{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--safe)}}h1{{font-size:clamp(42px,7vw,88px);line-height:.92;letter-spacing:-.055em;margin:8px 0 18px}}.lede{{font-size:21px;max-width:780px;margin:0;color:#39463d}}.summary{{align-self:end;border-left:1px solid var(--line);padding-left:24px}}.summary b{{display:block;font-size:31px;line-height:1.1}}.summary span{{color:var(--muted)}}.legend{{display:grid;grid-template-columns:1fr 1fr;margin:12px 0 22px;border:1px solid var(--line);background:var(--panel)}}.legend div{{padding:16px 20px}}.legend div+div{{border-left:1px solid var(--line)}}.legend b{{display:block;font-size:18px}}.legend .safe b{{color:var(--safe)}}.legend .model b{{color:var(--model)}}.legend span{{color:var(--muted)}}.toolbar{{position:sticky;top:8px;z-index:4;display:flex;gap:10px;align-items:center;background:#e9ebe4ee;backdrop-filter:blur(12px);padding:10px 0;border-bottom:1px solid var(--line)}}input[type=search]{{flex:1;min-width:140px;border:1px solid var(--line);background:var(--panel);padding:10px 12px;font:inherit}}button{{font:inherit}}.filter{{border:1px solid var(--line);background:var(--panel);padding:10px 13px;cursor:pointer}}.filter[aria-pressed=true]{{background:var(--ink);color:white;border-color:var(--ink)}}.grid{{display:grid;gap:16px;margin-top:18px}}.case{{background:var(--panel);border:1px solid var(--line)}}.case[hidden]{{display:none}}.visual{{display:block;width:100%;padding:0;border:0;background:#0b0e0c;cursor:zoom-in}}.visual img{{display:block;width:100%;height:auto}}.meta{{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:14px;align-items:center;padding:13px 16px}}.number{{font-size:19px;color:var(--safe)}}h2{{font-size:21px;margin:0}}.meta p{{margin:2px 0 0;color:var(--muted);font:11px/1.35 "SFMono-Regular",Consolas,monospace;word-break:break-all}}.facts{{text-align:right;font-size:11px}}.facts b,.facts span{{display:block}}.facts span{{color:var(--muted)}}dialog{{width:min(96vw,1500px);padding:0;border:0;background:#0b0e0c;box-shadow:0 24px 90px #0009}}dialog::backdrop{{background:#101610d9}}dialog img{{display:block;width:100%;height:auto}}dialog button{{position:absolute;right:12px;top:12px;border:1px solid #ffffff66;background:#111d;color:white;padding:8px 12px;cursor:pointer}}.foot{{margin-top:42px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted)}}@media(max-width:760px){{header{{grid-template-columns:1fr}}.summary{{border-left:0;padding-left:0}}.meta{{grid-template-columns:40px 1fr}}.facts{{grid-column:2;text-align:left}}.legend{{grid-template-columns:1fr}}.legend div+div{{border-left:0;border-top:1px solid var(--line)}}}}@media(prefers-reduced-motion:reduce){{html{{scroll-behavior:auto}}}}
</style></head><body><main><header><div><span class="eyebrow">Find the Bird · controlled visual comparison · 08 August 2026</span><h1>Best Safe<br>versus the model</h1><p class="lede">The same 98 sprites, the same painted scenes, and the same crop framing. Only the placement selector changes.</p></div><div class="summary"><b>{same_count} identical</b><b>{len(rows)-same_count} different</b><span>{applied_count} new fits · {len(rows)-applied_count} current placements<br>{level_count} source levels · broken gpro excluded</span></div></header>
<style>.binary-head{{display:grid;grid-template-columns:.7fr 1.3fr;gap:30px;border-top:1px solid var(--line);padding-top:22px;margin-top:10px}}.binary-head h2{{font-size:31px;margin:0}}.binary-head p{{margin:0;color:var(--muted);font-size:17px}}.binary-grid{{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);margin:18px 0 30px}}.binary{{background:var(--panel);padding:18px;font-family:"SFMono-Regular",Consolas,monospace}}.binary h3{{font-family:Charter,"Iowan Old Style",Georgia,serif;font-size:21px;margin:0 0 4px}}.binary .mode{{color:var(--muted);font-size:11px}}.metric-row{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:15px}}.metric-row b{{display:block;font-size:22px}}.metric-row span{{color:var(--muted);font-size:10px}}.confusion{{margin-top:14px;color:var(--muted);font-size:11px}}.warning{{border-left:4px solid #b9782c;padding-left:10px;margin-top:12px;font-family:Charter,"Iowan Old Style",Georgia,serif;color:#66502e}}.filter-toggle{{position:absolute;opacity:0;pointer-events:none}}.filter-label{{border:1px solid var(--line);background:var(--panel);padding:10px 13px;cursor:pointer}}.count-diff{{display:none}}#different-toggle:checked~.toolbar .filter-label{{background:var(--ink);color:white;border-color:var(--ink)}}#different-toggle:checked~.toolbar .count-all{{display:none}}#different-toggle:checked~.toolbar .count-diff{{display:inline}}#different-toggle:checked~.grid .case[data-different="false"]{{display:none}}@media(max-width:760px){{.binary-head,.binary-grid{{grid-template-columns:1fr}}.metric-row{{grid-template-columns:1fr 1fr}}}}</style>
<section class="legend" aria-label="Methods"><div class="safe"><b>Best Safe · no golden data</b><span>Conservative feature match; falls back to hybrid, then color. No human labels.</span></div><div class="model"><b>Current golden model</b><span>Hybrid candidate accepted by portable logistic gate ≥60%, with normalized movement ≤0.45; otherwise keep current.</span></div></section>
<section aria-labelledby="binary-title"><div class="binary-head"><h2 id="binary-title">Binary decisions</h2><p>All figures are predictions on levels withheld from training. The regeneration classifier is useful for ranking a human review queue; its false positives make automatic regeneration an expensive idea.</p></div><div class="binary-grid"><article class="binary"><h3>Should apply placement?</h3><span class="mode">{html.escape(placement_name)} · threshold {placement_binary['threshold']:.2f} · {placement_binary['samples']} birds</span><div class="metric-row"><div><b>{placement_binary['balancedAccuracy']:.1%}</b><span>balanced accuracy</span></div><div><b>{placement_binary['precision']:.1%}</b><span>precision</span></div><div><b>{placement_binary['recall']:.1%}</b><span>recall</span></div><div><b>{placement_binary['f1']:.1%}</b><span>F1</span></div></div><p class="confusion">TP {placement_binary['tp']} · FP {placement_binary['fp']} · TN {placement_binary['tn']} · FN {placement_binary['fn']} · specificity {placement_binary['specificity']:.1%}</p></article><article class="binary"><h3>Should regenerate?</h3><span class="mode">{html.escape(redo_name)} · threshold {redo_binary['threshold']:.2f} · {redo_binary['samples']} birds</span><div class="metric-row"><div><b>{redo_binary['rocAuc']:.3f}</b><span>ROC-AUC</span></div><div><b>{redo_binary['precision']:.1%}</b><span>precision</span></div><div><b>{redo_binary['recall']:.1%}</b><span>recall</span></div><div><b>{redo_binary['f1']:.1%}</b><span>F1</span></div></div><p class="confusion">TP {redo_binary['tp']} · FP {redo_binary['fp']} · TN {redo_binary['tn']} · FN {redo_binary['fn']} · balanced accuracy {redo_binary['balancedAccuracy']:.1%}</p><p class="warning">Review-ranking only. Do not automatically spend regeneration credits from this boolean.</p></article></div></section>
<input class="filter-toggle" id="different-toggle" type="checkbox"><div class="toolbar"><label class="filter-label" for="different-toggle">Different placements only</label><span class="count-all">98 shown</span><span class="count-diff">20 shown</span></div><section class="grid">{''.join(cards)}</section>
<p class="foot">Corpus order comes from the original 98-level review snapshot. This is a dry comparison: no level placement, sprite, hitbox, or catalog data was changed.</p></main></body></html>'''
    OUTPUT.write_text(document)
    print(json.dumps({"output": str(OUTPUT), "data": str(DATA_OUTPUT), **data["summary"]}, indent=2))


if __name__ == "__main__":
    main()
