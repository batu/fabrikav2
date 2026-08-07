from __future__ import annotations

import base64
import html
import io
import json
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageOps


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LEVELS = ROOT / "games/find_the_bird/public/levels"
MANIFEST = HERE / "golden-cutout-placement-v1/manifest.json"
RESULTS = HERE / "results/golden-cutout-v1"
OUTPUT = ROOT / "docs/reports/2026-08-08-ftb-golden-cutout-model-report.html"
CONTACT_SHEET = ROOT / "docs/evidence/2026-08-08-ftb-golden-cutout-model/failure-contact-sheet.png"

GREEN = (51, 132, 86)
CYAN = (44, 128, 166)
AMBER = (196, 128, 41)
RED = (176, 61, 53)


def image_data_url(image: Image.Image, *, format: str = "JPEG") -> str:
    output = io.BytesIO()
    if format == "JPEG":
        image.convert("RGB").save(output, format, quality=82, optimize=True)
        mime = "image/jpeg"
    else:
        image.save(output, format, optimize=True)
        mime = "image/png"
    return f"data:{mime};base64," + base64.b64encode(output.getvalue()).decode()


def git_image(commit: str, relative_path: str) -> Image.Image:
    result = subprocess.run(
        ["git", "show", f"{commit}:{relative_path}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return Image.open(io.BytesIO(result.stdout)).convert("RGBA")


def crop_bounds(boxes: list[list[int]], scene: Image.Image) -> tuple[int, int, int, int]:
    x0 = min(box[0] for box in boxes)
    y0 = min(box[1] for box in boxes)
    x1 = max(box[2] for box in boxes)
    y1 = max(box[3] for box in boxes)
    pad = max(36, round(max(x1 - x0, y1 - y0) * 0.45))
    return max(0, x0 - pad), max(0, y0 - pad), min(scene.width, x1 + pad), min(scene.height, y1 + pad)


def overlay_panel(
    scene: Image.Image,
    sprite: Image.Image,
    box: list[int],
    crop: tuple[int, int, int, int],
    color: tuple[int, int, int],
    label: str,
) -> Image.Image:
    panel = scene.crop(crop).convert("RGBA")
    x0, y0, x1, y1 = box
    width, height = max(1, x1 - x0), max(1, y1 - y0)
    alpha = sprite.getchannel("A").resize((width, height), Image.Resampling.LANCZOS)
    expanded = alpha.filter(ImageFilter.MaxFilter(7))
    contour = Image.frombytes(
        "L",
        alpha.size,
        bytes(max(0, outside - inside) for outside, inside in zip(expanded.tobytes(), alpha.tobytes(), strict=True)),
    )
    tint = Image.new("RGBA", alpha.size, (*color, 70))
    tint.putalpha(alpha.point(lambda value: min(82, value)))
    edge = Image.new("RGBA", alpha.size, (*color, 255))
    edge.putalpha(contour)
    px, py = x0 - crop[0], y0 - crop[1]
    panel.alpha_composite(tint, (px, py))
    panel.alpha_composite(edge, (px, py))
    draw = ImageDraw.Draw(panel)
    draw.rectangle((px, py, px + width - 1, py + height - 1), outline=(*color, 235), width=3)
    draw.rounded_rectangle((9, 9, 9 + max(94, len(label) * 8), 36), radius=5, fill=(20, 24, 22, 220))
    draw.text((17, 16), label, fill=(*color, 255))
    panel.thumbnail((420, 310), Image.Resampling.LANCZOS)
    return panel.convert("RGB")


def placement_visual(row: dict[str, Any], predicted: list[int], probability: float) -> Image.Image:
    level_dir = LEVELS / row["levelId"]
    scene = Image.open(level_dir / "color.png").convert("RGB")
    sprite = Image.open(level_dir / row["sprite"]).convert("RGBA")
    boxes = [row["initialBox"], predicted, row["targetBox"]]
    crop = crop_bounds(boxes, scene)
    panels = [
        overlay_panel(scene, sprite, boxes[0], crop, AMBER, "MACHINE BEFORE"),
        overlay_panel(scene, sprite, boxes[1], crop, CYAN, f"MODEL {probability:.0%}"),
        overlay_panel(scene, sprite, boxes[2], crop, GREEN, "HUMAN TARGET"),
    ]
    height = max(panel.height for panel in panels)
    canvas = Image.new("RGB", (sum(panel.width for panel in panels), height), "#ebe8df")
    x = 0
    for panel in panels:
        canvas.paste(panel, (x, (height - panel.height) // 2))
        x += panel.width
    return canvas


def checkerboard(size: tuple[int, int]) -> Image.Image:
    width, height = size
    result = Image.new("RGB", size, "#f1eee5")
    draw = ImageDraw.Draw(result)
    square = 18
    for y in range(0, height, square):
        for x in range(0, width, square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square, y + square), fill="#dcd8cd")
    return result


def sprite_panel(sprite: Image.Image, label: str, color: tuple[int, int, int]) -> Image.Image:
    sprite = sprite.copy()
    sprite.thumbnail((270, 245), Image.Resampling.LANCZOS)
    panel = checkerboard((310, 290)).convert("RGBA")
    panel.alpha_composite(sprite, ((310 - sprite.width) // 2, 36 + (245 - sprite.height) // 2))
    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((10, 8, 10 + max(92, len(label) * 8), 34), radius=5, fill=(20, 24, 22, 220))
    draw.text((18, 15), label, fill=(*color, 255))
    return panel.convert("RGB")


def redo_visual(entry: dict[str, Any], probability: float) -> Image.Image:
    level_dir = LEVELS / entry["levelId"]
    current = Image.open(level_dir / entry["sprite"]).convert("RGBA")
    review = entry["reviewInput"]
    if review.get("gitCommit"):
        relative = f"games/find_the_bird/public/levels/{entry['levelId']}/{review['sprite']}"
        before = git_image(review["gitCommit"], relative)
        before_label = "REJECTED INPUT"
        before_color = RED
    else:
        before = current.copy()
        before_label = "APPROVED INPUT"
        before_color = GREEN
    scene = Image.open(level_dir / "color.png").convert("RGB")
    crop = crop_bounds([review["spriteBox"], entry["targetBox"]], scene)
    scene_panel = overlay_panel(scene, before, review["spriteBox"], crop, before_color, f"MODEL {probability:.0%}")
    scene_panel = ImageOps.fit(scene_panel, (420, 290), method=Image.Resampling.LANCZOS)
    panels = [sprite_panel(before, before_label, before_color), sprite_panel(current, "APPROVED FINAL", GREEN), scene_panel]
    canvas = Image.new("RGB", (1040, 290), "#ebe8df")
    x = 0
    for panel in panels:
        canvas.paste(panel, (x, 0))
        x += panel.width
    return canvas


def metric(value: float, digits: int = 3) -> str:
    return f"{value:.{digits}f}"


manifest = json.loads(MANIFEST.read_text())
placement = json.loads((RESULTS / "placement-evaluation.json").read_text())
redo = json.loads((RESULTS / "redo-evaluation.json").read_text())

approved = {(entry["levelId"], entry["dogId"]): entry for entry in manifest["approved"]}
placement_rows = {(row["levelId"], row["dogId"]): row for row in placement["rows"]}
placement_predictions = {
    (row["levelId"], row["dogId"]): row
    for row in placement["learnedSelectors"][placement["recommendedProduction"]]["predictions"]
}
redo_predictions = {
    (row["levelId"], row["dogId"]): row for row in redo["models"][redo["winner"]]["predictions"]
}


def placement_delta(key: tuple[str, str]) -> float:
    row = placement_rows[key]
    prediction = placement_predictions[key]
    selected = row["hybridMetrics"] if prediction["applied"] else row["baselineMetrics"]
    return row["baselineMetrics"]["loss"] - selected["loss"]


correction_wins = sorted(
    (key for key, row in placement_rows.items() if row["trialType"] == "correction" and placement_delta(key) > 0),
    key=placement_delta,
    reverse=True,
)[:3]
keep_regressions = sorted(
    (key for key, row in placement_rows.items() if row["trialType"] == "keep" and placement_predictions[key]["applied"]),
    key=placement_delta,
)[:3]
missed_corrections = sorted(
    (
        key
        for key, row in placement_rows.items()
        if row["trialType"] == "correction" and not placement_predictions[key]["applied"]
    ),
    key=lambda key: placement_rows[key]["baselineMetrics"]["loss"],
    reverse=True,
)[:3]

redo_false_negatives = sorted(
    (key for key, row in redo_predictions.items() if row["actual"] and not row["predicted"]),
    key=lambda key: redo_predictions[key]["probability"],
)
redo_false_positives = sorted(
    (key for key, row in redo_predictions.items() if not row["actual"] and row["predicted"]),
    key=lambda key: redo_predictions[key]["probability"],
    reverse=True,
)[:4]


placement_cards: list[str] = []
contact_images: list[Image.Image] = []
for category, title, keys in (
    ("success", "Recovered correction", correction_wins),
    ("regression", "Moved an approved keep", keep_regressions),
    ("miss", "Missed correction", missed_corrections),
):
    for key in keys:
        row = placement_rows[key]
        prediction = placement_predictions[key]
        fitted = row["hybridPrediction"] if prediction["applied"] else row["initialPrediction"]
        visual = placement_visual(row, fitted, prediction["probability"])
        contact_images.append(visual)
        selected_metrics = row["hybridMetrics"] if prediction["applied"] else row["baselineMetrics"]
        placement_cards.append(
            f'''<article class="case" data-kind="placement {category}">
              <img src="{image_data_url(visual)}" alt="Placement comparison for {html.escape(key[0])} {key[1]}">
              <div class="case-copy"><span class="eyebrow {category}">{title}</span>
              <h3>{html.escape(key[1])} <small>{html.escape(key[0])}</small></h3>
              <p>Gate {prediction['probability']:.0%} · initial IoU {row['baselineMetrics']['iou']:.3f} · selected IoU {selected_metrics['iou']:.3f} · center {selected_metrics['centerPx']:.1f}px</p></div>
            </article>'''
        )

redo_cards: list[str] = []
for category, title, keys in (
    ("miss", "Redo the model missed", redo_false_negatives),
    ("regression", "Approved bird falsely flagged", redo_false_positives),
):
    for key in keys:
        prediction = redo_predictions[key]
        entry = approved[key]
        visual = redo_visual(entry, prediction["probability"])
        contact_images.append(visual)
        redo_cards.append(
            f'''<article class="case" data-kind="redo {category}">
              <img src="{image_data_url(visual)}" alt="Redo comparison for {html.escape(key[0])} {key[1]}">
              <div class="case-copy"><span class="eyebrow {category}">{title}</span>
              <h3>{html.escape(key[1])} <small>{html.escape(key[0])}</small></h3>
              <p>Redo probability {prediction['probability']:.0%} · actual label {'redo' if prediction['actual'] else 'keep'}.</p></div>
            </article>'''
        )

threshold_rows = []
redo_rows = list(redo_predictions.values())
for threshold in (0.50, 0.65, 0.75, 0.80, 0.90, 0.95):
    tp = sum(row["actual"] and row["probability"] >= threshold for row in redo_rows)
    fp = sum(not row["actual"] and row["probability"] >= threshold for row in redo_rows)
    fn = sum(row["actual"] and row["probability"] < threshold for row in redo_rows)
    precision = tp / (tp + fp) if tp + fp else 0
    recall = tp / (tp + fn) if tp + fn else 0
    threshold_rows.append(
        f"<tr><td>{threshold:.2f}</td><td>{tp}</td><td>{fp}</td><td>{fn}</td><td>{precision:.0%}</td><td>{recall:.0%}</td></tr>"
    )

logistic = placement["learnedSelectors"][placement["recommendedProduction"]]
forest = placement["learnedSelectors"]["forest-hybrid"]
baseline = placement["baseline"]
redo_metrics = redo["models"][redo["winner"]]
improvement = 1 - logistic["balancedLoss"] / baseline["balancedLoss"]

level_rows = "".join(
    f"<tr><td>{html.escape(row['levelId'])}</td><td>{row['approvedBirds']}</td><td>{row['correctedBirds']}</td><td>{row['keepBirds']}</td></tr>"
    for row in manifest["reviewedLevels"]
)

document = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Find the Bird — Golden Cutout Model Report</title>
<style>
:root{{--paper:#f3f0e7;--ink:#20251f;--muted:#697067;--line:#cbc7bb;--green:#338456;--green-soft:#dbe9dd;--red:#b03d35;--red-soft:#f1dcd8;--cyan:#2c80a6;--amber:#c48029;--panel:#fbfaf5}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 "Iowan Old Style","Palatino Linotype",Georgia,serif}}main{{width:min(1260px,calc(100% - 32px));margin:auto;padding:34px 0 96px}}code,.mono,table,.eyebrow,.controls{{font-family:"SFMono-Regular",Consolas,monospace}}.mast{{border-top:7px solid var(--ink);padding:22px 0 34px;display:grid;grid-template-columns:1.4fr .6fr;gap:32px;align-items:end}}h1{{font-size:clamp(42px,7vw,92px);line-height:.92;letter-spacing:-.055em;margin:8px 0 20px;max-width:920px}}h2{{font-size:clamp(28px,4vw,48px);letter-spacing:-.035em;margin:0 0 16px}}h3{{font-size:21px;line-height:1.12;margin:6px 0}}h3 small{{display:block;color:var(--muted);font:11px/1.4 "SFMono-Regular",Consolas,monospace;word-break:break-all;margin-top:6px}}p{{margin:0 0 12px}}.dek{{font-size:clamp(20px,2.3vw,29px);line-height:1.28;max-width:850px}}.stamp{{border-left:1px solid var(--line);padding-left:24px;color:var(--muted)}}.stamp b{{display:block;color:var(--ink);font-size:25px}}.verdict{{background:var(--ink);color:#f8f6ef;padding:28px;border-radius:3px;display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:26px}}.verdict strong{{color:#9ae3b4}}.verdict .warn strong{{color:#ffb7ad}}.metrics{{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);background:var(--panel);margin-bottom:72px}}.metric{{padding:22px;border-right:1px solid var(--line)}}.metric:last-child{{border:0}}.metric b{{font-size:35px;display:block;line-height:1}}.metric span{{color:var(--muted);font-family:"SFMono-Regular",Consolas,monospace;font-size:11px}}section{{border-top:1px solid var(--line);padding-top:30px;margin-top:66px}}.section-head{{display:grid;grid-template-columns:.75fr 1.25fr;gap:38px;margin-bottom:28px}}.section-head p{{font-size:19px;color:var(--muted)}}.controls{{position:sticky;top:8px;z-index:3;background:#f3f0e7ed;backdrop-filter:blur(10px);padding:10px 0;display:flex;gap:8px;border-bottom:1px solid var(--line);margin-bottom:20px;font-size:12px}}.controls input{{position:absolute;opacity:0;pointer-events:none}}.controls span{{display:block;border:1px solid var(--line);background:var(--panel);padding:8px 12px;cursor:pointer;color:var(--ink)}}.controls input:checked+span{{background:var(--ink);color:white;border-color:var(--ink)}}.controls:has(#filter-success:checked)+.case-grid .case:not([data-kind~="success"]),.controls:has(#filter-miss:checked)+.case-grid .case:not([data-kind~="miss"]),.controls:has(#filter-regression:checked)+.case-grid .case:not([data-kind~="regression"]){{display:none}}.case-grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}.case{{background:var(--panel);border:1px solid var(--line);min-width:0}}.case img{{display:block;width:100%;aspect-ratio:3.35/1;object-fit:cover;background:#e5e1d7}}.case-copy{{padding:16px}}.case-copy p{{font-family:"SFMono-Regular",Consolas,monospace;font-size:12px;color:var(--muted)}}.eyebrow{{text-transform:uppercase;letter-spacing:.08em;font-size:10px;font-weight:800;color:var(--green)}}.eyebrow.miss,.eyebrow.regression{{color:var(--red)}}.eyebrow.success{{color:var(--green)}}.method-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}}.method{{background:var(--panel);border:1px solid var(--line);padding:20px}}.method.recommended{{border-top:5px solid var(--green)}}.method.best{{border-top:5px solid var(--cyan)}}.method h3 small{{font:inherit;color:inherit;display:inline}}table{{border-collapse:collapse;width:100%;background:var(--panel);font-size:12px}}th,td{{padding:10px 12px;border-bottom:1px solid var(--line);text-align:right}}th:first-child,td:first-child{{text-align:left}}details{{background:var(--panel);border:1px solid var(--line);margin-top:12px;padding:14px 18px}}summary{{cursor:pointer;font-weight:bold}}.callout{{border-left:5px solid var(--amber);padding:18px 22px;background:#efe5d1;margin:24px 0}}.command{{background:#20251f;color:#f8f6ef;padding:16px;overflow:auto;font:12px/1.7 "SFMono-Regular",Consolas,monospace}}.footer{{color:var(--muted);font-size:13px}}@media(max-width:850px){{.mast,.verdict,.section-head{{grid-template-columns:1fr}}.metrics{{grid-template-columns:1fr 1fr}}.metric:nth-child(2){{border-right:0}}.case-grid,.method-grid{{grid-template-columns:1fr}}}}@media(prefers-reduced-motion:reduce){{html{{scroll-behavior:auto}}}}
</style></head><body><main>
<header class="mast"><div><span class="eyebrow">Find the Bird · 08 August 2026</span><h1>Golden cutout model report</h1><p class="dek">Nine fully reviewed levels are enough to improve placement and build a useful redo queue. They are not enough to let either model operate without guardrails.</p></div><div class="stamp"><span>Corpus</span><b>162 approved birds</b><span>9 held-out level folds<br>35 corrections · 126 keeps<br>27 redos · 132 no-redos</span></div></header>

<div class="verdict"><div><span class="eyebrow">Placement</span><p><strong>Ship behind the CLI gate.</strong> The portable logistic selector cuts balanced placement loss by {improvement:.1%}, halves correction center error, and leaves approved keeps close to their human positions.</p></div><div class="warn"><span class="eyebrow">Redo prediction</span><p><strong>Review queue only.</strong> Recall is useful, but 18 of 42 flags are false positives at the normal threshold. It must not automatically spend regeneration credits.</p></div></div>
<div class="metrics"><div class="metric"><b>{baseline['balancedLoss']:.3f}</b><span>baseline balanced loss</span></div><div class="metric"><b>{logistic['balancedLoss']:.3f}</b><span>portable model loss</span></div><div class="metric"><b>{logistic['corrections']['centerPx']:.1f}px</b><span>correction center error</span></div><div class="metric"><b>{redo_metrics['rocAuc']:.3f}</b><span>redo ranking ROC-AUC</span></div></div>

<section id="placement"><div class="section-head"><h2>Placement: a guarded improvement</h2><p>The matcher still generates the candidate box. A level-held-out logistic model decides whether applying that candidate is safer than retaining the current box. This is the important part: keeps are training examples too.</p></div>
<div class="method-grid"><article class="method"><span class="eyebrow">Do nothing</span><h3>Current box</h3><p>Perfect on keeps by definition, but only {baseline['corrections']['iou']:.3f} IoU and {baseline['corrections']['centerPx']:.1f}px center error on human corrections.</p></article><article class="method recommended"><span class="eyebrow">Recommended production · best held-out</span><h3>Safe logistic + hybrid</h3><p>{logistic['corrections']['iou']:.3f} correction IoU, {logistic['keeps']['iou']:.3f} keep IoU, a 0.60 gate, and a 0.45 normalized movement cap in portable JSON.</p></article><article class="method best"><span class="eyebrow">Comparison</span><h3>Shallow forest + hybrid</h3><p>{forest['balancedLoss']:.3f} balanced loss versus {logistic['balancedLoss']:.3f}. It is slightly worse, less portable, and lacks the explicit wrong-neighbor movement guard.</p></article></div>
<div class="controls" aria-label="Case filters"><label><input id="filter-all" type="radio" name="case-filter" checked><span>All visual cases</span></label><label><input id="filter-success" type="radio" name="case-filter"><span>Recovered</span></label><label><input id="filter-miss" type="radio" name="case-filter"><span>Misses</span></label><label><input id="filter-regression" type="radio" name="case-filter"><span>Regressions</span></label></div><div class="case-grid">{''.join(placement_cards)}</div></section>

<section id="redo"><div class="section-head"><h2>Redo: good ranking, bad autopilot</h2><p>The positive label means <em>extract the cutout again</em>. It does not mean repaint the scene, and it does not mean regenerate the bird. The reviewed corpus contains zero full-scene regeneration positives.</p></div>
<div class="metrics"><div class="metric"><b>{redo_metrics['recall']:.0%}</b><span>recall at 0.50</span></div><div class="metric"><b>{redo_metrics['precision']:.0%}</b><span>precision at 0.50</span></div><div class="metric"><b>{redo_metrics['averagePrecision']:.3f}</b><span>average precision</span></div><div class="metric"><b>3</b><span>known redos missed</span></div></div>
<table><thead><tr><th>Threshold</th><th>True flags</th><th>False flags</th><th>Missed redos</th><th>Precision</th><th>Recall</th></tr></thead><tbody>{''.join(threshold_rows)}</tbody></table>
<div class="callout"><strong>Recommended operating mode:</strong> sort the focused editor view by redo probability, show the reasons/features, and let a human press Extract. Do not choose a threshold that submits jobs automatically; this dataset does not support one.</div>
<div class="case-grid">{''.join(redo_cards)}</div></section>

<section id="dataset"><div class="section-head"><h2>What is actually in the golden set</h2><p>Every split is by level, never by bird. Rejected inputs are anchored to an immutable Git commit, blob, and SHA-256; approved outputs and scenes are also content-addressed. One corrected bird is retained as approved but excluded from placement fitting because its exact pre-edit box was overwritten.</p></div>
<table><thead><tr><th>Reviewed level</th><th>Birds</th><th>Corrected</th><th>Kept</th></tr></thead><tbody>{level_rows}</tbody></table>
<details><summary>Label boundaries</summary><p><b>Extraction</b> judges sprite pixels. <b>Placement</b> judges sprite transform. <b>Padding</b> judges the crop sent to extraction. <b>Full-scene regeneration</b> replaces painted content. They are different decisions and the manifest prevents them from being quietly collapsed into one bool.</p></details>
<details><summary>Limitations</summary><p>Nine levels are a legitimate hill-climb set, not a final generalization claim. The 35 recoverable corrections are concentrated in a few scenes. Probabilities are useful for ordering, not calibrated enough for billing decisions. Flip metadata is evaluated, but only two flip mismatches occur, so flip learning remains underpowered.</p></details></section>

<section id="reproduce"><div class="section-head"><h2>Reproduce it through the editor CLI</h2><p>All commands are server-free and use the same manifest validation boundary. The model artifacts are portable JSON embedded in the evaluation outputs.</p></div>
<pre class="command">uv run level-editor --json golden-cutouts-validate
uv run level-editor --json golden-cutouts-placement --workers 4 \\
  --out eval/results/golden-cutout-v1/placement-evaluation.json
uv run level-editor --json golden-cutouts-evaluate \\
  --out eval/results/golden-cutout-v1/redo-evaluation.json
uv run pytest tests/test_golden_cutout_dataset.py tests/test_cli_parity.py -q</pre>
<p class="footer">Evaluation: leave-one-level-out. Placement objective: class-balanced mean of translation/scale/flip loss on corrected and kept birds. Redo metrics: out-of-fold predictions only. Report generated from content-addressed corpus and checked-in evaluator outputs.</p></section>
</main></body></html>'''

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(document)

thumbs: list[Image.Image] = []
for image in contact_images:
    thumbs.append(ImageOps.fit(image, (900, 270), method=Image.Resampling.LANCZOS))
sheet = Image.new("RGB", (1800, ((len(thumbs) + 1) // 2) * 270), "#f3f0e7")
for index, image in enumerate(thumbs):
    sheet.paste(image, ((index % 2) * 900, (index // 2) * 270))
CONTACT_SHEET.parent.mkdir(parents=True, exist_ok=True)
sheet.save(CONTACT_SHEET, optimize=True)

print(OUTPUT)
print(CONTACT_SHEET)
