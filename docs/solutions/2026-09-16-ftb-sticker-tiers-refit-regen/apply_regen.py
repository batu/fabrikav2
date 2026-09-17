"""Write the best regenerated cutout (first pass vs grown crop, by match score) into levels 1-8 sprite files + level.json boxes."""
from common import *
O=SCRATCH/'regen41'; r1={(r['level'],r['bird']):(r,'crop','sunburst_cutout') for r in json.load(open(O/'runs.json'))}; r2={(r['level'],r['bird']):(r,'crop2','sunburst2_cutout') for r in json.load(open(O/'runs2.json')) if r.get('fit')}
sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor')
from levelbuilder.api.flatkey import chroma_key, strip_flat_rim, despill
def rebuild_cutout(flat):
    """Re-key the raw magenta output; fill enclosed key-holes (pink/purple plumage keyed as magenta) with the raw pixels; keep the same bbox as before."""
    cut=strip_flat_rim(chroma_key(flat.convert('RGB'))); a=np.asarray(cut.convert('RGBA')).copy()   # keyed pixels keep their RGB under alpha 0
    op=a[...,3]>0; filled=ndi.binary_fill_holes(op); holes=filled&~op; lab,k=ndi.label(holes)
    rgb=a[...,:3].astype(int); keyc=(rgb[...,0]>150)&(rgb[...,2]>150)&(rgb[...,1]<110)&(rgb[...,0]-rgb[...,1]>60)&(rgb[...,2]-rgb[...,1]>60)
    for q in range(1,k+1):
        h=lab==q
        # fill only holes that are plumage keyed by mistake; a hole that is key-coloured is real background (gap between bristles, legs) and stays transparent
        if h.sum()<=1500 and keyc[h].mean()<0.5: a[...,3][h]=255
    # any key-coloured pixel left with alpha: opaque interior ones are gaps the keyer forced solid -> make transparent; edge ones take the nearest non-key colour
    keyc=keyc&(a[...,3]>0); a[...,3][keyc&(a[...,3]==255)]=0; keyc=keyc&(a[...,3]>0)
    if keyc.any():
        good=(a[...,3]>0)&~keyc; idx=ndi.distance_transform_edt(~good,return_distances=False,return_indices=True); a[...,:3][keyc]=a[...,:3][idx[0],idx[1]][keyc]
    # despill only the antialiased edge: the editor's despill greys out EVERY green or magenta-ish pixel,
    # which turns green plumage into grey patches (L1 #11, L8 #2 on the phone, 2026-09-16)
    full=np.asarray(despill(Image.fromarray(a,'RGBA')),np.uint8); edge=(a[...,3]>0)&(a[...,3]<255); a[edge]=full[edge]
    im=Image.fromarray(a,'RGBA'); bb=im.getbbox(); return im.crop(bb), int(holes.sum())
def clean_alpha(im):
    """Fill RGB under transparent pixels with the nearest opaque colour (so resampling never bleeds key colour), then zero it after resize."""
    a=np.asarray(im.convert('RGBA')).copy(); al=a[...,3]; op=al==255
    if op.any() and (~op).any():
        idx=ndi.distance_transform_edt(~op,return_distances=False,return_indices=True); a[...,:3]=a[...,:3][idx[0],idx[1]]
    return Image.fromarray(a,'RGBA')
def zero_transparent(im):
    a=np.asarray(im.convert('RGBA')).copy(); a[...,:3][a[...,3]==0]=0; return Image.fromarray(a,'RGBA')
n_done=0; picks=[]; holes=[]
for key,(a,ca,fa) in r1.items():
    b=r2.get(key); pick=(a,ca,fa)
    if b and b[0]['fit']['score']>a['fit']['score']: pick=b
    r,ctag,ftag=pick; n,i=key; p=pub(n); level=json.load(open(p/'level.json')); d=level['dogs'][i]; sp=d['sprite']
    crop_box=r['crop'] if ctag=='crop2' else None
    if crop_box is None:
        # first-pass crop = 182 square centred on the hitbox (extract_box_for_hitbox with no detections)
        crop_box=(int(d['x']-91),int(d['y']-91),int(d['x']+91),int(d['y']+91))
    f=r['fit']; cut,holepx=rebuild_cutout(Image.open(O/f'L{n}_{i}_{ftag.replace('cutout','flat')}.png')); cut=clean_alpha(cut); holes.append((n,i,holepx)); sx,sy,sw,sh=crop_box[0]+f['x'],crop_box[1]+f['y'],f['width'],f['height']
    out=cut.resize((sw,sh),Image.LANCZOS); small=out if max(sw,sh)<=288 else out.resize((max(1,int(sw*288/max(sw,sh))),max(1,int(sh*288/max(sw,sh)))),Image.LANCZOS); small=zero_transparent(small); small.save(sprite_path(n,sp),optimize=True)
    sp.update({'x':sx,'y':sy,'width':sw,'height':sh,'anchorX':round((d['x']-sx)/sw,4),'anchorY':round((d['y']-sy)/sh,4),'technique':'gpt-image-2.5-sunburst-low-visible-only','regen':{'pass':ctag,'score':f['score'],'pop':f['pop']}})
    (p/'level.json').write_text(json.dumps(level,indent=2)); n_done+=1; picks.append(ctag)
import collections; print('written',n_done,collections.Counter(picks)); print('holes filled px:',[(a,b,c) for a,b,c in holes if c>0])
