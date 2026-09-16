import sys, json, time
sys.path.insert(0, ".")
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import edit_image
from merceka_core import costs as _mcosts
OUT=sys.argv[1]; MODEL="openai/gpt-image-2.5-sunburst"
SG=json.load(open("/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird/design/style-guide.json"))
STYLE=(" Keep the exact same style: "+SG["phrases"]["rendering"]+". "+SG["phrases"]["finish"]+". Avoid: "+"; ".join(SG["negative"])+".")
house=Image.open(f"{OUT}/house_tier3.png"); bg=Image.new("RGB",house.size,(255,0,255)); bg.paste(house,(0,0),house)
PROMPTS={
 "occupied": ("The attached image is a three-story painted-wood birdhouse sprite on a flat magenta background. Do NOT change the birdhouse, its colours, its outline or the magenta background at all. "
   "ADD three small round chubby storybook birds that live in it, rendered in the same handmade painted-wood-and-felt style with soft 3D volume and big friendly eyes: "
   "TOP hole: a European robin (warm brown back, bright orange-red face and breast, cream belly) peeking out of the hole, head and chest visible inside the rim, wearing a tiny olive green scarf. "
   "MIDDLE hole: a blue jay (cobalt blue crest and back, white face and belly, black necklace stripe) sitting on the wooden perch peg in front of the hole, whole body visible, wearing a tiny red neckerchief and a small straw hat. "
   "BOTTOM hole: a song thrush (soft brown back, cream speckled breast) peeking out of the hole, plain, no accessory. "
   "The birds must look physically inside and on the house: rim of the hole overlaps the peeking birds, feet grip the peg, soft contact shadows, same lighting from upper left."+STYLE),
 "one_slot": ("The attached image is a three-story painted-wood birdhouse sprite on a flat magenta background. Do NOT change the birdhouse or the magenta background. "
   "ADD exactly ONE small round chubby storybook European robin (warm brown back, bright orange-red face and breast, cream belly) peeking out of the TOP hole only, head and chest inside the rim, the rim overlapping its body, soft contact shadow. Leave the other two holes empty and dark."+STYLE),
}
def run(n):
    t0=time.time()
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"v2-integration-"+n,"model":MODEL}):
        img=edit_image(bg, PROMPTS[n], model=MODEL, resize_to_input=True, quality="high")
    p=f"{OUT}/integration_{n}.png"; img.save(p); return n,{"size":img.size,"s":round(time.time()-t0,1)}
with ThreadPoolExecutor(2) as ex: print(json.dumps(dict(ex.map(run,PROMPTS))))
