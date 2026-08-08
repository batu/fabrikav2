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
METHODS = (
    ("silhouette", "Silhouette"), ("color", "Color"), ("hybrid", "Hybrid"),
    ("features", "SIFT"), ("orb", "ORB"), ("chamfer", "Chamfer"), ("best", "Best safe"),
)
COLORS = ("#70b7ff", "#ff69d2", "#ffc256", "#c79cff", "#64e3d3", "#ff8e66", "#4ceb93")
HARD_CASES = {
    "ad_campaigns_ad_treehouse_village_bird_24d4": {"dog_02", "dog_07"},
    "hawaii_rainforest_waterfall_bird_0f98": {"dog_04", "dog_06"},
    "cozy_interiors_cozy_toymaker_workshop_bird_4e44": {"dog_01", "dog_02", "dog_09"},
    "ad_campaigns_ad_cozy_library_bird_e654": {"dog_16", "dog_19"},
}
BROKEN_LEVEL = "ad_campaigns_ad_autumn_forest_bird_389c_gpro"


def data_url(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, "JPEG", quality=78, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()


def panel(scene: Image.Image, sprite: Image.Image, box: list[int], crop: tuple[int, int, int, int], color: str) -> Image.Image:
    out = scene.crop(crop).convert("RGBA")
    x0, y0, x1, y1 = box
    alpha = sprite.getchannel("A").resize((max(1, x1 - x0), max(1, y1 - y0)), Image.Resampling.LANCZOS)
    expanded = alpha.filter(ImageFilter.MaxFilter(9))
    contour = Image.frombytes("L", alpha.size, bytes(max(0, a - b) for a, b in zip(expanded.tobytes(), alpha.tobytes())))
    rgb = tuple(bytes.fromhex(color[1:]))
    tint = Image.new("RGBA", alpha.size, (*rgb, 60)); tint.putalpha(alpha.point(lambda p: min(76, p)))
    edge = Image.new("RGBA", alpha.size, (*rgb, 255)); edge.putalpha(contour)
    px, py = x0 - crop[0], y0 - crop[1]
    out.alpha_composite(tint, (px, py)); out.alpha_composite(edge, (px, py))
    ImageDraw.Draw(out).rectangle((px, py, px + x1 - x0 - 1, py + y1 - y0 - 1), outline=(*rgb, 230), width=3)
    out.thumbnail((330, 265))
    return out.convert("RGB")


report = json.loads((HERE / "report.json").read_text())
assert all(level["levelId"] != BROKEN_LEVEL for level in report["levels"])
cards = []
for level_report in report["levels"]:
    level_id = level_report["levelId"]
    level_dir = LEVELS / level_id
    level = json.loads((level_dir / "level.json").read_text())
    dogs = {dog["id"]: dog for dog in level["dogs"]}
    scene = Image.open(level_dir / "color.png").convert("RGB")
    for bird in level_report["birds"]:
        dog_id = bird["dogId"]
        if dog_id not in HARD_CASES.get(level_id, set()):
            continue
        dog, matches = dogs[dog_id], bird["cutoutMatches"]
        sprite_path = dog["sprite"]["image"].split(f"levels/{level_id}/", 1)[-1]
        sprite = Image.open(level_dir / sprite_path).convert("RGBA")
        fallback = matches["color"]["originalBox"]
        boxes = []
        for key, _ in METHODS:
            result = matches[key]
            accepted = result.get("accepted", result.get("verdict") == "pass")
            boxes.append(result.get("fittedBox", fallback) if accepted else result.get("originalBox", fallback))
        x0, y0 = min(box[0] for box in boxes), min(box[1] for box in boxes)
        x1, y1 = max(box[2] for box in boxes), max(box[3] for box in boxes)
        pad = max(48, round(max(x1 - x0, y1 - y0) * .38))
        crop = (max(0, x0 - pad), max(0, y0 - pad), min(scene.width, x1 + pad), min(scene.height, y1 + pad))
        views = []
        for (key, label), color, box in zip(METHODS, COLORS, boxes):
            result = matches[key]
            accepted = result.get("accepted", result.get("verdict") == "pass")
            metric = f"score {result.get('score', 'n/a')}"
            if key in {"features", "orb"}:
                metric += f" · {result.get('inliers', 0)} inliers"
            views.append(f'<label class="view"><input type="checkbox" data-choice="{key}"><span class="pick">{html.escape(label)} {"✓" if accepted else "rejected"} · {metric}</span><img src="{data_url(panel(scene, sprite, box, crop, color))}"></label>')
        issues = "".join(f'<label class="issue"><input type="checkbox" data-issue="{key}"><span>{label}</span></label>' for key, label in (("too_small", "Too small"), ("too_big", "Too big"), ("offset", "Offset"), ("wrong_bird", "Wrong bird"), ("regenerate", "Regenerate")))
        cards.append(f'<article class="card" data-key="{level_id}::{dog_id}"><header><small>{level_id}</small><h2>{dog_id}</h2></header><div class="views">{"".join(views)}</div><fieldset><legend>Problems</legend>{issues}</fieldset></article>')

document = f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hard-case matcher shootout</title><style>
:root{{--bg:#090b0e;--panel:#141820;--line:#303844;--ink:#f7f4eb;--muted:#9da7b3;--accent:#55e68b}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui;padding:30px}}main{{max-width:2380px;margin:auto}}h1{{font-size:clamp(34px,5vw,64px);margin:.15em 0}}.lede{{color:var(--muted);max-width:1000px;font-size:18px}}.bar{{position:sticky;top:10px;z-index:3;background:#11151bee;border:1px solid var(--line);border-radius:14px;padding:12px;margin:18px 0}}.card{{background:var(--panel);border:1px solid var(--line);border-radius:16px;margin:18px 0;overflow:hidden}}header,fieldset{{padding:12px 14px}}small{{color:var(--accent);font-weight:800}}h2{{margin:2px 0}}.views{{display:grid;grid-template-columns:repeat(7,minmax(210px,1fr));gap:1px;background:var(--line)}}.view{{background:#0b0d11;position:relative;cursor:pointer}}.view img{{width:100%;display:block}}input{{position:absolute;opacity:0}}.pick{{display:block;padding:9px 10px;color:var(--muted);font-size:12px}}.view input:checked+.pick{{background:#245c38;color:#eafff0}}fieldset{{border:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}}legend{{color:var(--muted)}}.issue span{{display:block;border:1px solid var(--line);border-radius:8px;padding:7px 10px;cursor:pointer}}.issue input:checked+span{{background:#713437;border-color:#ff777d}}button{{background:#1b222c;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:9px 12px;cursor:pointer}}@media(max-width:1500px){{.views{{grid-template-columns:repeat(4,1fr)}}}}@media(max-width:800px){{body{{padding:12px}}.views{{grid-template-columns:repeat(2,1fr)}}}}</style></head><body><main><small>FIND THE BIRD · 9 USER-FLAGGED CASES</small><h1>Every runnable matcher, on the cases that matter</h1><p class="lede">Silhouette, color, hybrid, SIFT, ORB, chamfer, and the conservative selector. The broken <code>{BROKEN_LEVEL}</code> is explicitly excluded. Rejected feature results preserve original geometry.</p><div class="bar"><b id="reviewed">0 / {len(cards)} reviewed</b> · <button id="submit">Submit to Portal</button> <span id="status"></span></div>{''.join(cards)}</main><script>
const cards=[...document.querySelectorAll('.card')];const vals=(c,a)=>[...c.querySelectorAll('['+a+']:checked')].map(x=>x.dataset[a.slice(5)]);function render(){{document.querySelector('#reviewed').textContent=cards.filter(c=>vals(c,'data-choice').length||vals(c,'data-issue').length).length+' / '+cards.length+' reviewed'}}document.querySelectorAll('input').forEach(x=>x.onchange=render);document.querySelector('#submit').onclick=async()=>{{const reqId=location.pathname.split('/')[2],status=document.querySelector('#status');status.textContent='Submitting…';const decisions=cards.filter(c=>vals(c,'data-choice').length||vals(c,'data-issue').length).map(c=>{{const[levelId,dogId]=c.dataset.key.split('::');return{{levelId,dogId,choices:vals(c,'data-choice'),issues:vals(c,'data-issue')}}}});try{{const r=await fetch('/r/'+encodeURIComponent(reqId)+'/decide',{{method:'POST',credentials:'same-origin',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{payload:{{schemaVersion:1,decisions}}}})}});if(!r.ok)throw new Error(await r.text());status.textContent='Review recorded.'}}catch(e){{status.textContent='Failed: '+e.message}}}};render();
</script></body></html>'''
(HERE / "hard-case-matcher-shootout.html").write_text(document)
print(HERE / "hard-case-matcher-shootout.html")
