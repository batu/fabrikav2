"""Gemini judge for white-gap candidates (Batu 2026-09-17: 'you can use gemini and agy, use all').
usage: judge_whitegap.py SWEEP_JSON OUT_JSON  -- one call per candidate blob: agy first, OpenRouter gemini-3.8-flash fallback.
Panel: sprite on grey | same with the candidate in red | 6x zoom of the candidate. Answer: {"gap": true|false, "why"}."""
import sys, json, re, subprocess, concurrent.futures, time, os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from whitegap import find_gaps, load
PROMPT=('Read the image file {p} with your image viewing tool. It shows one cartoon bird sticker three times: left = the sticker on grey; '
 'middle = the same sticker with ONE candidate region painted solid red; right = a zoom on that region. The sticker should be see-through '
 'wherever there is no bird: the question is whether the red region is a GAP (empty space between body parts such as between the legs, '
 'under the belly next to the legs, inside a bent wing or elbow, between the bird and something it holds, where the scene behind should show '
 'through) that was wrongly filled with white, or whether it is genuinely part of the bird or its item (a white cheek, throat, belly, breast, '
 'eye ring, wing bar, tail feather, or a white object it holds). Output exactly one JSON object and nothing else: {{"gap": true|false, "why": "<=15 words"}}')
OR_PROMPT=PROMPT.replace('Read the image file {p} with your image viewing tool. It shows','The image shows').replace('{{','{').replace('}}','}')
S=Path(sys.argv[1]).parent; hits=json.load(open(sys.argv[1])); OUT=Path(sys.argv[2]); done=json.load(open(OUT)) if OUT.exists() else {}
P=S/'panels'; P.mkdir(exist_ok=True)
def panel(h, gi, g, a):
    key=f"L{h['level']:02d}_b{h['bird']:02d}_{gi}"; p=P/f'{key}.png'
    if p.exists(): return key,p
    z=3; base=Image.fromarray(a,'RGBA').resize((a.shape[1]*z,a.shape[0]*z),Image.NEAREST); ov=a.copy(); ov[g['mask']]=[255,0,0,255]
    red=Image.fromarray(ov,'RGBA').resize(base.size,Image.NEAREST)
    x0,y0,x1,y1=g['bbox']; pad=18; box=(max(0,x0-pad),max(0,y0-pad),min(a.shape[1],x1+pad),min(a.shape[0],y1+pad)); zoom=Image.fromarray(ov,'RGBA').crop(box); zoom=zoom.resize((zoom.width*6,zoom.height*6),Image.NEAREST)
    W=base.width*2+zoom.width+40; H=max(base.height,zoom.height)+10; sheet=Image.new('RGB',(W,H),(110,110,110))
    sheet.paste(base,(5,5),mask=base.split()[3]); sheet.paste(red,(base.width+15,5),mask=red.split()[3]); sheet.paste(zoom,(base.width*2+30,5),mask=zoom.split()[3]); sheet.save(p); return key,p
def agy(p):
    r=subprocess.run(['agy','-p='+PROMPT.format(p=p.resolve()),'--dangerously-skip-permissions','--output-format','json','--print-timeout','4m'],capture_output=True,text=True,cwd=p.parent,timeout=260)
    resp=json.loads(r.stdout)['response']; m=re.search(r'\{.*\}',resp,re.S); d=json.loads(m.group(0)); return bool(d['gap']),'[agy] '+d.get('why','')
def openrouter(p):
    sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor'); from merceka_core.llm import LLM
    llm=LLM(model_name='openrouter/google/gemini-3.8-flash',system_prompt=OR_PROMPT)
    r=llm.generate_with_resource('Judge the attached panel.',resource_path=p,temperature=0.0,max_tokens=2000)
    m=re.search(r'\{.*\}',r if isinstance(r,str) else str(r),re.S); d=json.loads(m.group(0)); return bool(d['gap']),'[openrouter] '+d.get('why','')
def judge(item):
    key,p,meta=item; t0=time.time()
    for fn in (agy,openrouter):
        try: g,why=fn(p); return key,{**meta,'gap':g,'why':why,'s':round(time.time()-t0,1)}
        except Exception as e: err=f'{fn.__name__}: {str(e)[:100]}'
    return key,{**meta,'gap':None,'why':'error '+err,'s':round(time.time()-t0,1)}
items=[]
for h in hits:
    a=load(h['path'])
    for gi,g in enumerate(find_gaps(a)):
        key,p=panel(h,gi,g,a)
        if key in done and done[key].get('gap') is not None: continue
        items.append((key,p,dict(level=h['level'],id=h['id'],bird=h['bird'],path=h['path'],gi=gi,size=g['size'],bbox=g['bbox'])))
print('to judge',len(items),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
    for key,res in ex.map(judge,items):
        done[key]=res; print(key,res['gap'],res['s'],res['why'][:70],flush=True); json.dump(done,open(OUT,'w'),indent=1)
print('done',len(done),'gaps',sum(1 for v in done.values() if v['gap']),'errors',sum(1 for v in done.values() if v['gap'] is None))
