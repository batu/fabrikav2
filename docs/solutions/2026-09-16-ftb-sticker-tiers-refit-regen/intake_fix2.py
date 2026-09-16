"""Post-review fix pass on the public exports (2026-09-16 evening, Batu's device review):
- re-insert the dogs dropped as "no painted bird" (the judge was wrong: they are real birds), keeping the sidecar;
- rebuild EVERY cleanup rect from the final sprite box (x1.15 around its centre, min 2r, always containing the hitbox disc),
  replacing the giant rects produced by unioning a mislocated cutout box with the hitbox disc (one tap picked up 3 birds);
- rewrite bg_00.png with the birdless restore writer (plate residue on treehouse) and bg_00.webp at q90.
usage: intake_fix2.py IDS..."""
from common import *
editor_api()
from levelbuilder.api import session as S
PAD=1.15
for k in sys.argv[1:]:
    pubdir=ROOT/'public/levels'/k; lp=pubdir/'level.json'; level=json.load(open(lp)); W,H=level['width'],level['height']
    side=pubdir/'dropped_no_painted_bird_2026-09-16.json'
    if side.exists():
        dropped=json.load(open(side)); have={d['id'] for d in level['dogs']}
        for d in dropped:
            if d['id'] not in have and d.get('sprite'): level['dogs'].append(d)
        level['dogs'].sort(key=lambda d: d.get('compatibilitySlot',d['id']))
    for d in level['dogs']:
        sp=d['sprite']; r=d.get('r',57); x,y,w,h=sprite_xy(d); cx,cy=x+w/2,y+h/2
        pw,ph=max(w*PAD,2*r),max(h*PAD,2*r)
        if not (x<=d['x']<=x+w and y<=d['y']<=y+h): cx,cy=d['x'],d['y']   # sprite not on the hitbox: centre the cleanup on the hitbox
        x0=max(0,cx-pw/2); y0=max(0,cy-ph/2); x1=min(W,cx+pw/2); y1=min(H,cy+ph/2)
        x0=min(x0,d['x']-r); y0=min(y0,d['y']-r); x1=max(x1,d['x']+r); y1=max(y1,d['y']+r)
        sp['cleanup']={'x':int(max(0,x0)),'y':int(max(0,y0)),'width':int(min(W,x1)-max(0,x0)),'height':int(min(H,y1)-max(0,y0))}
    tmp=lp.with_suffix('.json.tmp'); tmp.write_text(json.dumps(level,indent=2)+'\n'); os.replace(tmp,lp)
    raw=json.load(open(sdir(k)/'session.json'))
    S._write_birdless_restore_bg(sdir(k),pubdir,raw,level)
    with Image.open(pubdir/'bg_00.png') as img:
        im=img.convert('RGB')
        if im.width>2560: im=im.resize((2560,int(im.height*2560/im.width)),Image.LANCZOS)
        im.save(pubdir/'bg_00.webp',format='WEBP',quality=90,method=6)
    big=sum(1 for d in level['dogs'] if d['sprite']['cleanup']['width']>4*d.get('r',57) or d['sprite']['cleanup']['height']>4*d.get('r',57))
    print(k,'dogs',len(level['dogs']),'restored',len(dropped) if side.exists() else 0,'cleanups>4r',big,flush=True)
