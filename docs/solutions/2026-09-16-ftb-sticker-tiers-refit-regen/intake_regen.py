"""Regenerate the regenerate-class birds of session-addressed levels (intake 2026-09-16).

usage: intake_regen.py TIERS_JSON REFIT_ROWS_JSON IDS...
Regenerate class = judge tier 3/4 OR refit refused (any status != applied). Two sunburst-low
visible-part passes per bird (hitbox/VLM crop, then the painted-extent-grown crop when it is
bigger); the cutout with the better masked match score wins. Writes the sprite + box into the
level.json under pub(id) (LEVEL_SOURCE=work -> the intake work dir). Raw renders are saved in
<session>/dogs/dog_NN/regen_2026-09-16/.
"""
from common import *
import concurrent.futures
I=editor_api()
from merceka_core.image import edit_image
STAMP='2026-09-16'
tiers=json.load(open(sys.argv[1])); rows=json.load(open(sys.argv[2])); ids=sys.argv[3:]
refused={(r['level'],r['bird']) for r in rows if r['status']!='applied'}
def targets(k):
    level=json.load(open(pub(k)/'level.json')); out=[]
    for i,d in enumerate(level['dogs']):
        t=(tiers.get(str(k),{}).get(str(i)) or {}).get('tier')
        why=[]
        if t in (3,4): why.append(f'T{t}')
        if (k,i) in refused: why.append('refit refused')
        if why: out.append((k,i,'+'.join(why)))
    return out
def one(k,i,why):
    try: return _one(k,i,why)
    except Exception as e: return dict(level=k,bird=i,why=why,error=f'{type(e).__name__}: {str(e)[:160]}')
def _one(k,i,why):
    p=pub(k); level=json.load(open(p/'level.json')); d=level['dogs'][i]; color=Image.open(p/'color.png').convert('RGB'); clean=clean_plate(k,color.size)
    hb={'x':d['x'],'y':d['y'],'r':d.get('r',57),'id':d['id']}
    dets=I._load_vlm_detections(level_id(k))
    b1=I.extract_box_for_hitbox(hb,dets,1.6)
    ext=I.painted_extent_detections(level_id(k),[hb]); b2=I._grow_box_by_extent(b1,ext[0]) if ext else b1
    cap=float(os.environ.get('MAX_CROP_R','0'))*hb['r']   # cap the grown crop (plate-diff extents can span the scene)
    if cap and b2['width']>cap: c=(b2['x']+b2['width']/2,b2['y']+b2['height']/2); b2={**b2,'x':int(c[0]-cap/2),'y':int(c[1]-cap/2),'width':int(cap),'height':int(cap)}
    save=sdir(k)/'dogs'/f'dog_{i:02d}'/f'regen_{STAMP}'; save.mkdir(parents=True,exist_ok=True)
    runs=[]
    for tag_,b in (('crop',b1),('crop2',b2)):
        if tag_=='crop2' and (b['x'],b['y'],b['width'],b['height'])==(b1['x'],b1['y'],b1['width'],b1['height']): continue
        cb=(int(b['x']),int(b['y']),int(b['x']+b['width']),int(b['y']+b['height'])); crop=color.crop(cb); crop.save(save/f'{tag_}.png')
        t0=time.time(); flat=edit_image(crop,REGEN_PROMPT,model=REGEN_MODEL,quality='low'); dt=time.time()-t0; flat.save(save/f'{tag_}_flat.png')
        cut,holes=rebuild_cutout(flat); cut.save(save/f'{tag_}_cutout.png')
        fit=I.fit_sprite_to_painted(cut,crop,clean.crop(cb))
        runs.append(dict(pass_=tag_,crop=cb,seconds=round(dt,1),holes=holes,fit=fit,size=cut.size))
    ok=[r for r in runs if r['fit']]
    rec=dict(level=k,bird=i,why=why,runs=runs)
    if not ok: rec['error']='no fit'; return rec
    best=max(ok,key=lambda r:r['fit']['score']); f=best['fit']; cb=best['crop']; cut=Image.open(save/f"{best['pass_']}_cutout.png").convert('RGBA')
    sx,sy,sw,sh=cb[0]+f['x'],cb[1]+f['y'],f['width'],f['height']; ax,ay=(d['x']-sx)/sw,(d['y']-sy)/sh
    rel=f'dogs/dog_{i:02d}/sprite_regen_{STAMP}.png'; ship_sprite(cut,sw,sh,p/rel)
    sp=d['sprite']; sp.update({'image':f'levels/{level_id(k)}/{rel}','x':sx,'y':sy,'width':sw,'height':sh,'anchorX':round(ax,4),'anchorY':round(ay,4),'technique':'gpt-image-2.5-sunburst-low-visible-only','regen':{'pass':best['pass_'],'score':f['score'],'pop':f['pop'],'why':why}})
    rec.update(pick=best['pass_'],score=f['score'],pop=f['pop'],inside=0<=ax<=1 and 0<=ay<=1,sprite=sp)
    return rec
out=[]
for k in ids:
    T=targets(k); print(tag(k),'regenerate',len(T),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex: recs=list(ex.map(lambda t: one(*t), T))
    level=json.load(open(pub(k)/'level.json'))
    for r in recs:
        if r.get('sprite'): level['dogs'][r['bird']]['sprite']=r['sprite']
    tmp=pub(k)/'level.json.tmp'; tmp.write_text(json.dumps(level,indent=2)); os.replace(tmp,pub(k)/'level.json')
    out+=recs
    print(tag(k),'done',sum(1 for r in recs if r.get('sprite')),'errors',[(r['bird'],r.get('error')) for r in recs if r.get('error')],flush=True)
o=Path(os.environ.get('REGEN_OUT',SCRATCH/'intake'/'regen.json')); o.parent.mkdir(parents=True,exist_ok=True); json.dump(out,open(o,'w'),indent=1,default=str)
