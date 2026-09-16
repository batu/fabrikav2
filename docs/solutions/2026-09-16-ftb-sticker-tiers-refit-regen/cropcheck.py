"""Which of the 41 have painted bird pixels touching the 182 crop edge (crop too small)? Rerun those with crop = diff bbox padded 25%."""
from common import *
sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor')
from levelbuilder.api.inpaint import painted_diff_mask, fit_sprite_to_painted
import levelbuilder.api.inpaint as I; I._FIT_SCALES=tuple(round(0.6+i*0.05,2) for i in range(29))
from levelbuilder.api.flatkey import chroma_key, strip_flat_rim, despill
from merceka_core.image import edit_image
import time, concurrent.futures
exec(open('cutout6.py').read().split('O=SCRATCH')[0].split('PROMPT=')[0]); PROMPT=open('cutout6.py').read().split('PROMPT=(')[1].split(')\nO=')[0]; PROMPT=eval('('+PROMPT+')')
O=SCRATCH/'regen41'; runs=json.load(open(O/'runs.json')); todo=[]
for r in runs:
    n,i=r['level'],r['bird']; p=pub(n); level=json.load(open(p/'level.json')); d=level['dogs'][i]; color=Image.open(p/'color.png').convert('RGB'); sdir=ROOT/'.levelbuilder/levels'/level_id(n); raw=json.load(open(sdir/'session.json'))
    clean=Image.open(sdir/f"bg_{raw['selected_bg']:02d}.png").convert('RGB'); clean=clean.resize(color.size,Image.LANCZOS) if clean.size!=color.size else clean
    cx,cy=d['x'],d['y']; cb=(int(cx-91),int(cy-91),int(cx+91),int(cy+91)); m=painted_diff_mask(color.crop(cb),clean.crop(cb)); 
    if m is None: continue
    ma=np.asarray(m)>0; lab,k=ndi.label(ma); yy,xx=np.ogrid[:182,:182]; disc=(xx-91)**2+(yy-91)**2<=(1.2*57)**2; ids=np.unique(lab[disc&(lab>0)]); sel=np.isin(lab,ids) if ids.size else ma
    edge=sel[0,:].sum()+sel[-1,:].sum()+sel[:,0].sum()+sel[:,-1].sum()
    if edge>20: todo.append((n,i,int(edge),d,cb))
print('crop-cut birds',len(todo),[(t[0],t[1],t[2]) for t in todo])
def one(t):
  try:
    return _one(t)
  except Exception as e:
    return dict(level=t[0],bird=t[1],error=str(e)[:160])
def _one(t):
    n,i,edge,d,cb0=t; p=pub(n); color=Image.open(p/'color.png').convert('RGB'); sdir=ROOT/'.levelbuilder/levels'/level_id(n); raw=json.load(open(sdir/'session.json'))
    clean=Image.open(sdir/f"bg_{raw['selected_bg']:02d}.png").convert('RGB'); clean=clean.resize(color.size,Image.LANCZOS) if clean.size!=color.size else clean
    # grow: diff bbox of the hitbox component inside a 2x search window, padded 25%, square
    S=200; sb=(int(d['x']-S),int(d['y']-S),int(d['x']+S),int(d['y']+S)); m=painted_diff_mask(color.crop(sb),clean.crop(sb)); ma=np.asarray(m)>0; lab,k=ndi.label(ma); yy,xx=np.ogrid[:2*S,:2*S]; disc=(xx-S)**2+(yy-S)**2<=(1.2*57)**2; ids=np.unique(lab[disc&(lab>0)]); sel=np.isin(lab,ids)
    ys,xs=np.where(sel); h=max(ys.max()-ys.min(),xs.max()-xs.min())*1.25/2+8; ccx,ccy=sb[0]+(xs.min()+xs.max())/2,sb[1]+(ys.min()+ys.max())/2
    side=int(2*h); x0=int(min(max(0,ccx-h),color.width-side)); y0=int(min(max(0,ccy-h),color.height-side)); cb=(x0,y0,x0+side,y0+side); crop=color.crop(cb); ccrop=clean.crop(cb); crop.save(O/f'L{n}_{i}_crop2.png')
    t0=time.time(); flat=edit_image(crop,PROMPT,model='openai/gpt-image-2.5-sunburst',quality='low'); dt=time.time()-t0; flat.save(O/f'L{n}_{i}_sunburst2_flat.png')
    cut=despill(strip_flat_rim(chroma_key(flat.convert('RGB')))); bb=cut.getbbox(); cut=cut.crop(bb); cut.save(O/f'L{n}_{i}_sunburst2_cutout.png'); fit=fit_sprite_to_painted(cut,crop,ccrop)
    return dict(level=n,bird=i,edge_px=edge,crop=cb,crop_side=cb[2]-cb[0],seconds=round(dt,1),fit=fit)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex: out=list(ex.map(one,todo))
json.dump(out,open(O/'runs2.json','w'),indent=1)
for o in out: print(o['level'],o['bird'],o.get('error') or ('crop %d score %s pop %s scale %s'%(o['crop_side'],o['fit']['score'],o['fit']['pop'],o['fit']['scale'])))
