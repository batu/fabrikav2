"""Intake progress report for Portal (2026-09-16). usage: intake_report.py OUTDIR [SHAKEDOWN_ID] [CONTACT_IDS...]"""
from common import *
from PIL import ImageFont
F=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',22); F2=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
os.environ['LEVEL_SOURCE']='work'
O=Path(sys.argv[1]); O.mkdir(parents=True,exist_ok=True); sid=sys.argv[2]; contacts=sys.argv[3:]; assets=[]; H=[]
SP=SCRATCH/'intake'; batch=[json.loads(l) for l in open(SP/'extract_batch.out')]; first=json.load(open(sdir(sid)/'intake_2026-09-16'/'extract_result.json'))
n_lv=len(batch)+1; n_b=sum(r.get('materialized',0) for r in batch)+first['result']['materialized']; deg=sum(r.get('degradedToFreeChain',0) for r in batch)+first['result'].get('degradedToFreeChain',0)
H.append(f'<h1>FTB intake: progress {time.strftime("%H:%M UTC",time.gmtime())}</h1><p>Extract All (sunburst low, visible part only, new keying) done on <b>{n_lv} of 60</b> levels, <b>{n_b} birds</b>, {deg} fell back to the free extractor. Mean {round(sum(r["seconds"] for r in batch)/max(1,len(batch)))} s per level.</p>')
# shakedown
S=SP/sid; tiers=json.load(open(S/'tiers.json'))[sid]; t2=json.load(open(S/'tiers2.json'))[sid] if (S/'tiers2.json').exists() else {}
r1=json.load(open(S/'refit1.json')); r2=json.load(open(S/'refit2.json')) if (S/'refit2.json').exists() else []; regen=json.load(open(S/'regen.json')) if (S/'regen.json').exists() else []
ref1={str(r['bird']):r['status'] for r in r1}; ref2={str(r['bird']):r['status'] for r in r2}
H.append(f'<h2>Shakedown level: {sid}</h2><p>{len(tiers)} birds. Judge (gemini): keep {sum(1 for v in tiers.values() if v["tier"] in (1,2))}, regenerate {sum(1 for v in tiers.values() if v["tier"] in (3,4))}. Refit: applied {sum(1 for s in ref1.values() if s=="applied")}, refused {sorted(b for b,s in ref1.items() if s!="applied")}. Regenerated {sum(1 for r in regen if r.get("sprite"))} birds (judge T3/T4 plus refit-refused). After: refit refused {sorted(b for b,s in ref2.items() if s!="applied" and any(str(r["bird"])==b for r in regen))}, second judge {"pending" if not t2 else {b:v["tier"] for b,v in t2.items()}}.</p><p>Rows per regenerated bird: BEFORE = painted | first extraction on grey | 50% overlay; AFTER = painted | regenerated sprite on grey | 50% overlay.</p>')
pd=S/'panels'/f'L{sid}'; pd2=S/'panels2'/f'L{sid}'
for r in regen:
    b=r['bird']; a=Image.open(pd/f'bird_{b:02d}.png'); bb=(pd2/f'bird_{b:02d}.png'); bimg=Image.open(bb) if bb.exists() else None
    sheet=Image.new('RGB',(a.width,a.height*2+70),(24,24,24)); dr=ImageDraw.Draw(sheet); sheet.paste(a,(0,34))
    if bimg: sheet.paste(bimg,(0,a.height+68))
    why=r.get('why','')+('' if r.get('sprite') else '  ERROR '+str(r.get('error'))[:60])
    dr.text((6,6),f"bird #{b}  {why}   judge T{tiers[str(b)]['tier']}: {tiers[str(b)]['why'][:50]}   refit: {ref1.get(str(b))}",font=F2,fill=(255,255,255))
    dr.text((6,a.height+40),f"AFTER  pick {r.get('pick')} score {r.get('score')} pop {r.get('pop')}   refit: {ref2.get(str(b),'-')}   judge: {('T%s: %s'%(t2[str(b)]['tier'],t2[str(b)]['why'][:50])) if str(b) in t2 else 'pending'}",font=F2,fill=(255,200,80))
    name=f'regen_{b:02d}.jpg'; sheet.save(O/name,quality=80); assets.append(name); H.append(f'<img src="{{{name}}}">')
# contact sheets of fresh extractions
for k in contacts:
    d=sdir(k)/'.canonical'/'staging'/'singles'; fs=sorted(d.glob('single-*.png'))
    if not fs: continue
    T=170; cols=8; rows=(len(fs)+cols-1)//cols; sheet=Image.new('RGB',(cols*T,rows*(T+16)),(128,128,128)); dr=ImageDraw.Draw(sheet)
    for n,f in enumerate(fs):
        im=Image.open(f).convert('RGBA'); im.thumbnail((T-8,T-8)); x,y=(n%cols)*T,(n//cols)*(T+16); sheet.paste(im,(x+4,y+4),im); dr.text((x+4,y+T-2),f.name[7:9],font=F2,fill=(255,255,0))
    name=f'contact_{k[:40]}.jpg'; sheet.save(O/name,quality=78); assets.append(name); H.append(f'<h2>Fresh stickers: {k}</h2><img src="{{{name}}}">')
html='<!doctype html><meta charset=utf-8><title>FTB intake progress</title><style>body{font:16px/1.5 -apple-system,system-ui;margin:16px;color:#222;max-width:1300px}img{width:100%;display:block;border:1px solid #ccc;margin:6px 0 18px}</style>'+'\n'.join(H)
for i,a in enumerate(sorted(assets)): html=html.replace('{'+a+'}',f'{i+2:02d}_{a}')  # portal numbers uploads in the order given: pass them sorted
(O/'report.html').write_text(html); print(len(assets),'assets',round(sum((O/a).stat().st_size for a in assets)/1e6,2),'MB')
