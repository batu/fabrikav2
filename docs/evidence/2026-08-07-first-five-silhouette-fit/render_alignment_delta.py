from __future__ import annotations

import base64
import html
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LEVELS = ROOT / "games/find_the_bird/public/levels"


def data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, "JPEG", quality=78, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()


def sprite_path(level_id: str, dog: dict) -> Path:
    relative = dog["sprite"]["image"].split(f"levels/{level_id}/", 1)[-1]
    return LEVELS / level_id / relative


def outlined_scene(scene: Image.Image, sprite: Image.Image, box: dict, crop_box: tuple[int, int, int, int], color: tuple[int, int, int]) -> Image.Image:
    crop = scene.crop(crop_box).convert("RGBA")
    width, height = box["width"], box["height"]
    alpha = sprite.getchannel("A").resize((width, height), Image.Resampling.NEAREST)
    expanded = alpha.filter(ImageFilter.MaxFilter(9))
    outline = Image.new("L", alpha.size)
    outline.point(lambda _: 0)
    # Keep a strong external contour and a faint body tint.
    contour = Image.eval(expanded, lambda p: p)
    contour_data = bytes(max(0, a - b) for a, b in zip(contour.tobytes(), alpha.tobytes()))
    contour.frombytes(contour_data)
    tint = Image.new("RGBA", alpha.size, (*color, 52))
    tint.putalpha(alpha.point(lambda p: min(70, p)))
    edge = Image.new("RGBA", alpha.size, (*color, 255))
    edge.putalpha(contour)
    px, py = box["x"] - crop_box[0], box["y"] - crop_box[1]
    crop.alpha_composite(tint, (px, py))
    crop.alpha_composite(edge, (px, py))
    draw = ImageDraw.Draw(crop)
    draw.rectangle((px, py, px + width - 1, py + height - 1), outline=(*color, 185), width=2)
    crop.thumbnail((500, 330))
    return crop.convert("RGB")


def comparison(level_id: str, dog_id: str, before: dict, after: dict) -> Image.Image:
    level_dir = LEVELS / level_id
    level = json.loads((level_dir / "level.json").read_text())
    dog = next(item for item in level["dogs"] if item["id"] == dog_id)
    scene = Image.open(level_dir / "color.png").convert("RGB")
    sprite = Image.open(sprite_path(level_id, dog)).convert("RGBA")
    x0 = min(before["x"], after["x"])
    y0 = min(before["y"], after["y"])
    x1 = max(before["x"] + before["width"], after["x"] + after["width"])
    y1 = max(before["y"] + before["height"], after["y"] + after["height"])
    pad = max(45, int(max(x1 - x0, y1 - y0) * 0.3))
    crop_box = (max(0, x0 - pad), max(0, y0 - pad), min(scene.width, x1 + pad), min(scene.height, y1 + pad))
    old = outlined_scene(scene, sprite, before, crop_box, (255, 72, 94))
    new = outlined_scene(scene, sprite, after, crop_box, (76, 235, 147))
    panel = Image.new("RGB", (1000, 365), "#0b0c10")
    panel.paste(old, ((500 - old.width) // 2, 35 + (330 - old.height) // 2))
    panel.paste(new, (500 + (500 - new.width) // 2, 35 + (330 - new.height) // 2))
    draw = ImageDraw.Draw(panel)
    draw.text((16, 10), "BEFORE", fill=(255, 123, 136))
    draw.text((516, 10), "AFTER", fill=(128, 232, 165))
    return panel


audit = json.loads((HERE / "applied-fits.json").read_text())
changes = audit["changes"]
cards = []
for change in changes:
    image = comparison(change["levelId"], change["dogId"], change["before"], change["after"])
    before, after = change["before"], change["after"]
    delta = f"x {after['x']-before['x']:+d}, y {after['y']-before['y']:+d}, size {before['width']}×{before['height']} → {after['width']}×{after['height']}"
    cards.append(f"""<article class="card" data-level="{html.escape(change['levelId'])}">
      <img src="{data_url(image)}" alt="Before and after alignment for {html.escape(change['dogId'])}">
      <div class="body"><div class="level">{html.escape(change['levelId'])}</div><h2>{html.escape(change['dogId'])}<span>{change['score']:.3f}</span></h2><p>{html.escape(delta)}</p></div>
    </article>""")

counts: dict[str, int] = {}
for change in changes:
    counts[change["levelId"]] = counts.get(change["levelId"], 0) + 1
filters = ''.join(f'<button data-filter="{html.escape(level)}">{html.escape(level)} <b>{count}</b></button>' for level, count in counts.items())

document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Applied silhouette alignment delta</title>
<style>:root{{--bg:#0c0d11;--panel:#17191f;--line:#30343e;--ink:#f5f2ea;--muted:#aaa9a3;--red:#ff7b88;--green:#80e8a5;--accent:#ff4fd8}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 ui-sans-serif,system-ui;padding:48px}}main{{max-width:1240px;margin:auto}}.eyebrow,.level{{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;overflow-wrap:anywhere}}h1{{font-size:clamp(42px,7vw,76px);line-height:.96;margin:12px 0 20px;max-width:950px}}.lede{{font-size:20px;color:var(--muted);max-width:820px}}.legend{{display:flex;gap:20px;margin:24px 0 30px;color:var(--muted)}}.before{{color:var(--red)}}.after{{color:var(--green)}}.filters{{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}}button{{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:9px 13px;cursor:pointer}}button.active{{border-color:var(--accent)}}button b{{color:var(--green)}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}.card{{border:1px solid var(--line);border-radius:18px;background:var(--panel);overflow:hidden}}.card img{{width:100%;height:250px;object-fit:contain;background:#08090c;display:block}}.body{{padding:16px}}h2{{font-size:23px;margin:5px 0}}h2 span{{float:right;color:var(--green);font-variant-numeric:tabular-nums}}p{{margin:0;color:var(--muted);font-family:ui-monospace,monospace;font-size:12px}}.note{{margin:38px 0;padding:20px;border-left:3px solid var(--green);background:var(--panel)}}@media(max-width:720px){{body{{padding:24px}}.grid{{grid-template-columns:1fr}}}}</style></head><body><main>
<div class="eyebrow">Find the Bird · first five bundled levels · 7 August 2026</div><h1>These are the 82 transforms that were applied.</h1><p class="lede">Each card keeps the painted scene fixed and draws the pickup cutout’s silhouette over it. The left panel is the original level geometry; the right panel is the fitted position and uniform scale now stored in the level.</p>
<div class="legend"><b class="before">Red = before</b><b class="after">Green = after</b><span>16 outliers were excluded and are not shown here.</span></div>
<div class="filters"><button class="active" data-filter="all">All <b>82</b></button>{filters}</div><section class="grid">{''.join(cards)}</section>
<div class="note"><strong>What changed:</strong> sprite x/y/width/height and anchor coordinates only. Cutout pixels, painted scenes, cleanup regions, and human hitboxes were not regenerated. Fits that failed score or hitbox safety stayed untouched.</div>
</main><script>for(const b of document.querySelectorAll('button'))b.onclick=()=>{{document.querySelectorAll('button').forEach(x=>x.classList.remove('active'));b.classList.add('active');const f=b.dataset.filter;document.querySelectorAll('.card').forEach(c=>c.hidden=f!=='all'&&c.dataset.level!==f)}};</script></body></html>"""
(HERE / "alignment-delta-report.html").write_text(document)
print(HERE / "alignment-delta-report.html")
