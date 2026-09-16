"""Tier judge, agy (Antigravity gemini-3.8-flash) first, OpenRouter gemini-3.8-flash fallback on error/timeout.
Same CLI as tier_openrouter.py: tier_agy.py PANELS_DIR TIER_JSON [--all-none|L#b ...]. Batu 2026-09-16: prioritize agy."""
import sys, json, re, subprocess, concurrent.futures, time, os
from pathlib import Path
PROMPT=('Read the image file {p} with your image viewing tool. It has three panels left to right: the in-game painted bird, the cutout sprite on grey, and the cutout drawn at 50% opacity over the painted bird. Judge how well the cutout matches the painted bird. Tier 1 = matches in shape, size and colour. Tier 2 = same bird and pose but visibly different size (typically smaller) or a shape shift. Tier 3 = right bird, right size, but colour or detail differences (different accessories, missing or extra props, different markings). Tier 4 = different bird, OR the same bird in a different pose, orientation or facing direction (a pose or facing change is always tier 4, never tier 3). Output exactly one JSON object and nothing else, no markdown, no explanation outside it: {{"tier": <1|2|3|4>, "why": "<=20 words"}}')
OR_PROMPT=PROMPT.replace('Read the image file {p} with your image viewing tool. It has','The image has').replace('{{','{').replace('}}','}')
D=Path(sys.argv[1]); J=Path(sys.argv[2]); a=json.load(open(J)) if J.exists() else {}
targets=[(L,b) for L in a for b in a[L] if a[L][b].get('tier') is None] if sys.argv[3:4]==['--all-none'] else [tuple(x.split('#')) for x in sys.argv[3:]]
def agy(p):
    r=subprocess.run(['agy','-p='+PROMPT.format(p=p.resolve()),'--dangerously-skip-permissions','--output-format','json','--print-timeout','4m'],capture_output=True,text=True,cwd=p.parent,timeout=260)
    resp=json.loads(r.stdout)['response']; m=re.search(r'\{.*\}',resp,re.S); d=json.loads(m.group(0)); return int(d['tier']),'[agy] '+d.get('why','')
def openrouter(p):
    sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor'); from merceka_core.llm import LLM
    llm=LLM(model_name='openrouter/google/gemini-3.8-flash',system_prompt=OR_PROMPT)
    r=llm.generate_with_resource('Judge the attached panel.',resource_path=p,temperature=0.0,max_tokens=4000)
    m=re.search(r'\{.*\}',r if isinstance(r,str) else str(r),re.S); d=json.loads(m.group(0)); return int(d['tier']),'[openrouter] '+d.get('why','')
def judge(L,b):
    p=D/f'L{L}'/f'bird_{int(b):02d}.png'; t0=time.time()
    for fn in (agy,openrouter):
        try:
            t,why=fn(p); return {'tier':t,'why':why,'s':round(time.time()-t0,1)}
        except Exception as e: err=f'{fn.__name__}: {str(e)[:100]}'
    return {'tier':None,'why':'error '+err,'s':round(time.time()-t0,1)}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
    for (L,b),res in zip(targets, ex.map(lambda t: judge(*t), targets)):
        a.setdefault(str(L),{})[str(b)]=res; print(L,b,res['tier'],res['s'],res['why'][:60],flush=True)
json.dump(a,open(J,'w'),indent=1); print('done',len(targets),'still None',sum(1 for L in a for b in a[L] if a[L][b].get('tier') is None),'agy',sum(1 for L in a for b in a[L] if str(a[L][b].get('why','')).startswith('[agy]')))
