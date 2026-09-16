"""3 birds x {flare, sunburst} gpt-image-2.5 flat-key cutouts, visible-part-only prompt. Writes SCRATCH/cutout6/."""
from common import *
import time
sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor')
from levelbuilder.api.flatkey import chroma_key, strip_flat_rim, despill, flat_ok
from levelbuilder.api.inpaint import extract_box_for_hitbox, fit_sprite_to_painted
import levelbuilder.api.inpaint as I; I._FIT_SCALES=tuple(round(0.6+i*0.05,2) for i in range(29))
from merceka_core.image import edit_image
PROMPT=("CUTOUT-ONLY TASK. Extract and faithfully duplicate exactly ONE selected cartoon bird from the reference image as a standalone sprite. "
"Preserve the same species impression, colors, markings, proportions, pose, expression, line weight, rendering style, and any item physically held or worn by the bird. "
"Do not redesign, restyle, beautify, simplify, recolor, reposition, or replace it. "
"If the selected bird is partially hidden behind something, output ONLY the visible part, exactly as painted, with the hidden part simply absent. Do NOT invent, infer, or complete any hidden anatomy, and do not include the occluding object. "
"Output the bird at the same size and position as in the reference, on a completely uniform, flat, pure magenta (#FF00FF) background. Every pixel that is not the selected bird or an item it is physically holding/wearing must be exactly #FF00FF. "
"No scenery, floor, wall, furniture, plants, other animals, detached props, cast shadows, glow, outline sticker rim, text, gradient, texture, or second subject.")
O=SCRATCH/'cutout6'; O.mkdir(exist_ok=True)
agy=json.load(open(SCRATCH/'tier8'/'agy-tier8.json'))
t4=[(int(L),int(b)) for L in sorted(agy,key=int) for b in sorted(agy[L],key=int) if agy[L][b]['tier']==4][:3]
print('birds',t4); out=[]
for (n,i) in t4:
    p=pub(n); level=json.load(open(p/'level.json')); d=level['dogs'][i]; color=Image.open(p/'color.png').convert('RGB'); sdir=ROOT/'.levelbuilder/levels'/level_id(n)
    dets=json.load(open(sdir/'vlm_detections.json')) if (sdir/'vlm_detections.json').exists() else []
    dets=dets.get('detections',dets) if isinstance(dets,dict) else dets
    box=extract_box_for_hitbox({'x':d['x'],'y':d['y'],'r':57},dets,1.6); cb=(int(box['x']),int(box['y']),int(box['x']+box['width']),int(box['y']+box['height']))
    crop=color.crop(cb); crop.save(O/f'L{n}_{i}_crop.png')
    for model in ('openai/gpt-image-2.5-flare','openai/gpt-image-2.5-sunburst'):
        tag=model.split('-')[-1]; t0=time.time()
        try: flat=edit_image(crop,PROMPT,model=model,quality='low')
        except Exception as e: print(n,i,tag,'ERROR',e); out.append(dict(level=n,bird=i,model=tag,error=str(e)[:200])); continue
        dt=time.time()-t0; flat.save(O/f'L{n}_{i}_{tag}_flat.png')
        cut=strip_flat_rim(chroma_key(flat.convert('RGB'))); ok,reason=flat_ok(flat,cut); cut=despill(cut); bb=cut.getbbox()
        rec=dict(level=n,bird=i,model=tag,seconds=round(dt,1),flat_ok=bool(ok),reason=str(reason),flat_size=flat.size,crop_size=crop.size)
        if bb:
            cut=cut.crop(bb); cut.save(O/f'L{n}_{i}_{tag}_cutout.png')
            fit=fit_sprite_to_painted(cut,crop,None); rec['fit']=fit
        out.append(rec); print(rec,flush=True)
json.dump(out,open(O/'runs.json','w'),indent=1)
