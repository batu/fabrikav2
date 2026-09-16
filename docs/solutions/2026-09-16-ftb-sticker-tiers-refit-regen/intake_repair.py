"""Repair canonical snapshots so export validates (2026-09-16): (1) sprite asset paths whose file sha does not match
are re-pointed to the dogs/*/ file that carries that sha (slot/folder shuffle from promotion); (2) a cleanup rect that
does not contain its own pickup point is grown to include the hitbox disc. Then hitbox + final reviews are re-blessed
with the delegated actor. usage: intake_repair.py IDS..."""
from common import *
import hashlib
editor_api()
from levelbuilder.api import session as S
from levelbuilder.api import canonical_export as CE
from levelbuilder.api.canonical_bird_contract import invalidate_reviews
ACTOR='human:batu-delegated:intake-2026-09-16'
for k in sys.argv[1:]:
    cur=S.read_canonical_session(k); snap=copy.deepcopy(cur.snapshot) if cur.snapshot else None
    if not snap: print(k,'no snapshot'); continue
    sd=S.session_dir(k); changed=[]
    shas={}
    for p in sd.glob('dogs/*/sprite_*.png'): shas.setdefault(hashlib.sha256(p.read_bytes()).hexdigest(),str(p.relative_to(sd)))
    for b in snap['birds']:
        a=(b.get('sprite') or {}).get('asset')
        if not a: continue
        p=sd/a['path']
        if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=a['sha256']:
            if a['sha256'] in shas: a['path']=shas[a['sha256']]; changed.append(('path',b['compatibilitySlot'],a['path']))
            else: changed.append(('MISSING-ASSET',b['compatibilitySlot'],a['path']))
    with Image.open(sd/'color.png') as im: w,h=im.size
    birds=[b for b in snap['birds'] if b.get('cleanup')]
    def sites(): return [CE.CleanupSite(bird_id=b['birdId'],x=b['hitbox']['x'],y=b['hitbox']['y'],cleanup=CE.Rect(b['cleanup']['x'],b['cleanup']['y'],b['cleanup']['x']+b['cleanup']['width'],b['cleanup']['y']+b['cleanup']['height'])) for b in birds]
    for b in birds:
        ss=sites(); s=next(x for x in ss if x.bird_id==b['birdId'])
        c=b['cleanup']; hb=b['hitbox']; raw_ok=c['x']<=hb['x']<=c['x']+c['width'] and c['y']<=hb['y']<=c['y']+c['height']
        if raw_ok and any(CE._point_in_polygon(CE.Point(s.x,s.y),p) for p in CE.cleanup_polygons_for_site(s,ss,w,h,lambda _o: True)): continue
        hb=b['hitbox']; c=b['cleanup']; r=hb['r']
        x0=min(c['x'],hb['x']-r); y0=min(c['y'],hb['y']-r); x1=max(c['x']+c['width'],hb['x']+r); y1=max(c['y']+c['height'],hb['y']+r)
        x0=max(0,x0); y0=max(0,y0); x1=min(w,x1); y1=min(h,y1)
        b['cleanup'].update({'x':int(x0),'y':int(y0),'width':int(x1-x0),'height':int(y1-y0)}); changed.append(('cleanup',b['compatibilitySlot']))
    if not changed: print(k,'clean'); continue
    if any(c[0]=='MISSING-ASSET' for c in changed): print(k,'UNREPAIRABLE',[c for c in changed if c[0]=='MISSING-ASSET']); continue
    arts={'cleanup'} if any(c[0]=='cleanup' for c in changed) else set()
    if any(c[0]=='path' for c in changed): arts|={'spritePixels'}
    # reviews must be invalidated on the still-valid original, then the edits re-applied
    fixed={b['birdId']:b for b in snap['birds']}
    snap=invalidate_reviews(copy.deepcopy(cur.snapshot),changed_artifacts=arts)
    for b in snap['birds']:
        f=fixed[b['birdId']]
        if b.get('cleanup'): b['cleanup'].update({x:f['cleanup'][x] for x in ('x','y','width','height')})
        if (b.get('sprite') or {}).get('asset'): b['sprite']['asset']['path']=f['sprite']['asset']['path']
    store=S.canonical_session_store(k)
    store.commit(snap,expected_content_revision=cur.pointer.content_revision,expected_operational_revision=cur.pointer.operational_revision)
    cur=S.read_canonical_session(k)
    S.set_canonical_hitbox_review_if_present(k,True,expected_content_revision=cur.pointer.content_revision,reviewer=ACTOR)
    cur=S.read_canonical_session(k)
    S.set_canonical_final_review_if_present(k,True,expected_content_revision=cur.pointer.content_revision,reviewer=ACTOR)
    print(k,'repaired',{'path':sum(1 for c in changed if c[0]=='path'),'cleanup':sum(1 for c in changed if c[0]=='cleanup')},flush=True)
