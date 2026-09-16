import sys, json, time, os
sys.path.insert(0, ".")
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import generate_image
from merceka_core import costs as _mcosts
OUT = sys.argv[1]; MODEL = "openai/gpt-image-2.5-sunburst"
STYLE = ("Art style: bold flat-shaded cardstock illustration with crisp cut-paper cardboard depth and soft drop shadows, "
  "friendly storybook proportions, palette of saddle brown wood, olive green moss roof, cream, charcoal, mustard gold. "
  "Never felt or plush, no photoreal rendering. Mobile game sprite. No text, no labels, no watermark. "
  "The ENTIRE object is fully inside the frame with margin on every side, centered, front view, no ground, no branch, no background.")
BASE = ("A simple wooden birdhouse made of warm pine planks: a square box with a peaked olive-green moss-shingle roof, one round entrance hole in the center, "
  "a short wooden dowel perch below the hole. ")
TIERS = {
 "tier1": BASE + "Just this one small box with its single perch. Only ONE perch.",
 "tier2": BASE + "This same birdhouse has been UPGRADED: the same box now has a second story stacked on top with its own round hole, a small railed wooden balcony across the front of the lower story, and a shuttered window. Exactly TWO perches: the balcony rail and the upper dowel. Same plank wood and moss roof, same width, taller.",
 "tier3": BASE + "This same birdhouse at its GRANDEST tier: three stacked stories, a stone chimney with a cream paper smoke puff, a lantern hanging beside the middle door, flower boxes with small cream daisies, and a wraparound railed balcony on the middle story. Exactly THREE perches: the lower dowel, the middle balcony rail, and a small rooftop deck. Same plank wood and moss roof, same width, tallest.",
}
def run(name):
    t0=time.time()
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"house-"+name,"model":MODEL}):
        img = generate_image(TIERS[name]+" "+STYLE, model=MODEL, aspect_ratio="1:1", image_size="1K", transparent=True)
    p=f"{OUT}/house/{name}.png"; img.save(p)
    return name, {"path":p,"size":img.size,"mode":img.mode,"elapsed_s":round(time.time()-t0,1)}
with ThreadPoolExecutor(3) as ex:
    log=dict(ex.map(run, TIERS))
json.dump(log, open(f"{OUT}/house/log.json","w"), indent=2); print(json.dumps(log,indent=1))
