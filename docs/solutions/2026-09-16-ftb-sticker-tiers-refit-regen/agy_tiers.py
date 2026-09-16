import json, subprocess, sys, re, concurrent.futures, time
from pathlib import Path
J=Path('.'); PROMPT=('Read the image file {p} with your image viewing tool. It has three panels left to right: the in-game painted bird, the cutout sprite on grey, and the cutout drawn at 50% opacity over the painted bird. Judge how well the cutout matches the painted bird. Tier 1 = matches in shape, size and colour. Tier 2 = same bird and pose but visibly different size (typically smaller) or a shape shift. Tier 3 = right bird, right size, but colour or detail differences (different accessories, missing or extra props, different markings). Tier 4 = different bird, different pose or orientation. Output exactly one JSON object and nothing else, no markdown, no explanation outside it: {{"tier": <1|2|3|4>, "why": "<=20 words"}}')
def judge(p):
    t0=time.time()
    r=subprocess.run(['agy','-p='+PROMPT.format(p=p.resolve()),'--dangerously-skip-permissions','--output-format','json','--print-timeout','3m'],capture_output=True,text=True,cwd=p.parent)
    try:
        resp=json.loads(r.stdout)['response']; m=re.search(r'\{.*\}',resp,re.S); d=json.loads(m.group(0))
        return {'tier':int(d['tier']),'why':d.get('why',''),'s':round(time.time()-t0,1)}
    except Exception as e:
        return {'tier':None,'why':f'error: {e} {r.stdout[-200:]}','s':round(time.time()-t0,1)}
jobs=[p for L in (18,23,25,29) for p in sorted((J/f'L{L}').glob('bird_*.png'))]
out={}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    for p,res in zip(jobs, ex.map(judge, jobs)):
        L=int(p.parent.name[1:]); b=int(p.stem.split('_')[1]); out.setdefault(str(L),{})[str(b)]=res; print(L,b,res['tier'],res['s'],flush=True)
json.dump(out,open(J/'agy-all.json','w'),indent=1)
print('done',sum(len(v) for v in out.values()),'errors',sum(1 for v in out.values() for r in v.values() if r['tier'] is None))
