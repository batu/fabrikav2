"""Add a painted bird the VLM missed to a PUBLIC export (Batu's review): intake_add_bird.py ID X Y [R]
Crops 3.2r around the point, regenerates the sticker (sunburst low, visible part), fits it, appends the dog with a tight cleanup,
rewrites the birdless restoration. Records the addition in added_by_batu_2026-09-16.json (canonical sync is still owed)."""
from common import *
import uuid
I=editor_api(); from merceka_core.image import edit_image
from levelbuilder.api import session as S
k=sys.argv[1]; X,Y=int(sys.argv[2]),int(sys.argv[3]); pubdir=ROOT/'public/levels'/k; lp=pubdir/'level.json'; level=json.load(open(lp))
r=int(sys.argv[4]) if len(sys.argv)>4 else level['dogs'][0].get('r',57); W,H=level['width'],level['height']
col=Image.open(pubdir/'color.png').convert('RGB'); clean=clean_plate(k,col.size); side=int(3.2*r); x0=int(min(max(0,X-side/2),W-side)); y0=int(min(max(0,Y-side/2),H-side)); cb=(x0,y0,x0+side,y0+side)
crop=col.crop(cb); flat=edit_image(crop,REGEN_PROMPT,model=REGEN_MODEL,quality='low'); cut,_=rebuild_cutout(flat); fit=I.fit_sprite_to_painted(cut,crop,clean.crop(cb))
assert fit, 'no fit'
sx,sy,sw,sh=cb[0]+fit['x'],cb[1]+fit['y'],fit['width'],fit['height']; n=1+sum(1 for d in level['dogs'] if str(d.get('compatibilitySlot','')).startswith('dog_added'))
slot=f'dog_added_{n:02d}'; rel=f'dogs/{slot}/sprite_000.png'; ship_sprite(cut,sw,sh,pubdir/rel)
save=sdir(k)/'dogs'/slot/'regen_2026-09-16'; save.mkdir(parents=True,exist_ok=True); crop.save(save/'crop.png'); flat.save(save/'crop_flat.png'); cut.save(save/'crop_cutout.png')
cx,cy=sx+sw/2,sy+sh/2; pw,ph=max(sw*1.15,2*r),max(sh*1.15,2*r); cx0=min(max(0,cx-pw/2),X-r); cy0=min(max(0,cy-ph/2),Y-r); cx1=max(min(W,cx+pw/2),X+r); cy1=max(min(H,cy+ph/2),Y+r)
dog={'id':str(uuid.uuid4()),'compatibilitySlot':slot,'x':X,'y':Y,'r':r,'sprite':{'image':f'levels/{k}/{rel}','x':sx,'y':sy,'width':sw,'height':sh,'cleanup':{'x':int(cx0),'y':int(cy0),'width':int(cx1-cx0),'height':int(cy1-cy0)},'anchorX':round((X-sx)/sw,4),'anchorY':round((Y-sy)/sh,4),'flipX':False,'flipY':False,'technique':'gpt-image-2.5-sunburst-low-visible-only','regen':{'pass':'manual-add','score':fit['score'],'pop':fit['pop'],'why':'added by Batu'}}}
level['dogs'].append(dog); open(lp,'w').write(json.dumps(level,indent=2)+'\n')
side_f=pubdir/'added_by_batu_2026-09-16.json'; added=json.load(open(side_f)) if side_f.exists() else []; added.append(dog); json.dump(added,open(side_f,'w'),indent=1)
raw=json.load(open(sdir(k)/'session.json')); S._write_birdless_restore_bg(sdir(k),pubdir,raw,level)
with Image.open(pubdir/'bg_00.png') as img:
    im=img.convert('RGB'); im=im if im.width<=2560 else im.resize((2560,int(im.height*2560/im.width)),Image.LANCZOS); im.save(pubdir/'bg_00.webp',format='WEBP',quality=90,method=6)
print(k,'added',slot,'at',X,Y,'sprite',sw,sh,'score',fit['score'],'pop',fit['pop'],'dogs now',len(level['dogs']))
