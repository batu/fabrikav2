"""Shared helpers for the sticker-tier scripts.

Levels are addressed by KEY: an int is a 1-based index into the published manifest
(the shipped 44, files under public/levels); a string is a session id (intake
candidates, files under .levelbuilder/levels, or public/levels when LEVEL_SOURCE=public).
ROOT / SCRATCH / the manifest path come from the environment with the 2026-09-16 defaults.
"""
import json, os, sys, base64, io, re, time, shutil, copy, numpy as np
os.environ.setdefault('LEVEL_EDITOR_GAME','find_the_bird')
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
ROOT=Path(os.environ.get('FTB_ROOT','/Users/base/dev/appletolye/fabrikav2/games/find_the_bird'))
SCRATCH=Path(os.environ.get('SCRATCH','/private/tmp/claude-501/-Users-base-dev-appletolye/2f9393c2-39fc-407d-a147-16a09b23e1f6/scratchpad'))
_PM_PATH=Path(os.environ.get('PUBLISHED_MANIFEST',str(SCRATCH/'published-manifest.json')))
PM=json.load(open(_PM_PATH)) if _PM_PATH.exists() else {'levels':[]}
def key(x):
    """CLI token -> level key (int index or session id)."""
    return int(x) if str(x).isdigit() else str(x)
def level_id(k):
    k=key(k); return PM['levels'][k-1]['id'] if isinstance(k,int) else k
def pub(k):
    """Directory holding level.json + color.png for the key."""
    k=key(k)
    if isinstance(k,int) or os.environ.get('LEVEL_SOURCE')=='public': return ROOT/'public/levels'/level_id(k)
    return ROOT/'.levelbuilder/levels'/k
def sdir(k): return ROOT/'.levelbuilder/levels'/level_id(k)
def sprite_path(k,sp):
    """Sprite image path; records are 'levels/<id>/<rel>' and resolve against pub(k)."""
    rel=sp['image'].split(f'levels/{level_id(k)}/')[1]
    p=pub(k)/rel
    return p if p.exists() else sdir(k)/rel
def clean_plate(k,size=None):
    raw=json.load(open(sdir(k)/'session.json')); im=Image.open(sdir(k)/f"bg_{raw['selected_bg']:02d}.png").convert('RGB')
    return im.resize(size,Image.LANCZOS) if size and im.size!=size else im
def sprite_xy(d):
    sp=d['sprite']; w,h=int(sp['width']),int(sp['height']); return d['x']-sp.get('anchorX',0.5)*w, d['y']-sp.get('anchorY',0.5)*h, w, h
def footprint(sp,W,H):
    c=sp['cleanup']; cx,cy=c['x']+c['width']/2,c['y']+c['height']/2
    return (int(max(0,cx-c['width'])),int(max(0,cy-c['height'])),int(min(W,cx+c['width'])),int(min(H,cy+c['height'])))
def b64(im):
    buf=io.BytesIO(); im.save(buf,'PNG'); return base64.b64encode(buf.getvalue()).decode()
def tag(k):
    """Filesystem-safe short label for a key (L07 for indices, the id for sessions)."""
    k=key(k); return f'L{k:02d}' if isinstance(k,int) else k

# --- regeneration prompt (Batu 2026-09-16: visible part only, sunburst low) ---
REGEN_PROMPT=("CUTOUT-ONLY TASK. Extract and faithfully duplicate exactly ONE selected cartoon bird from the reference image as a standalone sprite. "
"Preserve the same species impression, colors, markings, proportions, pose, expression, line weight, rendering style, and any item physically held or worn by the bird. "
"Do not redesign, restyle, beautify, simplify, recolor, reposition, or replace it. "
"If the selected bird is partially hidden behind something, output ONLY the visible part, exactly as painted, with the hidden part simply absent. Do NOT invent, infer, or complete any hidden anatomy, and do not include the occluding object. "
"Output the bird at the same size and position as in the reference, on a completely uniform, flat, pure magenta (#FF00FF) background. Every pixel that is not the selected bird or an item it is physically holding/wearing must be exactly #FF00FF. "
"No scenery, floor, wall, furniture, plants, other animals, detached props, cast shadows, glow, outline sticker rim, text, gradient, texture, or second subject.")
REGEN_MODEL='openai/gpt-image-2.5-sunburst'

def editor_api():
    sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor'); os.environ.setdefault('LEVEL_EDITOR_GAME','find_the_bird')
    import levelbuilder.api.inpaint as I; I._FIT_SCALES=tuple(round(0.6+i*0.05,2) for i in range(29)); return I

