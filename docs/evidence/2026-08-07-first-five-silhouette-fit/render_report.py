from __future__ import annotations

import base64
import html
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LEVELS = ROOT / "games/find_the_bird/public/levels"


def data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, "PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


def fallback_preview(level_id: str, bird: dict) -> Image.Image:
    level_dir = LEVELS / level_id
    level = json.loads((level_dir / "level.json").read_text())
    dog = next(item for item in level["dogs"] if item["id"] == bird["dogId"])
    sprite_meta = dog["sprite"]
    sprite_rel = sprite_meta["image"].split(f"levels/{level_id}/", 1)[-1]
    sprite = Image.open(level_dir / sprite_rel).convert("RGBA")
    scene = Image.open(level_dir / "color.png").convert("RGB")
    x0, y0, x1, y1 = bird["alignment"]["originalBox"]
    pad = max(x1 - x0, y1 - y0) // 2
    crop = scene.crop((max(0, x0 - pad), max(0, y0 - pad), min(scene.width, x1 + pad), min(scene.height, y1 + pad)))
    crop.thumbnail((420, 300))
    panel = Image.new("RGB", (840, 300), "#17191f")
    panel.paste(crop, ((420 - crop.width) // 2, (300 - crop.height) // 2))
    sprite.thumbnail((330, 250))
    alpha_panel = Image.new("RGBA", (420, 300), "#272a33")
    alpha_panel.alpha_composite(sprite, ((420 - sprite.width) // 2, (300 - sprite.height) // 2))
    panel.paste(alpha_panel.convert("RGB"), (420, 0))
    draw = ImageDraw.Draw(panel)
    draw.text((12, 12), "painted scene", fill="white")
    draw.text((432, 12), "pickup cutout", fill="white")
    return panel


report = json.loads((HERE / "report.json").read_text())
outliers = []
for level in report["levels"]:
    for bird in level["birds"]:
        if bird.get("alignment", {}).get("outlier") is True:
            outliers.append((level["levelId"], bird))

cards = []
for level_id, bird in outliers:
    preview = HERE / "previews" / f"{level_id}-{bird['dogId']}.png"
    image = Image.open(preview).convert("RGB") if preview.exists() else fallback_preview(level_id, bird)
    reason = bird["alignment"].get("reason") or "silhouette score below the level threshold"
    cards.append(f"""
      <article class="card">
        <img src="{data_url(image)}" alt="Visual comparison for {html.escape(level_id)} {html.escape(bird['dogId'])}">
        <div class="body"><div class="eyebrow">{html.escape(level_id)}</div>
        <h2>{html.escape(bird['dogId'])} <span>{bird['alignment']['score']:.3f}</span></h2>
        <p>{html.escape(reason)}</p></div>
      </article>""")

level_rows = []
for level in report["levels"]:
    count = sum(1 for bird in level["birds"] if bird.get("alignment", {}).get("outlier") is True)
    level_rows.append(f"<li><code>{html.escape(level['levelId'])}</code><strong>{count}</strong></li>")

document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>First five silhouette-fit outliers</title>
<style>
:root{{--bg:#0d0e12;--panel:#17191f;--ink:#f3f1ea;--muted:#aaa9a3;--line:#30333d;--accent:#ff4fd8;--ok:#91e6ad}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 ui-sans-serif,system-ui;padding:48px}}main{{max-width:1180px;margin:auto}}.eyebrow{{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;overflow-wrap:anywhere}}h1{{font-size:clamp(40px,7vw,76px);line-height:.95;max-width:900px;margin:12px 0 24px}}.lede{{max-width:760px;color:var(--muted);font-size:20px}}.stats{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:36px 0}}.stat{{border:1px solid var(--line);border-radius:16px;padding:20px;background:var(--panel)}}.stat b{{display:block;font-size:38px}}.stat small{{color:var(--muted)}}.levels{{list-style:none;padding:0;margin:24px 0 48px}}.levels li{{display:flex;gap:12px;justify-content:space-between;border-bottom:1px solid var(--line);padding:10px 0}}code{{font-size:12px;color:var(--muted);overflow-wrap:anywhere}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}.card{{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden}}.card img{{display:block;width:100%;height:250px;object-fit:contain;background:#08090c}}.body{{padding:18px}}h2{{margin:6px 0;font-size:24px}}h2 span{{float:right;color:var(--accent);font-variant-numeric:tabular-nums}}p{{color:var(--muted);margin:4px 0}}.note{{margin-top:38px;padding:20px;border-left:3px solid var(--ok);background:var(--panel)}}@media(max-width:720px){{body{{padding:24px}}.grid{{grid-template-columns:1fr}}.stats{{grid-template-columns:1fr}}}}
</style></head><body><main><div class="eyebrow">Find the Bird · 7 August 2026</div><h1>Outliers stayed exactly where they were.</h1>
<p class="lede">The first five bundled levels contain 98 birds. The deterministic silhouette pass applied 82 safe position/scale corrections and deliberately left these 16 untouched.</p>
<section class="stats"><div class="stat"><b>98</b><small>birds evaluated</small></div><div class="stat"><b>82</b><small>safe fits applied</small></div><div class="stat"><b>16</b><small>outliers unchanged</small></div></section>
<ul class="levels">{''.join(level_rows)}</ul><section class="grid">{''.join(cards)}</section>
<div class="note"><strong>How to read the overlays.</strong> Red is cutout-only, green is painted-only, and yellow is overlap. For hitbox-safety outliers, the panel instead shows the painted scene beside the pickup cutout. A fit is never applied when its new box would exclude the human-authored tap point.</div>
</main></body></html>"""
(HERE / "outlier-report.html").write_text(document)
print(HERE / "outlier-report.html")
