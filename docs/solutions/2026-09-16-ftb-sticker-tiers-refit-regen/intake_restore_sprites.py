"""Sprite-footprint restoration (Batu 2026-09-16, level 85): bg_00 = the painted scene with the clean plate showing ONLY under each
bird's own sprite silhouette (alpha > 8, dilated 4 px, feathered 2 px). Nothing outside a sprite is ever swapped, so props, tails of
neighbours and scenery stay intact on pickup; the cleanup rect only bounds the runtime swap. usage: intake_restore_sprites.py IDS..."""
from common import *
from scipy import ndimage as ndi
for k in sys.argv[1:]:
    pubdir=ROOT/'public/levels'/k; e=json.load(open(pubdir/'level.json')); W,H=e['width'],e['height']
    col=np.asarray(Image.open(pubdir/'color.png').convert('RGB')); plate=np.asarray(clean_plate(k,(W,H)).convert('RGB')); mask=np.zeros((H,W),np.float32)
    for d in e['dogs']:
        sp=d.get('sprite')
        if not sp or not sp.get('image'): continue
        p=pubdir/sp['image'].split(f'levels/{k}/')[1]
        if not p.exists(): continue
        x,y,w,h=sprite_xy(d); w,h=int(round(w)),int(round(h)); x,y=int(round(x)),int(round(y))
        a=np.asarray(Image.open(p).convert('RGBA').resize((max(1,w),max(1,h)),Image.LANCZOS))[...,3]>8
        a=ndi.binary_dilation(a,iterations=4)
        x0,y0=max(0,x),max(0,y); x1,y1=min(W,x+w),min(H,y+h)
        if x1<=x0 or y1<=y0: continue
        mask[y0:y1,x0:x1]=np.maximum(mask[y0:y1,x0:x1],a[y0-y:y1-y,x0-x:x1-x])
    mask=ndi.gaussian_filter(mask,2)[...,None]
    out=(col*(1-mask)+plate*mask).round().astype(np.uint8); im=Image.fromarray(out,'RGB'); im.save(pubdir/'bg_00.png')
    (im if im.width==2560 else im.resize((2560,int(im.height*2560/im.width)),Image.LANCZOS)).save(pubdir/'bg_00.webp',format='WEBP',quality=90,method=6)
    print(k,'sprite-footprint restoration, birds',len(e['dogs']),flush=True)
