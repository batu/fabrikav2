"""True first-tap frame per bird (production carve rules) + leftover bird-ish paint. usage: tapcheck.py OUTDIR LEVELS..."""
from common import *
O=SCRATCH/sys.argv[1]; O.mkdir(exist_ok=True); levels=[int(x) for x in sys.argv[2:]]; T=240; assets=[]; rows=[]
def rect(sp): c=sp['cleanup']; return (c['x'],c['y'],c['x']+c['width'],c['y']+c['height'])
def scale2(r): cx,cy=(r[0]+r[2])/2,(r[1]+r[3])/2; w,h=(r[2]-r[0]),(r[3]-r[1]); return (cx-w,cy-h,cx+w,cy+h)
def overlap(a,b): return a[0]<b[2] and b[0]<a[2] and a[1]<b[3] and b[1]<a[3]
for n in levels:
    p=pub(n); level=json.load(open(p/'level.json')); color=np.asarray(Image.open(p/'color.png').convert('RGB')); restore=np.asarray(Image.open(p/'bg_00.png').convert('RGB')); plate=np.asarray(Image.open(SCRATCH/'plates'/(level_id(n)+'.png')).convert('RGB'),np.int16); H,W,_=color.shape; dogs=level['dogs']
    for i,d in enumerate(dogs):
        sp=d['sprite']; ex=scale2(rect(sp)); x0,y0,x1,y1=max(0,int(ex[0])),max(0,int(ex[1])),min(W,int(ex[2])),min(H,int(ex[3]))
        Y,X=np.mgrid[y0:y1,x0:x1]; carve=np.ones((y1-y0,x1-x0),bool); d2=(X-d['x'])**2+(Y-d['y'])**2
        for j,o in enumerate(dogs):
            if j!=i and overlap((x0,y0,x1,y1),rect(o['sprite'])): carve&=(d2<((X-o['x'])**2+(Y-o['y'])**2))
        after=color[y0:y1,x0:x1].copy(); after[carve]=restore[y0:y1,x0:x1][carve]
        cand=np.abs(color[y0:y1,x0:x1].astype(np.int16)-plate[y0:y1,x0:x1]).sum(2)>30; cand=ndi.binary_opening(cand,iterations=2)
        for j,o in enumerate(dogs):
            if j!=i: cand&=~(((X-o['x'])**2+(Y-o['y'])**2)<d2)
        lab,k=ndi.label(cand); disc=d2<=(1.2*57)**2; ids=np.unique(lab[disc&(lab>0)]); cand=np.isin(lab,ids) if ids.size else cand
        remaining=cand & (np.abs(after.astype(np.int16)-color[y0:y1,x0:x1].astype(np.int16)).sum(2)<=30)
        rows.append(dict(level=n,bird=i,remaining_px=int(remaining.sum()),remaining_share=round(float(remaining.sum()/max(1,cand.sum())),3)))
        pc=color[y0:y1,x0:x1].astype(np.float32); t2=pc.copy(); t2[remaining]=t2[remaining]*0.3+np.array((230,40,40))*0.7
        t=Image.new('RGB',(3*T+14,T+22),(30,30,30)); dr=ImageDraw.Draw(t)
        for k,im in enumerate((Image.fromarray(color[y0:y1,x0:x1]),Image.fromarray(after),Image.fromarray(t2.clip(0,255).astype(np.uint8)))):
            im=im.copy(); im.thumbnail((T,T)); t.paste(im,(k*(T+5),22))
        dr.text((4,4),f"L{n} #{i}  painted | FIRST TAP (game carve) | red = paint-added pixels still on screen ({int(remaining.sum())}px)",fill=(255,230,0)); name=f'L{n:02d}_{i:02d}.jpg'; t.save(O/name,quality=82); assets.append(name)
json.dump(rows,open(O/'rows.json','w'),indent=1)
print('birds',len(rows),'with >400px left:',sum(r['remaining_px']>400 for r in rows),' with >2000px left:',sum(r['remaining_px']>2000 for r in rows),' median left px',int(np.median([r['remaining_px'] for r in rows])))
H=['<!doctype html><meta charset=utf-8><title>First-tap check</title><style>body{font:14px/1.4 -apple-system,system-ui;margin:14px;color:#222;max-width:1500px}img{width:100%;border:1px solid #ccc;margin:6px 0}h2{margin-top:22px}</style><h1>True first-tap frames</h1><p>Middle = what the player sees after tapping this bird first. Right = paint-added pixels near the bird the tap did not change (red).</p>']
for n in levels: H.append(f'<h2>Level {n}</h2>'); H+= [f'<img src="{k+2:02d}_{a}">' for k,a in enumerate(assets) if a.startswith(f'L{n:02d}_')]
(O/'tapcheck.html').write_text('\n'.join(H))
