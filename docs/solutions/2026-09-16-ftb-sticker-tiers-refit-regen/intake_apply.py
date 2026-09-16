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
    # the loop wrote refit/regen into the session level.json (pub() has no work branch)
    work=json.load(open(sdir(k)/'level.json')); pubdir=ROOT/'public/levels'/k; lp=pubdir/'level.json'; level=json.load(open(lp))
    # canonical exports use bird UUIDs and their own slots; the work copy uses dog_NN by index. Match on the hitbox point.
    def near(d):
        best=min(range(len(work['dogs'])),key=lambda i:(work['dogs'][i]['x']-d['x'])**2+(work['dogs'][i]['y']-d['y'])**2)
        wdg=work['dogs'][best]; return best if ((wdg['x']-d['x'])**2+(wdg['y']-d['y'])**2)**0.5<=d.get('r',57) else None
    match={d['id']:near(d) for d in level['dogs']}
    unmatched=[d['compatibilitySlot'] for d in level['dogs'] if match[d['id']] is None]
    assert not unmatched, f'{k}: export hitboxes without a session match: {unmatched}'
    summ=SCRATCH/'intake'/k/'summary.json'; missing=set(json.load(open(summ)).get('missing',[])) if summ.exists() else set()
    n_regen=n_refit=0
    for d in level['dogs']:
        w=work['dogs'][match[d['id']]]
        if not w.get('sprite') or not d.get('sprite'): continue
        sp=d['sprite']; ws=w['sprite']
        for f in FIELDS:
            if f in ws: sp[f]=ws[f]
        # cleanup follows the final sprite box (x1.15, min 2r, always containing the hitbox disc) — fix2 rule
        r=d.get('r',57); W,H=level['width'],level['height']; x,y,w,h=sprite_xy(d); cx,cy=x+w/2,y+h/2; pw,ph=max(w*1.15,2*r),max(h*1.15,2*r)
        if not (x<=d['x']<=x+w and y<=d['y']<=y+h): cx,cy=d['x'],d['y']
        x0=min(max(0,cx-pw/2),d['x']-r); y0=min(max(0,cy-ph/2),d['y']-r); x1=max(min(W,cx+pw/2),d['x']+r); y1=max(min(H,cy+ph/2),d['y']+r)
        sp['cleanup']={'x':int(max(0,x0)),'y':int(max(0,y0)),'width':int(min(W,x1)-max(0,x0)),'height':int(min(H,y1)-max(0,y0))}
        if 'technique' in ws and ws['technique'].startswith('gpt-image-2.5'):
            src=sdir(k)/ws['image'].split(f'levels/{k}/')[1]; dst=pubdir/sp['image'].split(f'levels/{k}/')[1]; shutil.copy2(src,dst); n_regen+=1
        elif 'refit' in ws: n_refit+=1
    nosprite={str(i) for i,d in enumerate(work['dogs']) if not d.get('sprite')}; missing|=nosprite
    dropped=[d for d in level['dogs'] if str(match[d['id']]) in missing]
    if dropped:
        json.dump(dropped,open(pubdir/'dropped_no_painted_bird_2026-09-16.json','w'),indent=1)
        level['dogs']=[d for d in level['dogs'] if str(match[d['id']]) not in missing]
    tmp=lp.with_suffix('.json.tmp'); tmp.write_text(json.dumps(level,indent=2)+'\n'); os.replace(tmp,lp)
    print(k,'applied: regenerated',n_regen,'refit-only',n_refit,'dropped (no painted bird)',len(dropped))
