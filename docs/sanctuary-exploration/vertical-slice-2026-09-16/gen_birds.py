import sys, json, time
sys.path.insert(0, ".")
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import generate_image
from merceka_core import costs as _mcosts
OUT = sys.argv[1]; MODEL = "openai/gpt-image-2.5-sunburst"
STYLE = ("Art style: bold flat-shaded cardstock illustration with crisp cut-paper cardboard depth and soft drop shadows, friendly round storybook proportions, "
  "big round eye, small beak. Never felt or plush, no photoreal rendering. Mobile game sprites. No text, no labels, no badges, no circles, no background, no ground, no branch.")
LAYOUT = ("A horizontal row of exactly THREE separate copies of the SAME bird, evenly spaced with clear empty gaps between them, all facing right, all in the identical perched standing pose with feet together as if standing on a perch. "
  "Left copy: the plain bird. Middle copy: the same bird wearing {acc}. Right copy: the same bird wearing {acc} plus {costume}. "
  "The bird's body shape, colors and face are identical in all three so it is recognizable at small size.")
BIRDS = {
 "bluejay": dict(desc="a blue jay: bright cobalt blue back and crest, white face and belly, black necklace stripe, black-and-white barred wing tips", acc="a small red neckerchief", costume="a tiny straw sun hat and a small brown leather satchel"),
 "robin":   dict(desc="a European robin: warm brown back and wings, bright orange-red face and breast, cream belly", acc="a small olive green scarf", costume="a tiny green flat cap and a small olive explorer jacket"),
 "thrush":  dict(desc="a song thrush: soft brown back, cream breast speckled with dark brown spots, pale eye ring", acc="a tiny mustard yellow bow tie", costume="a tiny brown bowler hat and a small charcoal waistcoat"),
}
def run(name):
    b=BIRDS[name]; t0=time.time()
    prompt = LAYOUT.format(acc=b["acc"], costume=b["costume"]) + " The bird is " + b["desc"] + ". Pin these colors exactly. " + STYLE
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"bird-row-"+name,"model":MODEL}):
        img = generate_image(prompt, model=MODEL, aspect_ratio="16:9", image_size="1K", transparent=True)
    p=f"{OUT}/birds/{name}_row.png"; img.save(p)
    return name, {"path":p,"size":img.size,"mode":img.mode,"elapsed_s":round(time.time()-t0,1)}
with ThreadPoolExecutor(3) as ex: log=dict(ex.map(run, BIRDS))
json.dump(log, open(f"{OUT}/birds/log.json","w"), indent=2); print(json.dumps(log))
