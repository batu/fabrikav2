"""Manual regeneration of named birds (Batu's review): intake_manual.py ID BIRD...  -> regen, refit, judge those birds; updates summary."""
import json, os, subprocess, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent; os.environ['LEVEL_SOURCE']='work'
from common import SCRATCH, tag
k=sys.argv[1]; birds=sys.argv[2:]; S=SCRATCH/'intake'/k
PY=['uv','run','--project','/Users/base/dev/appletolye/fabrikav2/tools/level-editor','python']
def sh(*a,**env):
    r=subprocess.run([*PY,*map(str,a)],cwd=HERE,env={**os.environ,**{x:str(v) for x,v in env.items()}},capture_output=True,text=True)
    if r.returncode: print(r.stdout[-1500:],r.stderr[-2000:],file=sys.stderr); raise SystemExit(str(a[0])+' failed')
    return r.stdout
json.dump({k:{b:{'tier':4,'why':'manual: Batu'} for b in birds}},open(S/'tiers_manual.json','w')); json.dump([],open(S/'refit_manual.json','w'))
sh('intake_regen.py',S/'tiers_manual.json',S/'refit_manual.json',k,REGEN_OUT=S/'regen_manual.json')
sh('refit_all.py',k,ONLY=','.join(birds)); rows=json.load(open(SCRATCH/f'refit-rows-{k}.json'))
sh('tierpanels.py',f'intake/{k}/panels2',k,NO_REFIT=1)
t2=json.load(open(S/'tiers2.json')) if (S/'tiers2.json').exists() else {k:{}}
for b in birds: t2.setdefault(k,{})[b]={'tier':None}
json.dump(t2,open(S/'tiers2.json','w')); sh('tier_agy.py',S/'panels2',S/'tiers2.json','--all-none'); t2=json.load(open(S/'tiers2.json'))
summ=json.load(open(S/'summary.json')); summ['manual_regen']=sorted(set(summ.get('manual_regen',[]))|set(birds),key=int)
summ['regenerated']=sorted(set(summ.get('regenerated',[]))|set(birds),key=int)
for b in birds: print(k,'bird',b,'refit',next((r['status'] for r in rows if str(r['bird'])==b),'-'),'judge',t2[k][b])
json.dump(summ,open(S/'summary.json','w'),indent=1)
