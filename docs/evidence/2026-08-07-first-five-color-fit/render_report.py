from __future__ import annotations

import base64
import html
import io
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


HERE = Path(os.environ.get("REPORT_DIR", Path(__file__).resolve().parent))
ROOT = HERE.parents[2]
LEVELS = ROOT / "games/find_the_bird/public/levels"
ALIGNMENT_KEY = os.environ.get("ALIGNMENT_KEY", "colorAlignment")
MODE = os.environ.get("REPORT_MODE", "color")
OUTPUT_NAME = os.environ.get("OUTPUT_NAME", "color-alignment-report.html")


def data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, "JPEG", quality=78, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()


def overlay(scene: Image.Image, sprite: Image.Image, box: list[int], crop_box: tuple[int, int, int, int], color: tuple[int, int, int]) -> Image.Image:
    crop = scene.crop(crop_box).convert("RGBA")
    x0, y0, x1, y1 = box
    alpha = sprite.getchannel("A").resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    expanded = alpha.filter(ImageFilter.MaxFilter(9))
    contour = Image.new("L", alpha.size)
    contour.frombytes(bytes(max(0, a - b) for a, b in zip(expanded.tobytes(), alpha.tobytes())))
    tint = Image.new("RGBA", alpha.size, (*color, 52)); tint.putalpha(alpha.point(lambda p: min(70, p)))
    edge = Image.new("RGBA", alpha.size, (*color, 255)); edge.putalpha(contour)
    px, py = x0 - crop_box[0], y0 - crop_box[1]
    crop.alpha_composite(tint, (px, py)); crop.alpha_composite(edge, (px, py))
    ImageDraw.Draw(crop).rectangle((px, py, px + x1 - x0 - 1, py + y1 - y0 - 1), outline=(*color, 185), width=2)
    crop.thumbnail((500, 330))
    return crop.convert("RGB")


