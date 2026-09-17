"""Intake overview for Portal (2026-09-16): corpus totals, per-level table, the birds still refused after regeneration and the
no-painted-bird drops as panels. usage: intake_overview.py OUTDIR BUILD_SHA"""
from common import *
from PIL import ImageFont
F=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20)
O=Path(sys.argv[1]); O.mkdir(parents=True,exist_ok=True); build=sys.argv[2]; SP=SCRATCH/'intake'; ids=open(SP/'ids60.txt').read().split(); assets=[]; rows=[]; H=[]
banner={o['id']:o for o in json.load(open(SP/'banner14.json'))}
tot=dict(birds=0,regen=0,missing=0,still=0,nos=0,dropped=0)
for k in ids:
    s=json.load(open(SP/k/'summary.json')); b=banner.get(k,{}); e=json.load(open(ROOT/'public/levels'/k/'level.json'))
    tot['birds']+=s['birds']; tot['regen']+=len(s.get('regenerated',[])); tot['missing']+=len(s.get('missing',[])); tot['still']+=len(s.get('still_refused',[])); tot['nos']+=len(s.get('no_sprite',[])); tot['dropped']+=s['birds']-len(e['dogs'])
    rows.append((k,s['birds'],len(e['dogs']),len(s.get('regenerated',[])),s.get('missing',[]),s.get('still_refused',[]),len(b.get('over',[]))))
H.append(f'<h1>FTB intake: 60 unshipped levels, phone build {build}</h1><p>Workflow per level: VLM hitbox re-localization where the session held pre-paint hitboxes (38 levels), Extract All (sunburst low, visible part only, new keying), gemini judge, refit (uniform + aspect), regeneration of judge-T3/T4 and refit-refused birds (two crops, best match wins), refit again, judge again. Rule: a refit-accepted bird with pop 25 or better keeps a T3. Export via the canonical lane with the delegated final-cutout bless, sticker work merged by hitbox, birds with no painted bird dropped from the export.</p>')
H.append(f'<p><b>{tot["birds"]} birds</b> on 60 levels: {tot["regen"]} regenerated, {tot["missing"]} judged as having no painted bird (dropped, {tot["dropped"]} dogs fewer in the exports incl. {tot["nos"]} that never got a cutout), {tot["still"]} still refused after regeneration (shipped as-is, listed below for you). Banner suppressed on {sum(1 for r in rows if r[6])} of 60 levels (14% band). All 104 levels bundled in this review build (cap raised for review only, {"" }373 MB); the store build needs the CDN lane for anything past ~58 levels.</p>')
H.append('<table style="border-collapse:collapse;font-size:14px"><tr><th>level</th><th>birds</th><th>in export</th><th>regenerated</th><th>no painted bird</th><th>still refused</th><th>banner intruders</th></tr>')
for r in rows: H.append(f'<tr><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{" ".join(r[4]) or "-"}</td><td>{" ".join(r[5]) or "-"}</td><td>{r[6] or "-"}</td></tr>')
H.append('</table><style>td,th{border:1px solid #ccc;padding:2px 6px;text-align:left}</style>')
def panel(k,b,tag_):
    S=SP/k; pd2=S/'panels2'/f'L{k}'/f'bird_{int(b):02d}.png'; pd=S/'panels'/f'L{k}'/f'bird_{int(b):02d}.png'; src=pd2 if pd2.exists() else pd
    if not src.exists(): return None
    a=Image.open(src); sheet=Image.new('RGB',(a.width,a.height+34),(24,24,24)); sheet.paste(a,(0,34)); dr=ImageDraw.Draw(sheet)
    t=json.load(open(S/'tiers2.json'))[k].get(b) if (S/'tiers2.json').exists() and b in json.load(open(S/'tiers2.json'))[k] else json.load(open(S/'tiers.json'))[k].get(b,{})
    dr.text((6,6),f"{k[:40]} #{b}  {tag_}  T{t.get('tier')}: {str(t.get('why',''))[:70]}",font=F,fill=(255,200,80))
    name=f'{tag_}_{k[:24]}_{int(b):02d}.jpg'; sheet.save(O/name,quality=78); assets.append(name); return name
H.append('<h2>Still refused after regeneration (shipped as-is)</h2><p>painted | sprite on grey | 50% overlay, latest sprite.</p>')
for r in rows:
    for b in r[5]:
        n=panel(r[0],b,'refused'); H.append(f'<img src="{{{n}}}">') if n else None
H.append('<h2>No painted bird at the hitbox (dropped from the export)</h2>')
for r in rows:
    for b in r[4]:
        n=panel(r[0],b,'missing'); H.append(f'<img src="{{{n}}}">') if n else None
html='<!doctype html><meta charset=utf-8><title>FTB intake overview</title><style>body{font:16px/1.5 -apple-system,system-ui;margin:16px;color:#222;max-width:1300px}img{width:100%;display:block;border:1px solid #ccc;margin:6px 0 14px}</style>'+'\n'.join(H)
for i,a in enumerate(sorted(assets)): html=html.replace('{'+a+'}',f'{i+2:02d}_{a}')
(O/'report.html').write_text(html); print(len(assets),'assets',round(sum((O/a).stat().st_size for a in assets)/1e6,2),'MB', tot)
