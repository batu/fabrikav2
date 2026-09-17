"""Remove a painted bird Batu rejected from a PUBLIC export: intake_remove_bird.py ID DOG_INDEX
Patches the scene with the restored plate over the sprite box (feathered), deletes the dog, re-encodes color.webp,
rewrites the birdless restoration. Sidecar removed_by_batu_2026-09-16.json."""
from common import *
from PIL import ImageFilter
editor_api(); from levelbuilder.api import session as S
k=sys.argv[1]; idx=int(sys.argv[2]); pubdir=ROOT/'public/levels'/k; lp=pubdir/'level.json'; e=json.load(open(lp)); d=e['dogs'][idx]; sp=d['sprite']
x,y,w,h=sprite_xy(d); pad=int(max(w,h)*0.25); box=(int(max(0,x-pad)),int(max(0,y-pad)),int(min(e['width'],x+w+pad)),int(min(e['height'],y+h+pad)))
col=Image.open(pubdir/'color.png').convert('RGB'); bg=Image.open(pubdir/'bg_00.png').convert('RGB'); bg=bg.resize(col.size,Image.LANCZOS) if bg.size!=col.size else bg
patch=bg.crop(box); mask=Image.new('L',patch.size,0); ImageDraw.Draw(mask).rectangle((12,12,patch.width-12,patch.height-12),fill=255); mask=mask.filter(ImageFilter.GaussianBlur(8)); col.paste(patch,box[:2],mask)
col.save(pubdir/'color.png'); im=col if col.width<=2560 else col.resize((2560,int(col.height*2560/col.width)),Image.LANCZOS); im.save(pubdir/'color.webp',format='WEBP',quality=90,method=6)
side=pubdir/'removed_by_batu_2026-09-16.json'; rem=json.load(open(side)) if side.exists() else []; rem.append(d); json.dump(rem,open(side,'w'),indent=1)
e['dogs']=[g for i,g in enumerate(e['dogs']) if i!=idx]; open(lp,'w').write(json.dumps(e,indent=2)+'\n')
raw=json.load(open(sdir(k)/'session.json')); S._write_birdless_restore_bg(sdir(k),pubdir,raw,e)
with Image.open(pubdir/'bg_00.png') as img:
    im=img.convert('RGB'); im=im if im.width<=2560 else im.resize((2560,int(im.height*2560/im.width)),Image.LANCZOS); im.save(pubdir/'bg_00.webp',format='WEBP',quality=90,method=6)
print(k,'removed dog',idx,d.get('compatibilitySlot'),'box',box,'dogs now',len(e['dogs']))
