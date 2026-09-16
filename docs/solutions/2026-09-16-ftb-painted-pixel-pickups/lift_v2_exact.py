import json, os, sys, subprocess, io, numpy as np
from pathlib import Path
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
sys.path.insert(0,'.')
from levelbuilder.api.inpaint import painted_diff_mask, fill_small_holes
from levelbuilder.api import public_levels as P
from levelbuilder.api import session as S
root=Path('../../games/find_the_bird')
pm=json.load(open(os.environ.get('FTB_MANIFEST','../../games/find_the_bird/public/levels/bundled-manifest.json')))
def orig(lid,rel): return (root/'public/levels'/lid/rel).read_bytes()   # original: git show of the shipped sticker level.json; for new levels read the file as exported
shared=[]
for n in [int(v) for v in sys.argv[1:]]:
    lid=pm['levels'][n-1]['id']; pub=root/'public/levels'/lid; sdir=root/'.levelbuilder/levels'/lid; raw=json.load(open(sdir/'session.json'))
    level=json.loads(orig(lid,'level.json')); color=Image.open(pub/'color.png').convert('RGB'); clean=Image.open(sdir/f"bg_{raw['selected_bg']:02d}.png").convert('RGB')
    centers=np.array([[d['x'],d['y']] for d in level['dogs']],float)
    for i,d in enumerate(level['dogs']):
        sp=d['sprite']; w,h=int(sp['width']),int(sp['height']); x=d['x']-sp.get('anchorX',0.5)*w; y=d['y']-sp.get('anchorY',0.5)*h
        pad=int(max(w,h)*0.8); cb=(int(max(0,x-pad)),int(max(0,y-pad)),int(min(color.width,x+w+pad)),int(min(color.height,y+h+pad)))
        pc=color.crop(cb); cc=clean.crop(cb); m=painted_diff_mask(pc,cc)
        if m is None: continue
        ma=np.asarray(m)>0; lab,k=ndi.label(ma); hx,hy=d['x']-cb[0],d['y']-cb[1]; yy,xx=np.ogrid[:ma.shape[0],:ma.shape[1]]; disc=(xx-hx)**2+(yy-hy)**2<=(1.2*57)**2
        ids=np.unique(lab[disc&(lab>0)]); sel=np.isin(lab,ids) if ids.size else ma
        # Voronoi split against other hitboxes: keep only pixels nearer to this centre than to any other
        Y,X=np.mgrid[0:ma.shape[0],0:ma.shape[1]]; gx=X+cb[0]; gy=Y+cb[1]
        d2=(gx-d['x'])**2+(gy-d['y'])**2; own=np.ones_like(sel)
        for j,c in enumerate(centers):
            if j==i: continue
            oth=(gx-c[0])**2+(gy-c[1])**2
            if (sel&(oth<d2)).any(): own&=~(oth<d2); shared.append((n,i,j))
        sel&=own
        lab2,k2=ndi.label(sel); ids2=np.unique(lab2[disc&(lab2>0)]); sel=np.isin(lab2,ids2) if ids2.size else sel
        sel=np.asarray(fill_small_holes(Image.fromarray((ndi.binary_opening(sel,iterations=1)*255).astype(np.uint8))))>0; ys,xs=np.where(sel)
        if not ys.size: continue
        y0,y1,x0,x1=(int(v) for v in (ys.min(),ys.max()+1,xs.min(),xs.max()+1))
        alpha=np.asarray(Image.fromarray((sel[y0:y1,x0:x1]*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)))
        spr=Image.fromarray(np.dstack([np.asarray(pc)[y0:y1,x0:x1],alpha]),'RGBA'); sx,sy=int(cb[0]+x0),int(cb[1]+y0); sw,sh=int(x1-x0),int(y1-y0)
        target=pub/sp['image'].split(f'levels/{lid}/')[1]
        small=spr if max(sw,sh)<=288 else spr.resize((max(1,int(sw*288/max(sw,sh))),max(1,int(sh*288/max(sw,sh)))),Image.LANCZOS); small.save(target,optimize=True)
        sp.update({'width':sw,'height':sh,'anchorX':round(float((d['x']-sx)/sw),4),'anchorY':round(float((d['y']-sy)/sh),4),'x':sx,'y':sy,'technique':'painted-pixels-v2-voronoi'})
    (pub/'level.json').write_text(json.dumps(level,indent=2)); print(n,'done')
prev=S.load_bundled_manifest() or {}; entries=[]
for l in pm['levels']:
    e=P.public_level_manifest_entry(S.GAME_PUBLIC_LEVELS,l['id']); e['bundled']=True; entries.append(e)
P.save_bundled_manifest(S.GAME_PUBLIC_LEVELS,{'version':1,'manifestRevision':int(prev.get('manifestRevision') or 0)+1,'generatedAt':P.utc_now_iso(),'experimentId':'ftd_levelset_v1','levels':entries})
from collections import Counter; c=Counter((a,b) for a,b,_ in shared); print('birds that shared paint with a neighbour:',sorted(c))