"""OpenRouter fallback for the agy tier judge: same prompt, gemini-3.8-flash, fills tier=None entries in a tier json. usage: tier_openrouter.py PANELS_DIR TIER_JSON [--all-none|L#b ...]"""
import sys, json, re, concurrent.futures, time
from pathlib import Path
sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor')
from merceka_core.llm import LLM
PROMPT=('The image has three panels left to right: the in-game painted bird, the cutout sprite on grey, and the cutout drawn at 50% opacity over the painted bird. Judge how well the cutout matches the painted bird. Tier 1 = matches in shape, size and colour. Tier 2 = same bird and pose but visibly different size (typically smaller) or a shape shift. Tier 3 = right bird, right size, but colour or detail differences (different accessories, missing or extra props, different markings). Tier 4 = different bird, OR the same bird in a different pose, orientation or facing direction (a pose or facing change is always tier 4, never tier 3). Output exactly one JSON object and nothing else, no markdown, no explanation outside it: {"tier": <1|2|3|4>, "why": "<=20 words"}')
D=Path(sys.argv[1]); J=Path(sys.argv[2]); a=json.load(open(J)) if J.exists() else {}
targets=[(L,b) for L in a for b in a[L] if a[L][b].get('tier') is None] if sys.argv[3:4]==['--all-none'] else [tuple(x.split('#')) for x in sys.argv[3:]]
def judge(L,b):
    t0=time.time()
    try:
        llm=LLM(model_name='openrouter/'+__import__('os').environ.get('TIER_MODEL','google/gemini-3.8-flash'),system_prompt=PROMPT)
        r=llm.generate_with_resource('Judge the attached panel.',resource_path=D/f'L{L}'/f'bird_{int(b):02d}.png',temperature=0.0,max_tokens=4000,**({'reasoning':{'effort':__import__('os').environ['TIER_REASONING']}} if __import__('os').environ.get('TIER_REASONING') else {}))
        m=re.search(r'\{.*\}',r if isinstance(r,str) else str(r),re.S); d=json.loads(m.group(0))
        return {'tier':int(d['tier']),'why':'[openrouter] '+d.get('why',''),'s':round(time.time()-t0,1)}
    except Exception as e:
        return {'tier':None,'why':f'openrouter error: {str(e)[:120]}','s':round(time.time()-t0,1)}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
    for (L,b),res in zip(targets, ex.map(lambda t: judge(*t), targets)):
        a.setdefault(str(L),{})[str(b)]=res; print(L,b,res['tier'],res['s'],res['why'][:60],flush=True)
json.dump(a,open(J,'w'),indent=1); print('done',len(targets),'still None',sum(1 for L in a for b in a[L] if a[L][b].get('tier') is None))
