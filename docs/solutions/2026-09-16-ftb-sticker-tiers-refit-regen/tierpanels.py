"""Judge panels (painted | sticker on grey | 50% overlay) + refit numbers for levels. usage: tierpanels.py OUTDIR LEVELS..."""
from common import *
sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor')
import levelbuilder.api.inpaint as I; I._FIT_SCALES=tuple(round(0.6+i*0.05,2) for i in range(29))
from levelbuilder.api.inpaint import fit_sprite_to_painted
O=SCRATCH/sys.argv[1]; levels=[key(x) for x in sys.argv[2:]]; T=260; refit={}
for n in levels:
    p=pub(n); level=json.load(open(p/'level.json')); color=Image.open(p/'color.png').convert('RGB'); sdir=ROOT/'.levelbuilder/levels'/level_id(n); raw=json.load(open(sdir/'session.json'))
    clean=Image.open(sdir/f"bg_{raw['selected_bg']:02d}.png").convert('RGB')
    if clean.size!=color.size: clean=clean.resize(color.size,Image.LANCZOS)
    (O/f'L{n}').mkdir(parents=True,exist_ok=True)  # n may be a session id
    for i,d in enumerate(level['dogs']):
        sp=d['sprite']; w,h=int(sp['width']),int(sp['height']); x=d['x']-sp.get('anchorX',0.5)*w; y=d['y']-sp.get('anchorY',0.5)*h
        src=Image.open(sprite_path(n,sp)).convert('RGBA'); spr=src.resize((w,h),Image.LANCZOS)
        e=int(max(w,h)*0.5); box=(int(max(0,x-e)),int(max(0,y-e)),int(min(color.width,x+w+e)),int(min(color.height,y+h+e)))
        pc=color.crop(box); grey=Image.new('RGBA',pc.size,(128,128,128,255)); grey.alpha_composite(spr,(int(round(x-box[0])),int(round(y-box[1]))))
        half=spr.copy(); half.putalpha(half.split()[3].point(lambda v:v//2)); ov=pc.convert('RGBA'); ov.alpha_composite(half,(int(round(x-box[0])),int(round(y-box[1]))))
        sheet=Image.new('RGB',(3*T+20,T+10),(40,40,40))
        for k,im in enumerate((pc,grey.convert('RGB'),ov.convert('RGB'))):
            im=im.copy(); im.thumbnail((T,T)); sheet.paste(im,(k*(T+5)+5,5))
        sheet.save(O/f'L{n}'/f'bird_{i:02d}.png')
        pad=int(max(w,h)*0.8); cb=(int(max(0,x-pad)),int(max(0,y-pad)),int(min(color.width,x+w+pad)),int(min(color.height,y+h+pad)))
        fit=fit_sprite_to_painted(spr,color.crop(cb),clean.crop(cb))
        refit[f'{n}#{i}']=None if not fit else dict(x=cb[0]+fit['x'],y=cb[1]+fit['y'],w=fit['width'],h=fit['height'],scale=fit['scale'],pop=fit['pop'],score=fit['score'],cur_w=w,cur_h=h,cur_x=int(x),cur_y=int(y))
    print(n,len(level['dogs']),flush=True)
json.dump(refit,open(O/'refit.json','w'),indent=1)
