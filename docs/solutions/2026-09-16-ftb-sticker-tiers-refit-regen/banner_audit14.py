"""Banner intrusion audit at the 14% placement band (2026-09-16). usage: banner_audit14.py OUT.json IDS...
For every bird: the true bottom of the sprite's opaque pixels (level y) versus the band top at H*(1-0.14).
A level with any bird over the band gets its banner suppressed in levelBannerPolicy.ts."""
from common import *
BAND=0.14
out=[]
for k in sys.argv[2:]:
    p=pub(k); level=json.load(open(p/'level.json')); H=level['height']; band=int(H*(1-BAND)); dogs=[]
    for d in level['dogs']:
        sp=d.get('sprite') or {}
        if not sp.get('image'): continue
        a=np.asarray(Image.open(sprite_path(k,sp)).convert('RGBA'))[...,3]; ys=np.where(a.max(axis=1)>8)[0]
        if not len(ys): continue
        x,y,w,h=sprite_xy(d); bot=y+(ys.max()+1)*h/a.shape[0]
        dogs.append(dict(dog=d['id'],alpha_bottom=round(float(bot)),over_px=round(float(bot-band)),hitbox_over=round(d['y']+d.get('r',57)-band)))
    over=[x for x in dogs if x['over_px']>0]
    out.append(dict(id=k,H=H,band=band,n=len(dogs),over=over,suppress=bool(over)))
    print(f"{k[:54]:56} H={H} band={band} over={len(over)} "+' '.join(f"{x['dog']}:+{x['over_px']}" for x in over),flush=True)
json.dump(out,open(sys.argv[1],'w'),indent=1); print('levels',len(out),'suppress',sum(o['suppress'] for o in out))
