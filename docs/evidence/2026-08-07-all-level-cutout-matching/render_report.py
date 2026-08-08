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
METHODS = (("color", "Color"), ("hybrid", "Hybrid"), ("features", "Features"), ("best", "Best safe"))
COLORS = ((74, 190, 255), (255, 105, 210), (255, 194, 86), (76, 235, 147))
VISUAL_LIMIT = 100


def data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, "JPEG", quality=72, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()


def overlay(scene: Image.Image, sprite: Image.Image, box: list[int], crop: tuple[int, int, int, int], color: tuple[int, int, int]) -> Image.Image:
    panel = scene.crop(crop).convert("RGBA")
    x0, y0, x1, y1 = box
    alpha = sprite.getchannel("A").resize((max(1, x1 - x0), max(1, y1 - y0)), Image.Resampling.LANCZOS)
    expanded = alpha.filter(ImageFilter.MaxFilter(9))
    contour = Image.frombytes("L", alpha.size, bytes(max(0, a - b) for a, b in zip(expanded.tobytes(), alpha.tobytes())))
    tint = Image.new("RGBA", alpha.size, (*color, 52)); tint.putalpha(alpha.point(lambda p: min(70, p)))
    edge = Image.new("RGBA", alpha.size, (*color, 255)); edge.putalpha(contour)
    px, py = x0 - crop[0], y0 - crop[1]
    panel.alpha_composite(tint, (px, py)); panel.alpha_composite(edge, (px, py))
    ImageDraw.Draw(panel).rectangle((px, py, px + x1 - x0 - 1, py + y1 - y0 - 1), outline=(*color, 210), width=2)
    panel.thumbnail((360, 260))
    return panel.convert("RGB")


