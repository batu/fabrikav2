from common import *
import subprocess
from PIL import ImageFont; F=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',22); F2=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
REPO='/Users/base/dev/appletolye/fabrikav2'; O=SCRATCH/'level1report'; O.mkdir(exist_ok=True); T=320; assets=[]
def git_bytes(path): return subprocess.run(['git','-C',REPO,'show',f'feat/ftb-debug-level-jump:games/find_the_bird/{path}'],capture_output=True,check=True).stdout
agy=json.load(open(SCRATCH/'regen41'/'judge'/'agy-regen41.json')); old_t=json.load(open(SCRATCH/'tier8'/'agy-tier8.json'))
for n in [1]:
    p=pub(n); level=json.load(open(p/'level.json')); oldl=json.loads(git_bytes(f'public/levels/{level_id(n)}/level.json')); color=Image.open(p/'color.png').convert('RGB')
    for i,d in enumerate(level['dogs']):
        sp=d['sprite']
        osp=oldl['dogs'][i]['sprite']; rel=sp['image'].split(f'levels/{level_id(n)}/')[1]
        new=Image.open(sprite_path(n,sp)).convert('RGBA').resize((sp['width'],sp['height']),Image.LANCZOS); old=Image.open(io.BytesIO(git_bytes(f'public/levels/{level_id(n)}/{rel}'))).convert('RGBA').resize((osp['width'],osp['height']),Image.LANCZOS)
        ox,oy=d['x']-osp.get('anchorX',0.5)*osp['width'],d['y']-osp.get('anchorY',0.5)*osp['height']; nx,ny=sp['x'],sp['y']
        x0,y0=min(ox,nx),min(oy,ny); x1,y1=max(ox+osp['width'],nx+sp['width']),max(oy+osp['height'],ny+sp['height']); e=max(x1-x0,y1-y0)*0.25; cx,cy=(x0+x1)/2,(y0+y1)/2; s=max(x1-x0,y1-y0)/2+e
        box=(int(max(0,cx-s)),int(max(0,cy-s)),int(min(color.width,cx+s)),int(min(color.height,cy+s))); crop=color.crop(box)
        def on_grey(spr,x,y): g=Image.new('RGBA',crop.size,(128,128,128,255)); g.alpha_composite(spr,(int(round(x-box[0])),int(round(y-box[1])))); return g.convert('RGB')
        regen=sp.get('technique','').startswith('gpt'); tiles=[('PAINTED (in scene)',crop),(f'SHIPPED sprite  (agy T{old_t[str(n)][str(i)]["tier"]})',on_grey(old,ox,oy)),((f'NEW sunburst cutout (agy T{agy[str(n)][str(i)]["tier"]})' if regen else 'SAME sticker, refit geometry'),on_grey(new,nx,ny))]
        sheet=Image.new('RGB',(3*(T+8)+8,T+100),(24,24,24)); dr=ImageDraw.Draw(sheet)
        for k,(c,im) in enumerate(tiles): im=im.resize((T,T),Image.LANCZOS); sheet.paste(im,(k*(T+8)+8,40)); dr.text((k*(T+8)+10,T+46),c,font=F2,fill=(255,200,80) if k==2 else (220,220,220))
        dr.text((8,8),f"Level {n}  bird #{i}   "+(('REGENERATED: '+agy[str(n)][str(i)]['why'][:60]) if regen else ('refit only: scale %s ratio %s pop %s'%(sp.get('refit',{}).get('scale'),sp.get('refit',{}).get('ratio'),sp.get('refit',{}).get('pop')))),font=F,fill=(255,200,80) if regen else (255,255,255)); name=f'L{n:02d}_{i:02d}.jpg'; sheet.save(O/name,quality=80); assets.append(name)
H=['<!doctype html><meta charset=utf-8><title>Regenerations: painted / original / new</title><style>body{font:16px/1.5 -apple-system,system-ui;margin:16px;color:#222;max-width:1100px}img{width:100%;display:block;border:1px solid #ccc;margin:6px 0 18px}h2{margin-top:28px}</style>',
f'<h1>Level 1 (Hawaii waterfall), all {len(assets)} birds, phone build 7c661f506: painted scene | shipped sprite | sprite now in the build</h1><p>Same crop for all three columns; sprites drawn on grey at the exact position and size the game uses. Yellow header = regenerated with sunburst low (5 birds); white header = the shipped sticker with only the geometry refit (uniform + aspect). Tier labels are from agy.</p>']
cur=None
for a in assets:
    L=int(a[1:3])
    if L!=cur: cur=L; H.append(f'<h2>Level {L}</h2>')
    H.append(f'<img src="{assets.index(a)+2:02d}_{a}">')
(O/'report.html').write_text('\n'.join(H)); print(len(assets), round(sum((O/a).stat().st_size for a in assets)/1e6,1),'MB')
