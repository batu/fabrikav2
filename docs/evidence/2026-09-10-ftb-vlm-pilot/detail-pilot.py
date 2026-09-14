import base64, io, json, subprocess, time, sys
from pathlib import Path
from PIL import Image

out=Path('/Users/base/dev/appletolye/fabrikav2/.worktrees/ftb-placement-evaluation/docs/evidence/2026-09-10-ftb-vlm-pilot')
prefix='hawaii_rainforest_waterfall_bird_0f98-dog_12'
images=[]
for state in ['before','after']:
 im=Image.open(out/f'{prefix}-{state}.png').crop((90,85,200,180)).resize((660,570))
 im.save(out/f'{prefix}-{state}-detail.png')
 buf=io.BytesIO();im.save(buf,format='PNG');images.append(base64.b64encode(buf.getvalue()).decode())
prompt='These are matching BEFORE and AFTER detail crops around a possible bird-removal residue candidate. Does image 2 retain a part of the same bird visible in image 1, or is it only background scenery? Do not assume the candidate is a defect. Compare the contours carefully. Return JSON only: {"residue":"yes|no|uncertain","evidence":"concrete visual evidence","location":"where"}.'
models = [(sys.argv[1],11438)] if len(sys.argv)>1 else [('qwen3.5:27b',11434),('qwen3.8:27b',11438)]
for model,port in models:
 payload={'model':model,'stream':False,'think':False,'format':'json','keep_alive':0,'options':{'num_ctx':8192,'num_predict':500,'temperature':0.2},'messages':[{'role':'user','content':prompt,'images':images}]}
 started=time.monotonic()
 p=subprocess.run(['ssh','-o','BatchMode=yes','ubuntu-server',f'curl -sS --max-time 240 -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:{port}/api/chat'],input=json.dumps(payload),text=True,capture_output=True,timeout=260)
 result={'model':model,'prompt':prompt,'cropBox':[90,85,200,180],'selection':'manually inspected candidate; diagnostic, not blind benchmark','elapsedSeconds':round(time.monotonic()-started,2),'response':json.loads(p.stdout)}
 (out/(model.replace(':','-')+'-detail.json')).write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result),flush=True)
