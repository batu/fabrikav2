"""Merge the intake work result onto the exported level by dog id (2026-09-16).
usage: intake_apply.py IDS...
For each dog: copy refit/regen sprite fields (x, y, width, height, anchorX, anchorY, refit, regen,
technique) from <session>/intake_2026-09-16/level.json into public/levels/<id>/level.json and, for a
regenerated bird, overwrite public/levels/<id>/dogs/dog_NN/sprite_000.png with the regenerated sprite.
Refuses when the export's dog ids or hitboxes differ from the work copy (stale work)."""
from common import *
STAMP='2026-09-16'
FIELDS=('x','y','width','height','anchorX','anchorY','refit','regen','technique')
for k in sys.argv[1:]:
    work=json.load(open(sdir(k)/f'intake_{STAMP}'/'level.json')); pubdir=ROOT/'public/levels'/k; lp=pubdir/'level.json'; level=json.load(open(lp))
    wd={d['id']:d for d in work['dogs']}
    assert [d['id'] for d in level['dogs']]==[d['id'] for d in work['dogs']], f'{k}: dog ids differ between export and work copy'
    summ=SCRATCH/'intake'/k/'summary.json'; missing=set(json.load(open(summ)).get('missing',[])) if summ.exists() else set()
    n_regen=n_refit=0
    for d in level['dogs']:
        w=wd[d['id']]; assert (w['x'],w['y'])==(d['x'],d['y']), f"{k} {d['id']}: hitbox moved since the work copy"
        sp=d['sprite']; ws=w['sprite']
        for f in FIELDS:
            if f in ws: sp[f]=ws[f]
        if 'technique' in ws and ws['technique'].startswith('gpt-image-2.5'):
            src=sdir(k)/ws['image'].split(f'levels/{k}/')[1]; dst=pubdir/sp['image'].split(f'levels/{k}/')[1]; shutil.copy2(src,dst); n_regen+=1
        elif 'refit' in ws: n_refit+=1
    dropped=[d for i,d in enumerate(level['dogs']) if str(i) in missing]
    if dropped:
        json.dump(dropped,open(pubdir/'dropped_no_painted_bird_2026-09-16.json','w'),indent=1)
        level['dogs']=[d for i,d in enumerate(level['dogs']) if str(i) not in missing]
    tmp=lp.with_suffix('.json.tmp'); tmp.write_text(json.dumps(level,indent=2)+'\n'); os.replace(tmp,lp)
    print(k,'applied: regenerated',n_regen,'refit-only',n_refit,'dropped (no painted bird)',len(dropped))
