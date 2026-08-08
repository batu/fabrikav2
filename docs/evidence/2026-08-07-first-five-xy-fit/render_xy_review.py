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
REGENERATION = {
    ("ad_campaigns_ad_treehouse_village_bird_24d4", dog) for dog in ("dog_03", "dog_09", "dog_13")
} | {
    ("cozy_interiors_cozy_toymaker_workshop_bird_4e44", dog) for dog in ("dog_08", "dog_10", "dog_17")
} | {
    ("ad_campaigns_ad_cozy_library_bird_e654", "dog_03"),
} | {
    ("greece_santorini_steps_bird_4634", dog) for dog in ("dog_03", "dog_04", "dog_07", "dog_08")
}


def data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, "JPEG", quality=78, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()


def overlay(scene, sprite, box, crop_box, color):
    crop = scene.crop(crop_box).convert("RGBA")
    x0, y0, x1, y1 = box
    alpha = sprite.getchannel("A").resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    expanded = alpha.filter(ImageFilter.MaxFilter(9))
    contour = Image.new("L", alpha.size)
    contour.frombytes(bytes(max(0, a - b) for a, b in zip(expanded.tobytes(), alpha.tobytes())))
    tint = Image.new("RGBA", alpha.size, (*color, 52))
    tint.putalpha(alpha.point(lambda p: min(70, p)))
    edge = Image.new("RGBA", alpha.size, (*color, 255))
    edge.putalpha(contour)
    px, py = x0 - crop_box[0], y0 - crop_box[1]
    crop.alpha_composite(tint, (px, py))
    crop.alpha_composite(edge, (px, py))
    ImageDraw.Draw(crop).rectangle((px, py, px + x1 - x0 - 1, py + y1 - y0 - 1), outline=(*color, 185), width=2)
    crop.thumbnail((420, 300))
    return crop.convert("RGB")


