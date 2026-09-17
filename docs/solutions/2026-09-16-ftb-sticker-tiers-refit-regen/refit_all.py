"""Refit every sticker (uniform scale 0.6-2.0 + translation) and write level.json; skip on pop>45 / hitbox outside / no overlap. usage: refit_all.py LEVELS..."""
from common import *
sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor')
import levelbuilder.api.inpaint as I; I._FIT_SCALES=tuple(round(0.6+i*0.05,2) for i in range(29))
from levelbuilder.api.inpaint import fit_sprite_to_painted
import cv2
def fit_aniso(sprite, painted, clean_crop):
    """Uniform ladder (editor code), then width:height ratio 0.80..1.25 at that size, then one uniform nudge. Same masked SQDIFF + pop as the editor."""
    base=fit_sprite_to_painted(sprite,painted,clean_crop)
    if not base: return None
    rgba=np.asarray(sprite.convert('RGBA'),np.uint8); src_rgb,src_a=rgba[...,:3],rgba[...,3]; scene=np.asarray(painted.convert('RGB'),np.uint8); sh,sw=scene.shape[:2]
    clean=np.asarray(clean_crop.convert('RGB'),np.int16); changed=(np.abs(scene.astype(np.int16)-clean).sum(2)>40) if clean.shape==scene.shape else None
    def match(w,h):
        if w>sw or h>sh or w<2 or h<2: return None
        rgb=cv2.resize(src_rgb,(w,h),interpolation=cv2.INTER_AREA); a=cv2.resize(src_a,(w,h),interpolation=cv2.INTER_AREA); mask=np.repeat((a>8)[:,:,None],3,2).astype(np.uint8)*255
        if not mask.any(): return None
        e=cv2.matchTemplate(scene,rgb,cv2.TM_SQDIFF_NORMED,mask=mask); e=np.nan_to_num(e,nan=1.0,posinf=1.0,neginf=1.0); y,x=np.unravel_index(int(np.argmin(e)),e.shape)
        return (1.0-min(float(e[y,x]),1.0),int(x),int(y),w,h)
    s=base['scale']; best=None
    for r in [round(0.8+0.05*k,2) for k in range(10)]:
        for s2 in (s-0.05,s,s+0.05):
            m=match(int(round(sprite.width*s2*r**0.5)),int(round(sprite.height*s2/r**0.5)))
            if m and (best is None or m>best): best=m+(s2,r)
    score,x,y,w,h,s2,r=best
    rgb=cv2.resize(src_rgb,(w,h),interpolation=cv2.INTER_AREA).astype(np.int16); a=cv2.resize(src_a,(w,h),interpolation=cv2.INTER_AREA)>128; region=scene[y:y+h,x:x+w].astype(np.int16); meas=a
    if changed is not None:
        ob=a&changed[y:y+h,x:x+w]
        if ob.sum()>=max(64,0.2*a.sum()): meas=ob
    pop=float(np.abs(rgb[meas]-region[meas]).mean()) if meas.any() else 255.0
    return {'score':round(score,4),'scale':s2,'ratio':r,'x':x,'y':y,'width':w,'height':h,'pop':round(pop,1)}
rows=[]
for n in [key(x) for x in sys.argv[1:]]:
    p=pub(n); level=json.load(open(p/'level.json')); color=Image.open(p/'color.png').convert('RGB'); sdir=ROOT/'.levelbuilder/levels'/level_id(n); raw=json.load(open(sdir/'session.json'))
    clean=Image.open(sdir/f"bg_{raw['selected_bg']:02d}.png").convert('RGB')
    if clean.size!=color.size: clean=clean.resize(color.size,Image.LANCZOS)
    only=set(int(v) for v in os.environ['ONLY'].split(',') if v) if os.environ.get('ONLY') else None
    def one(i,d):
        if not d.get('sprite'): return dict(level=n,bird=i,status='skipped: no sprite')
        sp=d['sprite']; w,h=int(sp['width']),int(sp['height']); x=d['x']-sp.get('anchorX',0.5)*w; y=d['y']-sp.get('anchorY',0.5)*h
        spr=Image.open(sprite_path(n,sp)).convert('RGBA').resize((w,h),Image.LANCZOS)
        pad=int(max(w,h)*0.8); cb=(int(max(0,x-pad)),int(max(0,y-pad)),int(min(color.width,x+w+pad)),int(min(color.height,y+h+pad)))
        f=fit_aniso(spr,color.crop(cb),clean.crop(cb)) if not os.environ.get('UNIFORM') else dict(fit_sprite_to_painted(spr,color.crop(cb),clean.crop(cb)) or {},ratio=1.0) or None
        if not f: return dict(level=n,bird=i,status='skipped: no fit')
        rx,ry,rw,rh=cb[0]+f['x'],cb[1]+f['y'],f['width'],f['height']; ax,ay=(d['x']-rx)/rw,(d['y']-ry)/rh
        inside=0<=ax<=1 and 0<=ay<=1; overlap=rx<x+w and x<rx+rw and ry<y+h and y<ry+rh
        status='applied' if f['pop']<=45 and inside and overlap else 'skipped: '+('pop %.0f'%f['pop'] if f['pop']>45 else 'hitbox outside' if not inside else 'no overlap')
        if status=='applied': sp.update({'width':rw,'height':rh,'anchorX':round(ax,4),'anchorY':round(ay,4),'refit':{'scale':f['scale'],'ratio':f['ratio'],'pop':f['pop'],'dx':int(rx-x),'dy':int(ry-y)}})
        return dict(level=n,bird=i,status=status,scale=f['scale'],ratio=f['ratio'],pop=f['pop'],dx=int(rx-x),dy=int(ry-y))
    import concurrent.futures
    todo=[(i,d) for i,d in enumerate(level['dogs']) if only is None or i in only]
    with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get('REFIT_WORKERS','4'))) as ex: rows+=list(ex.map(lambda t: one(*t), todo))
    (p/'level.json').write_text(json.dumps(level,indent=2)); print(n,flush=True)
json.dump(rows,open(SCRATCH/('refit-rows-%s.json'%'-'.join(sys.argv[1:])),'w'),indent=1)
import collections; a=[r for r in rows if r['status']=='applied']
print(collections.Counter(r['status'].split(':')[0] for r in rows)); print('applied scale: <0.9',sum(r['scale']<0.9 for r in a),' 0.9-1.1',sum(0.9<=r['scale']<=1.1 for r in a),' >1.1',sum(r['scale']>1.1 for r in a),' ratio!=1',sum(r['ratio']!=1.0 for r in a),' moved>10px',sum(max(abs(r['dx']),abs(r['dy']))>10 for r in a))
print('skipped:',[(r['level'],r['bird'],r['status']) for r in rows if r['status']!='applied'])
