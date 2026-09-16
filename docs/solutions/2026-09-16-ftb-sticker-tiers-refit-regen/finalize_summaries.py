"""Recompute every intake summary with the final rules (2026-09-16): refit-accepted pop<=25 keeps a T3; no-painted-bird from the
latest judge that saw the bird; sprite-less birds listed. Prints the corpus totals. usage: finalize_summaries.py"""
from common import *
import re
MISSING=re.compile(r'(no|missing|absent|not present|lacks?|does not exist|nothing)\b[^.]*\b(painted|scene|background|in.game|reference|original)|(painted|scene|background|in.game|reference|original)\b[^.]*\b(missing|absent|no bird|not present|lacks (a |the )?bird|does not (exist|contain)|empty)',re.I)
os.environ['LEVEL_SOURCE']='work'
tot=dict(levels=0,birds=0,regenerated=0,missing=0,still=0,nosprite=0)
for k in open(SCRATCH/'intake'/'ids60.txt').read().split():
    S=SCRATCH/'intake'/k
    if not (S/'summary.json').exists(): continue
    s=json.load(open(S/'summary.json')); t=json.load(open(S/'tiers.json'))[k]; t2=json.load(open(S/'tiers2.json'))[k] if (S/'tiers2.json').exists() else {}
    r1={str(r['bird']):r for r in json.load(open(S/'refit1.json'))}; r2={str(r['bird']):r for r in json.load(open(S/'refit2.json'))} if (S/'refit2.json').exists() else {}
    level=json.load(open(pub(k)/'level.json')); nos=[str(i) for i,d in enumerate(level['dogs']) if not d.get('sprite')]
    regen=set(s.get('regenerated',[])); latest={b:(t2[b] if b in t2 else t.get(b,{})) for b in t}; ref={b:(r2[b] if b in r2 else r1.get(b,{})) for b in t}
    missing={b for b,v in latest.items() if v.get('tier') in (3,4) and MISSING.search(str(v.get('why','')))}
    strong={b for b,r in ref.items() if r.get('status')=='applied' and r.get('pop',99)<=25}
    still={b for b,v in latest.items() if b not in missing and (v.get('tier')==4 or (v.get('tier')==3 and b not in strong) or (ref.get(b,{}).get('status','applied')!='applied' and b in regen))}
    s.update(missing=sorted(missing,key=int),still_refused=sorted(still,key=int),no_sprite=nos,rule='pop25-keeps-T3')
    json.dump(s,open(S/'summary.json','w'),indent=1)
    tot['levels']+=1; tot['birds']+=s['birds']; tot['regenerated']+=len(regen); tot['missing']+=len(missing); tot['still']+=len(still); tot['nosprite']+=len(nos)
print(tot)