def comparison(level_id: str, dog: dict, matches: dict[str, dict]) -> Image.Image:
    level_dir = LEVELS / level_id
    scene = Image.open(level_dir / "color.png").convert("RGB")
    rel = dog["sprite"]["image"].split(f"levels/{level_id}/", 1)[-1]
    sprite = Image.open(level_dir / rel).convert("RGBA")
    fallback = list(matches.values())[0].get("originalBox")
    boxes = [
        matches[key].get("fittedBox", fallback)
        if matches[key].get("accepted", matches[key].get("verdict") == "pass")
        else matches[key].get("originalBox", fallback)
        for key, _ in METHODS
    ]
    x0, y0 = min(box[0] for box in boxes), min(box[1] for box in boxes)
    x1, y1 = max(box[2] for box in boxes), max(box[3] for box in boxes)
    pad = max(40, round(max(x1 - x0, y1 - y0) * 0.35))
    crop = (max(0, x0 - pad), max(0, y0 - pad), min(scene.width, x1 + pad), min(scene.height, y1 + pad))
    canvas = Image.new("RGB", (1440, 295), "#0b0c10")
    draw = ImageDraw.Draw(canvas)
    for index, ((key, label), color, box) in enumerate(zip(METHODS, COLORS, boxes)):
        panel = overlay(scene, sprite, box, crop, color)
        left = index * 360
        canvas.paste(panel, (left + (360 - panel.width) // 2, 35 + (260 - panel.height) // 2))
        suffix = " ✓" if matches[key].get("accepted", matches[key].get("verdict") == "pass") else " rejected"
        draw.text((left + 12, 10), label.upper() + suffix, fill=color)
    return canvas


report = json.loads((HERE / "report.json").read_text())
cards: list[str] = []
accepted = {key: 0 for key, _ in METHODS}
for level_report in report["levels"]:
    level_id = level_report["levelId"]
    level = json.loads((LEVELS / level_id / "level.json").read_text())
    dogs = {dog["id"]: dog for dog in level.get("dogs", [])}
    for bird in level_report["birds"]:
        if len(cards) >= VISUAL_LIMIT:
            break
        if "cutoutMatches" not in bird or bird.get("dogId") not in dogs:
            continue
        matches = bird["cutoutMatches"]
        for key, _ in METHODS:
            if matches[key].get("accepted", matches[key].get("verdict") == "pass"):
                accepted[key] += 1
        image = comparison(level_id, dogs[bird["dogId"]], matches)
        details = " · ".join(
            f"{label}: {matches[key].get('score', 'n/a')}"
            + (f" / {matches[key].get('inliers', 0)} inliers / {matches[key].get('coverage', 0):.0%} coverage" if key == "features" else "")
            for key, label in METHODS
        )
        choices = "".join(f'<label><input type="checkbox" data-choice="{key}"><span>{html.escape(label)}</span></label>' for key, label in METHODS)
        issues = "".join(f'<label><input type="checkbox" data-issue="{key}"><span>{label}</span></label>' for key, label in (("too_small", "Too small"), ("too_big", "Too big"), ("offset", "Offset"), ("wrong_bird", "Wrong bird"), ("regenerate", "Regenerate")))
        cards.append(f'<article class="card" data-key="{html.escape(level_id)}::{html.escape(bird["dogId"])}"><img loading="lazy" src="{data_url(image)}"><div class="body"><small>{html.escape(level_id)}</small><h2>{html.escape(bird["dogId"])}</h2><code>{html.escape(details)}</code><fieldset><legend>Good enough (pick multiple)</legend>{choices}</fieldset><fieldset><legend>Problems</legend>{issues}</fieldset></div></article>')
    if len(cards) >= VISUAL_LIMIT:
        break

total = len(cards)
document = f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Full catalog cutout matching</title><style>
:root{{--bg:#090b0e;--panel:#141820;--line:#303844;--ink:#f7f4eb;--muted:#9da7b3;--accent:#55e68b}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui;padding:36px}}main{{max-width:1480px;margin:auto}}h1{{font-size:clamp(36px,6vw,68px);line-height:1;margin:.2em 0}}.lede{{color:var(--muted);max-width:900px;font-size:18px}}.bar{{position:sticky;top:12px;z-index:3;background:#11151bee;border:1px solid var(--line);border-radius:14px;padding:12px;margin:20px 0;display:flex;gap:16px;flex-wrap:wrap;align-items:center}}button{{background:#1b222c;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:9px 12px;cursor:pointer}}.grid{{display:grid;gap:18px}}.card{{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}}.card img{{width:100%;display:block;background:#050608}}.body{{padding:14px}}small{{color:var(--accent);font-weight:800}}h2{{margin:4px 0}}code{{color:var(--muted);font-size:12px}}fieldset{{border:0;padding:0;margin:12px 0 0;display:flex;gap:7px;flex-wrap:wrap}}legend{{color:var(--muted);font-size:12px;margin-bottom:6px}}label{{position:relative}}label input{{position:absolute;opacity:0}}label span{{display:block;border:1px solid var(--line);border-radius:8px;padding:8px 11px;cursor:pointer}}label input:checked+span{{background:#245c38;border-color:var(--accent);color:#eafff0}}@media(max-width:700px){{body{{padding:14px}}}}</style></head><body><main><small>FIND THE BIRD · LEVEL EDITOR CLI · ORIGINAL 98 LEVELS</small><h1>Cutout matching shootout</h1><p class="lede">The first 100 birds from the exact 98-level catalog snapshot at <code>301ca2b</code> (1,857 birds total). “Best safe” accepts feature correspondence only when geometry gates pass, otherwise it falls back. Select every acceptable result and flag regeneration cases.</p><div class="bar"><b id="reviewed">0 / {total} reviewed</b><span>Accepted in sample: Color {accepted['color']} · Hybrid {accepted['hybrid']} · Features {accepted['features']} · Best {accepted['best']}</span><button id="unreviewed">Show unreviewed</button><button id="submit">Submit to Portal</button><span id="status"></span></div><section class="grid">{''.join(cards)}</section></main><script>
const cards=[...document.querySelectorAll('.card')];let only=false;const checked=(c,a)=>[...c.querySelectorAll('['+a+']:checked')].map(x=>x.dataset[a.slice(5)]);function render(){{let n=0;for(const c of cards){{const done=checked(c,'data-choice').length||checked(c,'data-issue').length;if(done)n++;c.hidden=only&&done}}document.querySelector('#reviewed').textContent=n+' / '+cards.length+' reviewed'}}document.querySelectorAll('input').forEach(x=>x.onchange=render);document.querySelector('#unreviewed').onclick=()=>{{only=!only;render()}};document.querySelector('#submit').onclick=async()=>{{const reqId=location.pathname.split('/')[2],status=document.querySelector('#status');status.textContent='Submitting…';const decisions=cards.filter(c=>checked(c,'data-choice').length||checked(c,'data-issue').length).map(c=>{{const[levelId,dogId]=c.dataset.key.split('::');return{{levelId,dogId,choices:checked(c,'data-choice'),issues:checked(c,'data-issue')}}}});try{{const r=await fetch('/r/'+encodeURIComponent(reqId)+'/decide',{{method:'POST',credentials:'same-origin',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{payload:{{schemaVersion:1,decisions}}}})}});if(!r.ok)throw new Error(await r.text());status.textContent='Review recorded.'}}catch(e){{status.textContent='Failed: '+e.message}}}};render();
</script></body></html>'''
(HERE / "cutout-matching-review.html").write_text(document)
print(HERE / "cutout-matching-review.html")
