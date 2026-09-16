import sys, json, time
sys.path.insert(0, ".")
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import generate_image
from merceka_core import costs as _mcosts
OUT=sys.argv[1]; MODEL="openai/gpt-image-2.5-sunburst"
SG=json.load(open("/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird/design/style-guide.json"))
STYLE=(" Style: "+SG["phrases"]["rendering"]+". Shape: "+SG["phrases"]["shape"]+". Finish: "+SG["phrases"]["finish"]+". Lighting: "+SG["phrases"]["lighting"]+
  ". Palette: painted wood cream #f4ead1 / honey #d8bf8e / walnut #9b7445, sage green roof #82925e, sky blue #4d9cc4 accents, warm gold #d8a33e, a few olive leaves. "
  "Avoid: "+"; ".join(SG["negative"])+". Single object, straight-on front view, centered, generous transparent margin, no branch, no ground, no background.")
BASE="A cozy handmade painted-wood birdhouse for a mobile game, "
TIERS={
 "tier1": BASE+"tier one: one small rounded nest box with a chunky sage-green shingle roof, ONE round entrance hole with a thick cream rim, and one short wooden perch peg under the hole. Only one hole.",
 "tier2": BASE+"tier two, the SAME nest box grown taller: two stacked rounded stories on one footprint, each story has ONE round entrance hole with a thick cream rim and a short wooden perch peg, a small sage-green shingle eave between the stories, one tiny leaf sprig. Exactly two holes, one above the other.",
 "tier3": BASE+"tier three, the SAME nest box at its grandest: three stacked rounded stories on one footprint, each story has ONE round entrance hole with a thick cream rim and a short wooden perch peg, sage-green shingle eaves between stories, a tiny chimney, a small hanging lantern, a cream flower and leaf sprigs. Exactly three holes in a vertical column.",
}
def run(n):
    t0=time.time()
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"v2-house-"+n,"model":MODEL}):
        img=generate_image(TIERS[n]+STYLE, model=MODEL, aspect_ratio="1:1", image_size="1K", transparent=True)
    p=f"{OUT}/house_{n}.png"; img.save(p); return n,{"size":img.size,"mode":img.mode,"s":round(time.time()-t0,1)}
with ThreadPoolExecutor(3) as ex: log=dict(ex.map(run,TIERS))
print(json.dumps(log))