def comparison(level_id: str, dog: dict, current: list[int], proposed: list[int]) -> Image.Image:
    level_dir = LEVELS / level_id
    scene = Image.open(level_dir / "color.png").convert("RGB")
    rel = dog["sprite"]["image"].split(f"levels/{level_id}/", 1)[-1]
    sprite = Image.open(level_dir / rel).convert("RGBA")
    x0 = min(current[0], proposed[0]); y0 = min(current[1], proposed[1])
    x1 = max(current[2], proposed[2]); y1 = max(current[3], proposed[3])
    pad = max(45, int(max(x1 - x0, y1 - y0) * .3))
    crop_box = (max(0, x0 - pad), max(0, y0 - pad), min(scene.width, x1 + pad), min(scene.height, y1 + pad))
    old = overlay(scene, sprite, current, crop_box, (255, 72, 94))
    new = overlay(scene, sprite, proposed, crop_box, (76, 235, 147))
    panel = Image.new("RGB", (1000, 365), "#0b0c10")
    panel.paste(old, ((500 - old.width) // 2, 35 + (330 - old.height) // 2))
    panel.paste(new, (500 + (500 - new.width) // 2, 35 + (330 - new.height) // 2))
    right_label = "HYBRID PROPOSAL" if MODE == "hybrid" else "COLOR PROPOSAL"
    draw = ImageDraw.Draw(panel); draw.text((16, 10), "CURRENT SILHOUETTE FIT", fill=(255, 123, 136)); draw.text((516, 10), right_label, fill=(128, 232, 165))
    return panel


report = json.loads((HERE / "report.json").read_text())
cards, counts, unsafe_count = [], {}, 0
for level_report in report["levels"]:
    level_id = level_report["levelId"]
    level = json.loads((LEVELS / level_id / "level.json").read_text())
    dogs = {dog["id"]: dog for dog in level["dogs"]}
    counts[level_id] = len(level_report["birds"])
    for bird in level_report["birds"]:
        dog = dogs[bird["dogId"]]; fit = bird[ALIGNMENT_KEY]
        current, proposed = fit["originalBox"], fit["fittedBox"]
        sprite_meta = dog["sprite"]
        target_x = round(sprite_meta["x"] + float(sprite_meta.get("anchorX", .5)) * sprite_meta["width"])
        target_y = round(sprite_meta["y"] + float(sprite_meta.get("anchorY", .5)) * sprite_meta["height"])
        safe = proposed[0] <= target_x <= proposed[2] and proposed[1] <= target_y <= proposed[3]
        unsafe_count += not safe
        image = comparison(level_id, dog, current, proposed)
        size_before = f"{current[2]-current[0]}×{current[3]-current[1]}"; size_after = f"{proposed[2]-proposed[0]}×{proposed[3]-proposed[1]}"
        needs_review = MODE == "hybrid" and float(fit["score"]) < .42
        badge = ('<em class="unsafe">HITBOX UNSAFE</em>' if not safe else
                 '<em class="unsafe">LOW CONFIDENCE · VISUAL REVIEW</em>' if needs_review else
                 '<em>PROPOSAL ONLY</em>')
        cards.append(f"""<article class="card" data-level="{html.escape(level_id)}"><img src="{data_url(image)}" alt="Current silhouette and color proposal for {html.escape(bird['dogId'])}"><div class="body"><div class="level">{html.escape(level_id)}</div><h2>{html.escape(bird['dogId'])}<span>{fit['score']:.3f}</span></h2><p>x {fit['dx']:+d}, y {fit['dy']:+d}, size {size_before} → {size_after}</p>{badge}</div></article>""")

filters = ''.join(f'<button data-filter="{html.escape(level)}">{html.escape(level)} <b>{count}</b></button>' for level, count in counts.items())
report_title = "Hybrid color + silhouette proposals" if MODE == "hybrid" else "Color-aware alignment proposals"
report_description = ("Green combines perceptual color, silhouette overlap, edge alignment, a scale prior, and a hard hitbox constraint." if MODE == "hybrid" else "Green shows where RGB matching would place the same cutout.")
method_note = ("Hybrid score: 45% color, 35% silhouette, 15% edge, 5% scale prior. Scale is limited to ±10%; hitbox containment is mandatory." if MODE == "hybrid" else "Color score is normalized RGB similarity inside the cutout alpha mask.")
document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{report_title}</title><style>
:root{{--bg:#0c0d11;--panel:#17191f;--line:#30343e;--ink:#f5f2ea;--muted:#aaa9a3;--red:#ff7b88;--green:#80e8a5;--accent:#ff4fd8}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 ui-sans-serif,system-ui;padding:48px}}main{{max-width:1240px;margin:auto}}.eyebrow,.level{{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;overflow-wrap:anywhere}}h1{{font-size:clamp(42px,7vw,76px);line-height:.96;margin:12px 0 20px;max-width:1000px}}.lede{{font-size:20px;color:var(--muted);max-width:860px}}.legend{{display:flex;gap:20px;margin:24px 0 30px;color:var(--muted)}}.red{{color:var(--red)}}.green{{color:var(--green)}}.filters{{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}}button{{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:9px 13px;cursor:pointer}}button.active{{border-color:var(--accent)}}button b{{color:var(--green)}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}.card{{border:1px solid var(--line);border-radius:18px;background:var(--panel);overflow:hidden}}.card img{{width:100%;height:250px;object-fit:contain;background:#08090c;display:block}}.body{{padding:16px}}h2{{font-size:23px;margin:5px 0}}h2 span{{float:right;color:var(--green)}}p{{margin:0 0 8px;color:var(--muted);font:12px ui-monospace,monospace}}em{{font-style:normal;font-size:10px;color:var(--muted)}}em.unsafe{{color:var(--red);font-weight:800}}.note{{margin:38px 0;padding:20px;border-left:3px solid var(--green);background:var(--panel)}}@media(max-width:720px){{body{{padding:24px}}.grid{{grid-template-columns:1fr}}}}</style></head><body><main>
<div class="eyebrow">Find the Bird · {MODE}-match experiment · 7 August 2026</div><h1>{report_title} beside the current fit.</h1><p class="lede">The scene is fixed. Red shows the currently stored silhouette placement. {report_description} Nothing in this report has been applied to the levels.</p><div class="legend"><b class="red">Red = current</b><b class="green">Green = {MODE} proposal</b><span>{unsafe_count} proposals fail hitbox safety.</span></div><div class="filters"><button class="active" data-filter="all">All <b>98</b></button>{filters}</div><section class="grid">{''.join(cards)}</section><div class="note"><strong>Experiment status:</strong> read-only. {method_note} Apply only after visual review; proxy scores remain perfectly capable of lying with confidence.</div></main><script>for(const b of document.querySelectorAll('button'))b.onclick=()=>{{document.querySelectorAll('button').forEach(x=>x.classList.remove('active'));b.classList.add('active');const f=b.dataset.filter;document.querySelectorAll('.card').forEach(c=>c.hidden=f!=='all'&&c.dataset.level!==f)}};</script></body></html>"""
(HERE / OUTPUT_NAME).write_text(document)
print(HERE / OUTPUT_NAME, unsafe_count)
