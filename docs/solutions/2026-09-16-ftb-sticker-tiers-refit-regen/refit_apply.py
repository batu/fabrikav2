"""Apply refit to agy T2 birds on levels; panels: painted | CURRENT overlay+frame0 | REFIT overlay+frame0. usage: refit_apply.py OUTDIR LEVELS..."""
from common import *
O=SCRATCH/sys.argv[1]; (O/'report').mkdir(parents=True,exist_ok=True); levels=[int(x) for x in sys.argv[2:]]
agy=json.load(open(SCRATCH/'tier8'/'agy-tier8.json')); rf=json.load(open(SCRATCH/'tier8'/'refit.json')); T=230; rows=[]
from PIL import ImageFont; F=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20)
for n in levels:
    p=pub(n); level=json.load(open(p/'level.json')); color=Image.open(p/'color.png').convert('RGB'); restore=Image.open(p/'bg_00.png').convert('RGB')
    def frame0(box,spr,x,y): st=restore.crop(box).convert('RGBA'); st.alpha_composite(spr,(int(round(x-box[0])),int(round(y-box[1])))); return st.convert('RGB')
    def overlay(box,spr,x,y): half=spr.copy(); half.putalpha(half.split()[3].point(lambda v:v//2)); ov=color.crop(box).convert('RGBA'); ov.alpha_composite(half,(int(round(x-box[0])),int(round(y-box[1])))); return ov.convert('RGB')
    for i,d in enumerate(level['dogs']):
        if agy[str(n)][str(i)]['tier']!=2: continue
        sp=d['sprite']; f=rf[f'{n}#{i}']; w,h=int(sp['width']),int(sp['height']); x=d['x']-sp.get('anchorX',0.5)*w; y=d['y']-sp.get('anchorY',0.5)*h
        src=Image.open(sprite_path(n,sp)).convert('RGBA'); cur=src.resize((w,h),Image.LANCZOS)
        rx,ry,rw,rh=f['x'],f['y'],f['w'],f['h']; ax,ay=(d['x']-rx)/rw,(d['y']-ry)/rh
        inside=0<=ax<=1 and 0<=ay<=1; overlap=rx<x+w and x<rx+rw and ry<y+h and y<ry+rh
        status='applied' if f['pop']<=45 and inside and overlap else 'skipped: '+('pop %.0f'%f['pop'] if f['pop']>45 else 'hitbox outside' if not inside else 'no overlap')
        if status=='applied': sp.update({'width':rw,'height':rh,'anchorX':round(ax,4),'anchorY':round(ay,4)}); new=src.resize((rw,rh),Image.LANCZOS); nx,ny=rx,ry
        else: new,nx,ny=cur,x,y
        e=int(max(w,h,rw,rh)*0.5); box=(int(max(0,min(x,rx)-e)),int(max(0,min(y,ry)-e)),int(min(color.width,max(x+w,rx+rw)+e)),int(min(color.height,max(y+h,ry+rh)+e)))
        tiles=[color.crop(box),overlay(box,cur,x,y),frame0(box,cur,x,y),overlay(box,new,nx,ny),frame0(box,new,nx,ny)]
        sheet=Image.new('RGB',(5*T+30,T+70),(30,30,30)); dr=ImageDraw.Draw(sheet)
        for k,im in enumerate(tiles): im=im.copy(); im.thumbnail((T,T)); sheet.paste(im,(k*(T+5)+5,36))
        dr.text((6,6),f"Level {n}  bird #{i}   {status}   scale {f['scale']}  pop {f['pop']}",font=F,fill=(255,255,255))
        for k,c in enumerate(('PAINTED','CURRENT 50%','CURRENT frame 0','REFIT 50%','REFIT frame 0')): dr.text((k*(T+5)+6,T+42),c,font=F,fill=(255,200,80) if k>=3 else (220,220,220))
        name=f'L{n:02d}_{i:02d}.jpg'; sheet.save(O/'report'/name,quality=74); rows.append((n,i,status,f['scale'],f['pop'],name))
    (p/'level.json').write_text(json.dumps(level,indent=2))
H=['<!doctype html><meta charset=utf-8><title>Refit T2 levels 1-8</title><style>body{font:16px/1.5 -apple-system,system-ui;margin:16px;color:#222;max-width:1250px}img{width:100%;display:block;border:1px solid #ccc;margin:8px 0 22px}h2{margin-top:28px}</style><h1>Refit applied to agy T2 birds, levels 1-8</h1><p>Columns: painted scene | current sticker at 50% over the paint | current frame 0 of the pickup (sticker on the restoration) | refit sticker at 50% | refit frame 0. Yellow captions are the new placement. Header says applied or why it was skipped.</p>']
import collections; print(collections.Counter(r[2].split(':')[0] for r in rows), len(rows))
for n in levels: H.append(f'<h2>Level {n}</h2>'); H+=[f'<img src="{k+2:02d}_{r[5]}">' for k,r in enumerate(rows) if r[0]==n]
(O/'report'/'report.html').write_text('\n'.join(H)); json.dump(rows,open(O/'rows.json','w'),indent=1)