def fit_aniso(sprite, painted, clean_crop):
    """Uniform ladder (editor code), then width:height ratio 0.80..1.25 at that size, then one uniform nudge. Same masked SQDIFF + pop as the editor. (refit_all.py, 2026-09-16)"""
    import cv2; I=editor_api()
    base=I.fit_sprite_to_painted(sprite,painted,clean_crop)
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
    if best is None: return None
    score,x,y,w,h,s2,r=best
    rgb=cv2.resize(src_rgb,(w,h),interpolation=cv2.INTER_AREA).astype(np.int16); a=cv2.resize(src_a,(w,h),interpolation=cv2.INTER_AREA)>128; region=scene[y:y+h,x:x+w].astype(np.int16); meas=a
    if changed is not None:
        ob=a&changed[y:y+h,x:x+w]
        if ob.sum()>=max(64,0.2*a.sum()): meas=ob
    pop=float(np.abs(rgb[meas]-region[meas]).mean()) if meas.any() else 255.0
    return {'score':round(score,4),'scale':s2,'ratio':r,'x':x,'y':y,'width':w,'height':h,'pop':round(pop,1)}

def refit_record(d, f, cb, x, y, w, h):
    """Gate a fit (pop<=45, hitbox inside, overlap with the current box) and return (status, new sprite fields|None)."""
    rx,ry,rw,rh=cb[0]+f['x'],cb[1]+f['y'],f['width'],f['height']; ax,ay=(d['x']-rx)/rw,(d['y']-ry)/rh
    inside=0<=ax<=1 and 0<=ay<=1; overlap=rx<x+w and x<rx+rw and ry<y+h and y<ry+rh
    status='applied' if f['pop']<=45 and inside and overlap else 'skipped: '+('pop %.0f'%f['pop'] if f['pop']>45 else 'hitbox outside' if not inside else 'no overlap')
    fields={'x':rx,'y':ry,'width':rw,'height':rh,'anchorX':round(ax,4),'anchorY':round(ay,4),'refit':{'scale':f['scale'],'ratio':f.get('ratio',1.0),'pop':f['pop'],'dx':int(rx-x),'dy':int(ry-y)}}
    return status, fields

def rebuild_cutout(flat):
    """Re-key the raw magenta output with the keying fixes (apply_regen44.py): enclosed non-key holes filled, key-coloured interior forced transparent, edge-only despill."""
    from levelbuilder.api.flatkey import chroma_key, strip_flat_rim, despill
    cut=strip_flat_rim(chroma_key(flat.convert('RGB'))); a=np.asarray(cut.convert('RGBA')).copy()
    op=a[...,3]>0; filled=ndi.binary_fill_holes(op); holes=filled&~op; lab,k=ndi.label(holes)
    rgb=a[...,:3].astype(int); keyc=(rgb[...,0]>150)&(rgb[...,2]>150)&(rgb[...,1]<110)&(rgb[...,0]-rgb[...,1]>60)&(rgb[...,2]-rgb[...,1]>60)
    for q in range(1,k+1):
        h=lab==q
        if h.sum()<=1500 and keyc[h].mean()<0.5: a[...,3][h]=255
    keyc=keyc&(a[...,3]>0); a[...,3][keyc&(a[...,3]==255)]=0; keyc=keyc&(a[...,3]>0)
    if keyc.any():
        good=(a[...,3]>0)&~keyc; idx=ndi.distance_transform_edt(~good,return_distances=False,return_indices=True); a[...,:3][keyc]=a[...,:3][idx[0],idx[1]][keyc]
    full=np.asarray(despill(Image.fromarray(a,'RGBA')),np.uint8); edge=(a[...,3]>0)&(a[...,3]<255); a[edge]=full[edge]
    im=Image.fromarray(a,'RGBA'); bb=im.getbbox(); return (im.crop(bb) if bb else im), int(holes.sum())
def clean_alpha(im):
    a=np.asarray(im.convert('RGBA')).copy(); al=a[...,3]; op=al==255
    if op.any() and (~op).any():
        idx=ndi.distance_transform_edt(~op,return_distances=False,return_indices=True); a[...,:3]=a[...,:3][idx[0],idx[1]]
    return Image.fromarray(a,'RGBA')
def zero_transparent(im):
    a=np.asarray(im.convert('RGBA')).copy(); a[...,:3][a[...,3]==0]=0; return Image.fromarray(a,'RGBA')
def ship_sprite(cut, sw, sh, path):
    """Resize the cutout to its placed box, cap at 288 px, zero transparent RGB, save."""
    out=clean_alpha(cut).resize((sw,sh),Image.LANCZOS); small=out if max(sw,sh)<=288 else out.resize((max(1,int(sw*288/max(sw,sh))),max(1,int(sh*288/max(sw,sh)))),Image.LANCZOS)
    Path(path).parent.mkdir(parents=True,exist_ok=True); zero_transparent(small).save(path,optimize=True)
