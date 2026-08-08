from __future__ import annotations

import base64
import html
import io
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LEVELS = ROOT / "games/find_the_bird/public/levels"
COLOR_REPORT = HERE.parent / "2026-08-07-first-five-color-fit/report.json"


def data_url(image: Image.Image) -> str:
    output = io.BytesIO(); image.save(output, "JPEG", quality=76, optimize=True)
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
    crop.thumbnail((420, 300)); return crop.convert("RGB")


def three_way(level_id: str, dog: dict, boxes: list[list[int]]) -> Image.Image:
    level_dir = LEVELS / level_id
    scene = Image.open(level_dir / "color.png").convert("RGB")
    rel = dog["sprite"]["image"].split(f"levels/{level_id}/", 1)[-1]
    sprite = Image.open(level_dir / rel).convert("RGBA")
    x0=min(b[0] for b in boxes); y0=min(b[1] for b in boxes); x1=max(b[2] for b in boxes); y1=max(b[3] for b in boxes)
    pad=max(45,int(max(x1-x0,y1-y0)*.3)); crop_box=(max(0,x0-pad),max(0,y0-pad),min(scene.width,x1+pad),min(scene.height,y1+pad))
    colors=[(255,72,94),(70,190,255),(76,235,147)]; labels=["CURRENT", "PREVIOUS COLOR", "NEW HYBRID"]
    panels=[overlay(scene,sprite,box,crop_box,color) for box,color in zip(boxes,colors)]
    canvas=Image.new("RGB",(1260,335),"#0b0c10"); draw=ImageDraw.Draw(canvas)
    for index,(panel,label,color) in enumerate(zip(panels,labels,colors)):
        left=index*420; canvas.paste(panel,(left+(420-panel.width)//2,35+(300-panel.height)//2)); draw.text((left+14,10),label,fill=color)
    return canvas


color=json.loads(COLOR_REPORT.read_text()); hybrid=json.loads((HERE/"report.json").read_text())
color_map={(lv["levelId"],b["dogId"]):b["colorAlignment"] for lv in color["levels"] for b in lv["birds"]}
hybrid_map={(lv["levelId"],b["dogId"]):b["hybridAlignment"] for lv in hybrid["levels"] for b in lv["birds"]}
cards=[]; counts={}; changed=scale_changed=moved=0
for level_report in hybrid["levels"]:
    level_id=level_report["levelId"]; level=json.loads((LEVELS/level_id/"level.json").read_text()); dogs={d["id"]:d for d in level["dogs"]}; counts[level_id]=len(level_report["birds"])
    for bird in level_report["birds"]:
        key=(level_id,bird["dogId"]); previous=color_map[key]; new=hybrid_map[key]; current=previous["originalBox"]
        boxes=[current,previous["fittedBox"],new["fittedBox"]]; image=three_way(level_id,dogs[bird["dogId"]],boxes)
        changed += boxes[1] != boxes[2]
        pw,ph=boxes[1][2]-boxes[1][0],boxes[1][3]-boxes[1][1]; nw,nh=boxes[2][2]-boxes[2][0],boxes[2][3]-boxes[2][1]
        scale_changed += (pw,ph)!=(nw,nh)
        pc=((boxes[1][0]+boxes[1][2])/2,(boxes[1][1]+boxes[1][3])/2); nc=((boxes[2][0]+boxes[2][2])/2,(boxes[2][1]+boxes[2][3])/2); distance=math.dist(pc,nc); moved += distance>20
        alert=' <em>REVIEW: MATERIAL DELTA</em>' if distance>20 or abs(nw-pw)>20 or abs(nh-ph)>20 else ''
        review_key = f'{level_id}::{bird["dogId"]}'
        cards.append(f'''<article class="card" data-level="{html.escape(level_id)}" data-key="{html.escape(review_key)}" data-vote="unvoted"><img src="{data_url(image)}" alt="Three-way comparison for {html.escape(bird["dogId"])}"><div class="body"><div class="level">{html.escape(level_id)}</div><h2>{html.escape(bird["dogId"])}{alert}</h2><p>previous {pw}×{ph} → hybrid {nw}×{nh}; center moved {distance:.1f}px</p>
        <fieldset class="vote-group"><legend>Good outcomes <span>(select any that are equally acceptable)</span></legend><label><input type="checkbox" data-choice="current"><span>Current</span></label><label><input type="checkbox" data-choice="color"><span>Previous color</span></label><label><input type="checkbox" data-choice="hybrid"><span>Hybrid</span></label><label><input type="checkbox" data-choice="regenerate"><span>Needs regeneration</span></label></fieldset>
        <fieldset class="issue-group"><legend>Errors <span>(select any)</span></legend><label><input type="checkbox" data-issue="too_small"><span>Too small</span></label><label><input type="checkbox" data-issue="too_big"><span>Too big</span></label><label><input type="checkbox" data-issue="offset"><span>Offset</span></label></fieldset></div></article>''')

filters=''.join(f'<button data-filter="{html.escape(k)}">{html.escape(k)} <b>{v}</b></button>' for k,v in counts.items())
document=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alignment voting review</title><style>
:root{{--bg:#0c0d11;--panel:#17191f;--line:#30343e;--ink:#f5f2ea;--muted:#aaa9a3;--red:#ff7b88;--blue:#56c7ff;--green:#80e8a5;--accent:#ff4fd8;--amber:#ffc76b}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 ui-sans-serif,system-ui;padding:48px}}main{{max-width:1320px;margin:auto}}.eyebrow,.level{{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;overflow-wrap:anywhere}}h1{{font-size:clamp(42px,7vw,72px);line-height:.97;margin:12px 0 20px;max-width:1050px}}.lede{{font-size:20px;color:var(--muted);max-width:920px}}.review-bar{{position:sticky;top:10px;z-index:5;background:rgba(23,25,31,.96);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:16px;padding:14px;margin:28px 0}}.summary{{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}}.summary div{{padding:8px 10px;border-right:1px solid var(--line)}}.summary div:last-child{{border:0}}.summary b{{display:block;font-size:24px}}.summary small{{color:var(--muted)}}.issue-summary,.actions,.filters,.status-filters{{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}}.issue-summary span{{color:var(--muted);font-size:12px}}.issue-summary b{{color:var(--amber)}}button,.file-label{{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:9px 13px;cursor:pointer;font:inherit}}button:hover,.file-label:hover{{border-color:var(--muted)}}button:focus-visible,.file-label:focus-within{{outline:2px solid var(--accent);outline-offset:2px}}button.active{{border-color:var(--accent)}}button b{{color:var(--green)}}input[type=file]{{position:absolute;inline-size:1px;block-size:1px;opacity:0}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}.card{{border:1px solid var(--line);border-radius:18px;background:var(--panel);overflow:hidden;transition:border-color .18s,transform .18s}}.card[data-vote=voted]{{border-color:var(--accent)}}.card img{{width:100%;height:220px;object-fit:contain;background:#08090c;display:block}}.body{{padding:15px}}h2{{margin:5px 0;font-size:22px}}em{{font-style:normal;font-size:10px;color:var(--red);float:right}}p{{margin:0;color:var(--muted);font:12px ui-monospace,monospace}}fieldset{{border:0;padding:0;margin:14px 0 0}}legend{{font-size:11px;color:var(--muted);margin-bottom:7px}}legend span{{opacity:.65}}.vote-group{{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}}.vote-group label,.issue-group label{{position:relative;cursor:pointer}}.vote-group input,.issue-group input{{position:absolute;inset:0;opacity:0;cursor:pointer}}.vote-group label span,.issue-group label span{{display:block;border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:9px 8px;text-align:center;font-size:12px}}.vote-group input:focus-visible+span,.issue-group input:focus-visible+span{{outline:2px solid var(--accent);outline-offset:2px}}.vote-group input:checked+span{{color:#08090c;font-weight:800}}.vote-group input[data-choice=current]:checked+span{{background:var(--red);border-color:var(--red)}}.vote-group input[data-choice=color]:checked+span{{background:var(--blue);border-color:var(--blue)}}.vote-group input[data-choice=hybrid]:checked+span{{background:var(--green);border-color:var(--green)}}.vote-group input[data-choice=regenerate]:checked+span{{background:var(--amber);border-color:var(--amber)}}.issue-group{{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}}.issue-group legend{{grid-column:1/-1}}.issue-group label span{{padding:7px;font-size:11px}}.issue-group input:checked+span{{background:#49351d;border-color:var(--amber);color:var(--amber);font-weight:800}}@media(max-width:720px){{body{{padding:24px}}.grid{{grid-template-columns:1fr}}.summary{{grid-template-columns:repeat(2,1fr)}}.summary div{{border:0}}}}</style></head><body><main><div class="eyebrow">Find the Bird · holistic alignment vote · 7 August 2026</div><h1>Choose every acceptable result—or reject the cutout.</h1><p class="lede">Red is Current, blue is Previous Color, and green is Hybrid. Select multiple outcomes when they are equally good. Votes and error tags stay in this browser and can be exported as JSON. No level geometry changes automatically.</p>
<section class="review-bar" aria-label="Review progress"><div class="summary"><div><b id="count-voted">0</b><small>Voted</small></div><div><b id="count-current">0</b><small>Current</small></div><div><b id="count-color">0</b><small>Previous color</small></div><div><b id="count-hybrid">0</b><small>Hybrid</small></div><div><b id="count-regenerate">0</b><small>Regenerate</small></div></div><div class="issue-summary"><span>Too small <b id="issue-too_small">0</b></span><span>Too big <b id="issue-too_big">0</b></span><span>Offset <b id="issue-offset">0</b></span></div><div class="actions"><button id="submit-review" type="button">Submit review to Portal</button><button id="export-votes" type="button">Export decisions</button><label class="file-label">Import decisions<input id="import-votes" type="file" accept="application/json"></label><span id="remaining" aria-live="polite">98 remaining</span><span id="submit-status" aria-live="polite"></span></div><div class="status-filters" aria-label="Decision filters"><button class="active" data-status="all">All</button><button data-status="unvoted">Unvoted</button><button data-status="current">Current</button><button data-status="color">Previous color</button><button data-status="hybrid">Hybrid</button><button data-status="regenerate">Needs regeneration</button></div></section>
<div class="filters" aria-label="Level filters"><button class="active" data-level-filter="all">All levels <b>98</b></button>{filters.replace('data-filter=', 'data-level-filter=')}</div><section class="grid">{''.join(cards)}</section></main><script>
const STORAGE_KEY='ftb-alignment-votes-v1'; const ISSUES_KEY='ftb-alignment-issues-v1'; const cards=[...document.querySelectorAll('.card')]; let votes={{}}; let issues={{}}; let levelFilter='all'; let statusFilter='all';
try{{votes=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{{}}')}}catch{{votes={{}}}}
try{{issues=JSON.parse(localStorage.getItem(ISSUES_KEY)||'{{}}')}}catch{{issues={{}}}}
function save(){{try{{localStorage.setItem(STORAGE_KEY,JSON.stringify(votes));localStorage.setItem(ISSUES_KEY,JSON.stringify(issues))}}catch{{/* Portal's immutable view sandbox intentionally disables local storage. */}}}}
for(const key of Object.keys(votes))if(typeof votes[key]==='string')votes[key]=[votes[key]];
function render(){{const totals={{current:0,color:0,hybrid:0,regenerate:0}};const issueTotals={{too_small:0,too_big:0,offset:0}};let voted=0;for(const card of cards){{const key=card.dataset.key;const selected=votes[key]||[];const selectedIssues=issues[key]||[];card.dataset.vote=selected.length?'voted':'unvoted';card.querySelectorAll('[data-choice]').forEach(input=>input.checked=selected.includes(input.dataset.choice));card.querySelectorAll('[data-issue]').forEach(input=>input.checked=selectedIssues.includes(input.dataset.issue));if(selected.length)voted++;for(const choice of selected)if(totals[choice]!==undefined)totals[choice]++;for(const issue of selectedIssues)if(issueTotals[issue]!==undefined)issueTotals[issue]++;const statusMatch=statusFilter==='all'||(statusFilter==='unvoted'?!selected.length:selected.includes(statusFilter));card.hidden=(levelFilter!=='all'&&card.dataset.level!==levelFilter)||!statusMatch}}document.querySelector('#count-voted').textContent=voted;for(const key of Object.keys(totals))document.querySelector('#count-'+key).textContent=totals[key];for(const key of Object.keys(issueTotals))document.querySelector('#issue-'+key).textContent=issueTotals[key];document.querySelector('#remaining').textContent=`${{cards.length-voted}} remaining`;}}
for(const card of cards)card.querySelectorAll('[data-choice]').forEach(input=>input.onchange=()=>{{const key=card.dataset.key;const selected=new Set(votes[key]||[]);input.checked?selected.add(input.dataset.choice):selected.delete(input.dataset.choice);votes[key]=[...selected];save();render()}});
for(const card of cards)card.querySelectorAll('[data-issue]').forEach(input=>input.onchange=()=>{{const key=card.dataset.key;const selected=new Set(issues[key]||[]);input.checked?selected.add(input.dataset.issue):selected.delete(input.dataset.issue);issues[key]=[...selected];save();render()}});
document.querySelectorAll('[data-level-filter]').forEach(button=>button.onclick=()=>{{document.querySelectorAll('[data-level-filter]').forEach(x=>x.classList.remove('active'));button.classList.add('active');levelFilter=button.dataset.levelFilter;render()}});
document.querySelectorAll('[data-status]').forEach(button=>button.onclick=()=>{{document.querySelectorAll('[data-status]').forEach(x=>x.classList.remove('active'));button.classList.add('active');statusFilter=button.dataset.status;render()}});
function payload(){{return{{schemaVersion:3,exportedAt:new Date().toISOString(),totalBirds:cards.length,decisions:cards.filter(c=>(votes[c.dataset.key]||[]).length||(issues[c.dataset.key]||[]).length).map(c=>{{const [levelId,dogId]=c.dataset.key.split('::');return{{levelId,dogId,choices:votes[c.dataset.key]||[],issues:issues[c.dataset.key]||[]}}}})}}}}
document.querySelector('#export-votes').onclick=()=>{{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload(),null,2)],{{type:'application/json'}}));a.download='find-the-bird-alignment-decisions.json';a.click();URL.revokeObjectURL(a.href)}};
document.querySelector('#submit-review').onclick=async()=>{{const button=document.querySelector('#submit-review');const status=document.querySelector('#submit-status');const reqId=location.pathname.split('/')[2];if(!reqId){{status.textContent='Open this view through Portal to submit.';return}}button.disabled=true;status.textContent='Submitting…';try{{const response=await fetch('/r/'+encodeURIComponent(reqId)+'/decide',{{method:'POST',credentials:'same-origin',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{payload:payload()}})}});const body=await response.text();if(!response.ok)throw new Error(body||response.statusText);button.textContent='Submitted to Portal';status.textContent='Review recorded.'}}catch(error){{status.textContent='Submission failed: '+error.message;button.disabled=false}}}};
document.querySelector('#import-votes').onchange=async event=>{{const file=event.target.files[0];if(!file)return;const payload=JSON.parse(await file.text());for(const item of payload.decisions||[]){{const key=`${{item.levelId}}::${{item.dogId}}`;const importedChoices=Array.isArray(item.choices)?item.choices:(item.choice?[item.choice]:[]);votes[key]=importedChoices.filter(choice=>['current','color','hybrid','regenerate'].includes(choice));issues[key]=(item.issues||[]).filter(issue=>['too_small','too_big','offset'].includes(issue))}}save();render();event.target.value=''}};render();
</script></body></html>'''
(HERE/"three-way-alignment-report.html").write_text(document); print(HERE/"three-way-alignment-report.html")
