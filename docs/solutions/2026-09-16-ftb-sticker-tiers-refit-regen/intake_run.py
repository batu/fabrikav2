"""Per-level intake driver (2026-09-16): panels -> gemini judge -> refit -> regenerate (T3/T4 + refit-refused)
-> refit again -> judge the regenerated -> summary. Works on a WORK copy of the session level.json
(<session>/intake_2026-09-16/level.json, LEVEL_SOURCE=work) so nothing touches canonical files;
intake_apply.py merges the result onto the export by dog id after export.
usage: intake_run.py IDS...   (env: OPENROUTER_API_KEY, OPENAI_API_KEY)
"""
import json, os, re, subprocess, sys, shutil
MISSING=re.compile(r'(no|missing|absent|not present|lacks?|does not exist|nothing)\b[^.]*\b(painted|scene|background|in.game|reference|original)|(painted|scene|background|in.game|reference|original)\b[^.]*\b(missing|absent|no bird|not present|lacks (a |the )?bird|does not (exist|contain)|empty)',re.I)
from pathlib import Path
HERE=Path(__file__).resolve().parent
os.environ['LEVEL_SOURCE']='work'
from common import ROOT, SCRATCH, sdir, pub, tag
STAMP='2026-09-16'
PY=[ 'uv','run','--project','/Users/base/dev/appletolye/fabrikav2/tools/level-editor','python']
def sh(*args, **env):
    e={**os.environ,**{k:str(v) for k,v in env.items()}}
    r=subprocess.run([*PY,*[str(a) for a in args]],cwd=HERE,env=e,capture_output=True,text=True)
    if r.returncode!=0: print(r.stdout[-2000:],r.stderr[-3000:],file=sys.stderr); raise SystemExit(f'{args[0]} failed')
    return r.stdout
def init(k):
    w=sdir(k)/f'intake_{STAMP}'; w.mkdir(exist_ok=True)
    if not (w/'level.json').exists(): shutil.copy2(sdir(k)/'level.json', w/'level.json')
    for f in ('color.png','bg_00.png'):
        if not (w/f).exists() and (sdir(k)/f).exists(): os.symlink(sdir(k)/f, w/f)
    return w
def judge(k, panels, tiers_path, only=None):
    level=json.load(open(pub(k)/'level.json'))
    t=json.load(open(tiers_path)) if tiers_path.exists() else {}
    for i in range(len(level['dogs'])):
        if only is None or i in only: t.setdefault(str(k),{}).setdefault(str(i),{'tier':None})
    json.dump(t,open(tiers_path,'w'),indent=1)
    sh('tier_agy.py',panels,tiers_path,'--all-none')
    return json.load(open(tiers_path))
for k in sys.argv[1:]:
    w=init(k); S=SCRATCH/'intake'/k; S.mkdir(parents=True,exist_ok=True)
    print(tag(k),'panels',flush=True); sh('tierpanels.py',f'intake/{k}/panels',k,NO_REFIT=1)
    tiers=judge(k,S/'panels',S/'tiers.json'); n=len(tiers[k]); regen_j={i for i,v in tiers[k].items() if v.get('tier') in (3,4)}
    print(tag(k),'judge: keep',n-len(regen_j),'regenerate',len(regen_j),flush=True)
    out=sh('refit_all.py',k); rows=json.load(open(SCRATCH/f'refit-rows-{k}.json')); shutil.copy2(SCRATCH/f'refit-rows-{k}.json',S/'refit1.json')
    refused={str(r['bird']) for r in rows if r['status']!='applied'}
    strong={str(r['bird']) for r in rows if r['status']=='applied' and r.get('pop',99)<=25}
    regen_j={b for b in regen_j if not (tiers[k][b].get('tier')==3 and b in strong)}
    print(tag(k),'refit: applied',n-len(refused),'refused',sorted(refused,key=int),flush=True)
    missing={i for i,v in tiers[k].items() if v.get('tier') in (3,4) and MISSING.search(str(v.get('why','')))}
    regen=sorted((regen_j|refused)-missing,key=int)
    summary=dict(id=k,birds=n,judge_regen=sorted(regen_j,key=int),refit_refused=sorted(refused,key=int),missing=sorted(missing,key=int),regen=regen)
    print(tag(k),'no painted bird (judge):',sorted(missing,key=int),flush=True)
    if regen:
        tr={k:{b:v for b,v in tiers[k].items() if b not in missing}}; json.dump(tr,open(S/'tiers_regen.json','w'))
        rows_f=[r for r in rows if str(r['bird']) not in missing]; json.dump(rows_f,open(S/'refit1_regen.json','w'))
        sh('intake_regen.py',S/'tiers_regen.json',S/'refit1_regen.json',k,REGEN_OUT=S/'regen.json')
        recs=json.load(open(S/'regen.json')); done={str(r['bird']) for r in recs if r.get('sprite')}
        out=sh('refit_all.py',k,ONLY=','.join(sorted(done))); rows2=json.load(open(SCRATCH/f'refit-rows-{k}.json')); shutil.copy2(SCRATCH/f'refit-rows-{k}.json',S/'refit2.json')
        refused2={str(r['bird']) for r in rows2 if r['status']!='applied' and str(r['bird']) in done}
        sh('tierpanels.py',f'intake/{k}/panels2',k,NO_REFIT=1)
        # judge only the regenerated birds, into tiers2.json
        t2=judge(k,S/'panels2',S/'tiers2.json',only={int(b) for b in done}) if done else {}
        strong2={str(r['bird']) for r in rows2 if r['status']=='applied' and r.get('pop',99)<=25}
        still={b for b,v in t2.get(k,{}).items() if v.get('tier')==4 or (v.get('tier')==3 and b not in strong2)}
        missing2={b for b,v in t2.get(k,{}).items() if v.get('tier') in (3,4) and MISSING.search(str(v.get('why','')))}
        summary['missing']=sorted(missing|missing2,key=int); still-=missing2
        summary.update(regenerated=sorted(done,key=int),regen_errors=[(r['bird'],r.get('error')) for r in recs if r.get('error')],
                       after_refit_refused=sorted(refused2,key=int),after_judge_regen=sorted(still,key=int),still_refused=sorted(still|refused2,key=int))
    json.dump(summary,open(S/'summary.json','w'),indent=1); print(tag(k),'SUMMARY',json.dumps(summary),flush=True)
