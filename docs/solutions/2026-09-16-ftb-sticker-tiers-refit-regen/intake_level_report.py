"""Per-level review page for Batu (2026-09-16): every bird as BEFORE (first extraction) and, when regenerated, AFTER rows,
with judge and refit verdicts; plus the scene with hitboxes. usage: intake_level_report.py OUTDIR ID"""
from common import *
from PIL import ImageFont
F=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20)
os.environ['LEVEL_SOURCE']='work'
O=Path(sys.argv[1]); O.mkdir(parents=True,exist_ok=True); k=sys.argv[2]; S=SCRATCH/'intake'/k; assets=[]; H=[]
summ=json.load(open(S/'summary.json')); tiers=json.load(open(S/'tiers.json'))[k]; t2=json.load(open(S/'tiers2.json'))[k] if (S/'tiers2.json').exists() else {}
r1={str(r['bird']):r for r in json.load(open(S/'refit1.json'))}; r2={str(r['bird']):r for r in json.load(open(S/'refit2.json'))} if (S/'refit2.json').exists() else {}
regen={str(r['bird']):r for r in json.load(open(S/'regen.json'))} if (S/'regen.json').exists() else {}
level=json.load(open(pub(k)/'level.json')); col=Image.open(sdir(k)/'color.png').convert('RGB'); dr=ImageDraw.Draw(col)
for i,d in enumerate(level['dogs']):
    dr.ellipse((d['x']-d['r'],d['y']-d['r'],d['x']+d['r'],d['y']+d['r']),outline=(255,0,0),width=8); dr.text((d['x']+d['r'],d['y']-d['r']),f'#{i}',fill=(255,255,0),font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',48))
col.thumbnail((1600,1600)); col.save(O/'scene.jpg',quality=80); assets.append('scene.jpg')
H.append(f'<h1>{k}</h1><p>{summ["birds"]} birds. Judge sent {len(summ["judge_regen"])} to regeneration, refit refused {len(summ["refit_refused"])}, regenerated {len(summ.get("regenerated",[]))}, no painted bird {summ.get("missing",[])}, still refused after regeneration {summ.get("still_refused",[])}.</p><p>Scene with hitboxes (red) and bird numbers:</p><img src="{{scene.jpg}}"><p>Per bird: BEFORE = painted crop | first extraction on grey | 50% overlay. AFTER (regenerated birds only) = same for the regenerated sprite. Captions: judge tier and reason, refit status (applied = sprite resized/moved to the paint; skipped: pop N = the sprite does not match the paint well enough).</p>')
pd=S/'panels'/f'L{k}'; pd2=S/'panels2'/f'L{k}'
for i,d in enumerate(level['dogs']):
    b=str(i); a=pd/f'bird_{i:02d}.png'
    if not a.exists(): H.append(f'<h3>bird #{i}: no sprite (extraction failed)</h3>'); continue
    a=Image.open(a); bb=pd2/f'bird_{i:02d}.png'; bimg=Image.open(bb) if (bb.exists() and b in regen) else None
    h=a.height*(2 if bimg else 1)+(70 if bimg else 36); sheet=Image.new('RGB',(a.width,h),(24,24,24)); dr=ImageDraw.Draw(sheet); sheet.paste(a,(0,34))
    tv=tiers.get(b,{}); rv=r1.get(b,{})
    flag=' NO PAINTED BIRD' if b in summ.get('missing',[]) else (' STILL REFUSED' if b in summ.get('still_refused',[]) else '')
    dr.text((6,6),f"#{i}  T{tv.get('tier')}: {str(tv.get('why',''))[:60]}   refit: {rv.get('status','-')}{flag}",font=F,fill=(255,120,120) if flag else (255,255,255))
    if bimg:
        sheet.paste(bimg,(0,a.height+68)); t=t2.get(b,{}); rr=r2.get(b,{}); g=regen.get(b,{})
        dr.text((6,a.height+40),f"AFTER regen ({g.get('why')}) pick {g.get('pick')} score {g.get('score')} pop {g.get('pop')}   T{t.get('tier')}: {str(t.get('why',''))[:50]}   refit: {rr.get('status','-')}",font=F,fill=(255,200,80))
    name=f'bird_{i:02d}.jpg'; sheet.save(O/name,quality=80); assets.append(name); H.append(f'<img src="{{{name}}}">')
html='<!doctype html><meta charset=utf-8><title>'+k+'</title><style>body{font:16px/1.5 -apple-system,system-ui;margin:16px;color:#222;max-width:1300px}img{width:100%;display:block;border:1px solid #ccc;margin:6px 0 18px}</style>'+'\n'.join(H)
for i,a in enumerate(sorted(assets)): html=html.replace('{'+a+'}',f'{i+2:02d}_{a}')
(O/'report.html').write_text(html); print(len(assets),'assets',round(sum((O/a).stat().st_size for a in assets)/1e6,2),'MB')
