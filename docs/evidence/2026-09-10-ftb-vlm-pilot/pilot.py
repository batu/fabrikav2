import base64
import io
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from levelbuilder.api.placement_eval import _sites, _erase_mask

work = Path('/Users/base/dev/appletolye/fabrikav2/.worktrees/ftb-placement-evaluation')
root = Path('/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/public/levels')
out = work / 'docs/evidence/2026-09-10-ftb-vlm-pilot'
out.mkdir(parents=True, exist_ok=True)
audit = json.loads((work/'docs/evidence/2026-09-10-ftb-placement-evaluation/summary.json').read_text())
cases = [('hawaii_rainforest_waterfall_bird_0f98', 'dog_12'), ('hawaii_rainforest_waterfall_bird_0f98', 'dog_04'), ('ad_campaigns_ad_cozy_library_bird_e654', 'dog_12'), ('ad_campaigns_ad_cozy_library_bird_e654', 'dog_09')]
prompt = '''Compare two images of the same game scene crop. Image 1 is BEFORE a pickup; image 2 is AFTER. The target bird is at the center of image 1. Only that bird should disappear; other birds and scenery should remain. Is any visible part of the target bird still left in image 2 (tail, feather, feet, outline, body fragment)? Distinguish actual target fragments from nearby birds, leaves, branches, shadows, and normal scenery. Do not assume there is residue. Return JSON only: {"residue":"yes|no|uncertain","location":"where in image 2, or none","evidence":"brief concrete visual comparison"}.'''
model, port = sys.argv[1], int(sys.argv[2])
results = []
for level_id, bird_id in cases:
    level = json.loads((root/level_id/'level.json').read_text())
    record = next(b for l in audit['levels'] if l['levelId']==level_id for b in l['birds'] if b['dogId']==bird_id)
    scene = Image.open(root.parent/level['colorImage']).convert('RGB')
    restore = Image.open(root/level_id/'bg_00.png').convert('RGB').resize(scene.size, Image.Resampling.BILINEAR)
    box = tuple(record['cropBox'])
    before = scene.crop(box)
    sites = _sites(level)
    site = next(s for s in sites if s.bird_id==bird_id)
    erase = _erase_mask(site, sites, scene.size, box, set())
    after = Image.fromarray(np.where(erase[...,None], np.asarray(restore.crop(box)), np.asarray(before)))
    images=[]
    for name, im in [('before',before),('after',after)]:
        im.thumbnail((1280,1280))
        im.save(out/f'{level_id}-{bird_id}-{name}.png')
        buf=io.BytesIO(); im.save(buf,format='PNG')
        images.append(base64.b64encode(buf.getvalue()).decode())
    payload={'model':model,'stream':False,'think':False,'keep_alive':0,'format':'json','options':{'num_ctx':8192,'num_predict':500,'temperature':0.2},'messages':[{'role':'user','content':prompt,'images':images}]}
    started=time.monotonic()
    call=subprocess.run(['ssh','-o','BatchMode=yes','ubuntu-server',f'curl -sS --max-time 240 -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:{port}/api/chat'],input=json.dumps(payload),text=True,capture_output=True,timeout=260)
    response=json.loads(call.stdout) if call.stdout else {'error':call.stderr}
    item={'levelId':level_id,'dogId':bird_id,'elapsedSeconds':round(time.monotonic()-started,2),'response':response}
    results.append(item)
    (out/(model.replace(':','-')+'.json')).write_text(json.dumps({'prompt':prompt,'model':model,'results':results},indent=2)+'\n')
    print(json.dumps({'model':model,**item}),flush=True)