def comparison(level_id, dog, boxes):
    level_dir = LEVELS / level_id
    scene = Image.open(level_dir / "color.png").convert("RGB")
    rel = dog["sprite"]["image"].split(f"levels/{level_id}/", 1)[-1]
    sprite = Image.open(level_dir / rel).convert("RGBA")
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    pad = max(45, int(max(x1 - x0, y1 - y0) * 0.3))
    crop = (max(0, x0 - pad), max(0, y0 - pad), min(scene.width, x1 + pad), min(scene.height, y1 + pad))
    colors = [(70, 190, 255), (255, 105, 210), (255, 194, 86), (76, 235, 147)]
    labels = ["PREVIOUS COLOR", "XY 12%", "XY 25%", "XY UNLOCKED"]
    panels = [overlay(scene, sprite, box, crop, color) for box, color in zip(boxes, colors)]
    canvas = Image.new("RGB", (1680, 335), "#0b0c10")
    draw = ImageDraw.Draw(canvas)
    for index, (panel, label, color) in enumerate(zip(panels, labels, colors)):
        left = index * 420
        canvas.paste(panel, (left + (420 - panel.width) // 2, 35 + (300 - panel.height) // 2))
        draw.text((left + 14, 10), label, fill=color)
    return canvas


report = json.loads((HERE / "report.json").read_text())
cards = []
counts = {}
for level_report in report["levels"]:
    level_id = level_report["levelId"]
    level = json.loads((LEVELS / level_id / "level.json").read_text())
    dogs = {dog["id"]: dog for dog in level["dogs"]}
    counts[level_id] = len(level_report["birds"])
    for bird in level_report["birds"]:
        dog_id = bird["dogId"]
        candidates = [
            bird["colorAlignment"], bird["colorXY12Alignment"],
            bird["colorXY25Alignment"], bird["colorXYUnlockedAlignment"],
        ]
        image = comparison(level_id, dogs[dog_id], [candidate["fittedBox"] for candidate in candidates])
        details = " · ".join(
            ["Color uniform"] + [
                f"{label} sx {candidate['scaleX']:.2f} sy {candidate['scaleY']:.2f} distort {candidate['aspectDistortion'] * 100:.0f}%"
                for label, candidate in zip(("12%", "25%", "free"), candidates[1:])
            ]
        )
        flagged = (level_id, dog_id) in REGENERATION
        cards.append(f'''<article class="card" data-level="{html.escape(level_id)}" data-key="{html.escape(level_id)}::{html.escape(dog_id)}"><img src="{data_url(image)}" alt="Four-way alignment comparison for {html.escape(dog_id)}"><div class="body"><div class="level">{html.escape(level_id)}</div><h2>{html.escape(dog_id)}{' <em>PREVIOUSLY FLAGGED FOR REGENERATION</em>' if flagged else ''}</h2><p>{html.escape(details)}</p><fieldset class="vote"><legend>Good outcomes <span>(select every acceptable result)</span></legend>{''.join(f'<label><input type="checkbox" data-choice="{choice}"><span>{label}</span></label>' for choice, label in (("color", "Previous color"), ("xy12", "XY 12%"), ("xy25", "XY 25%"), ("unlocked", "XY unlocked"), ("regenerate", "Needs regeneration")))}</fieldset><fieldset class="issues"><legend>Problems <span>(select any)</span></legend>{''.join(f'<label><input type="checkbox" data-issue="{issue}"><span>{label}</span></label>' for issue, label in (("too_small", "Too small"), ("too_big", "Too big"), ("offset", "Offset"), ("distorted", "Distorted")))}</fieldset></div></article>''')

level_filters = "".join(f'<button data-level="{html.escape(level)}">{html.escape(level)} <b>{count}</b></button>' for level, count in counts.items())
document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Independent-axis alignment vote</title><style>
:root{{--bg:#0c0d11;--panel:#17191f;--line:#30343e;--ink:#f5f2ea;--muted:#aaa9a3;--blue:#56c7ff;--pink:#ff69d2;--amber:#ffc256;--green:#4ceb93;--accent:#ff4fd8}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui;padding:48px}}main{{max-width:1380px;margin:auto}}h1{{font-size:clamp(40px,6vw,70px);line-height:.98;margin:10px 0 18px}}.lede{{font-size:19px;color:var(--muted);max-width:980px}}.bar{{position:sticky;top:44px;z-index:4;background:rgba(23,25,31,.97);border:1px solid var(--line);border-radius:16px;padding:14px;margin:24px 0}}.summary,.filters,.actions{{display:flex;flex-wrap:wrap;gap:9px}}.summary span{{min-width:110px;color:var(--muted)}}.summary b{{color:var(--ink);font-size:20px}}button{{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:9px 13px;cursor:pointer}}button.active{{border-color:var(--accent)}}.actions{{margin-top:10px;align-items:center}}.filters{{margin:14px 0}}button b{{color:var(--green)}}.grid{{display:grid;gap:20px}}.card{{border:1px solid var(--line);border-radius:18px;background:var(--panel);overflow:hidden}}.card img{{display:block;width:100%;background:#08090c}}.body{{padding:16px}}.level{{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;overflow-wrap:anywhere}}h2{{margin:5px 0;font-size:22px}}em{{font-style:normal;color:#ff7b88;font-size:10px;float:right}}p{{margin:0;color:var(--muted);font:12px ui-monospace,monospace}}fieldset{{border:0;padding:0;margin:14px 0 0;display:grid;gap:7px}}legend{{font-size:11px;color:var(--muted);margin-bottom:7px}}legend span{{opacity:.7}}.vote{{grid-template-columns:repeat(5,1fr)}}.issues{{grid-template-columns:repeat(4,1fr)}}label{{position:relative;cursor:pointer}}label input{{position:absolute;inset:0;opacity:0;cursor:pointer}}label span{{display:block;border:1px solid var(--line);border-radius:9px;padding:9px;text-align:center}}label input:checked+span{{background:#49351d;border-color:var(--amber);color:var(--amber);font-weight:800}}.vote label:nth-of-type(1) input:checked+span{{background:var(--blue);border-color:var(--blue);color:#081018}}.vote label:nth-of-type(2) input:checked+span{{background:var(--pink);border-color:var(--pink);color:#160811}}.vote label:nth-of-type(3) input:checked+span{{background:var(--amber);border-color:var(--amber);color:#171006}}.vote label:nth-of-type(4) input:checked+span{{background:var(--green);border-color:var(--green);color:#06150c}}@media(max-width:760px){{body{{padding:20px}}.vote,.issues{{grid-template-columns:1fr 1fr}}}}</style></head><body><main><div class="level">Find the Bird · independent-axis experiment · 7 August 2026</div><h1>How much distortion actually helps?</h1><p class="lede">Compare the accepted Previous Color baseline with independent X/Y scaling at 12%, 25%, and fully unlocked aspect distortion. Select every result that is good enough. Regeneration cases are retained as controls; no level geometry changes automatically.</p><section class="bar"><div class="summary"><span>Reviewed <b id="reviewed">0</b>/98</span><span>Color <b id="n-color">0</b></span><span>XY 12% <b id="n-xy12">0</b></span><span>XY 25% <b id="n-xy25">0</b></span><span>Unlocked <b id="n-unlocked">0</b></span><span>Regenerate <b id="n-regenerate">0</b></span></div><div class="actions"><button id="submit">Submit review to Portal</button><button id="unreviewed">Show unreviewed</button><span id="status" aria-live="polite"></span></div></section><div class="filters"><button class="active" data-level="all">All levels <b>98</b></button>{level_filters}</div><section class="grid">{''.join(cards)}</section></main><script>
const cards=[...document.querySelectorAll('.card')];let level='all',onlyUnreviewed=false;const selected=(card,attribute)=>[...card.querySelectorAll('['+attribute+']:checked')].map(input=>input.dataset[attribute.slice(5)]);function render(){{const totals={{color:0,xy12:0,xy25:0,unlocked:0,regenerate:0}};let reviewed=0;for(const card of cards){{const picks=selected(card,'data-choice'),problems=selected(card,'data-issue');if(picks.length||problems.length)reviewed++;for(const item of picks)if(item in totals)totals[item]++;card.hidden=(level!=='all'&&card.dataset.level!==level)||(onlyUnreviewed&&(picks.length||problems.length))}}document.querySelector('#reviewed').textContent=reviewed;for(const key in totals)document.querySelector('#n-'+key).textContent=totals[key]}}
for(const input of document.querySelectorAll('input[type=checkbox]'))input.onchange=render;
document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>{{document.querySelectorAll('[data-level]').forEach(x=>x.classList.remove('active'));button.classList.add('active');level=button.dataset.level;render()}});document.querySelector('#unreviewed').onclick=()=>{{onlyUnreviewed=!onlyUnreviewed;document.querySelector('#unreviewed').classList.toggle('active',onlyUnreviewed);render()}};
function payload(){{return{{schemaVersion:4,totalBirds:cards.length,decisions:cards.filter(card=>selected(card,'data-choice').length||selected(card,'data-issue').length).map(card=>{{const [levelId,dogId]=card.dataset.key.split('::');return{{levelId,dogId,choices:selected(card,'data-choice'),issues:selected(card,'data-issue')}}}})}}}}document.querySelector('#submit').onclick=async()=>{{const button=document.querySelector('#submit'),status=document.querySelector('#status'),reqId=location.pathname.split('/')[2];button.disabled=true;status.textContent='Submitting…';try{{const response=await fetch('/r/'+encodeURIComponent(reqId)+'/decide',{{method:'POST',credentials:'same-origin',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{payload:payload()}})}});if(!response.ok)throw new Error(await response.text());button.textContent='Submitted';status.textContent='Review recorded.'}}catch(error){{button.disabled=false;status.textContent='Failed: '+error.message}}}};render();
</script></body></html>'''
(HERE / "xy-alignment-review.html").write_text(document)
print(HERE / "xy-alignment-review.html")
