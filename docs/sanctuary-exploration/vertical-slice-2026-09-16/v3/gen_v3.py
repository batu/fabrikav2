import sys, json, time
sys.path.insert(0, ".")
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import generate_image, edit_image
from merceka_core import costs as _mcosts
OUT=sys.argv[1]; MODEL="openai/gpt-image-2.5-sunburst"
SG=json.load(open("/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird/design/style-guide.json"))
STYLE=(" Style: "+SG["phrases"]["rendering"]+". "+SG["phrases"]["shape"]+". "+SG["phrases"]["finish"]+". "+SG["phrases"]["lighting"]+". Avoid: "+"; ".join(SG["negative"])+". Strict straight-on orthographic front view, no perspective, no text.")
HOUSE=("A traditional nest-box birdhouse for a cozy mobile game: simple pale pine plank box, chunky sage-green felt-like shingle roof with a peak, one round entrance hole with a thick wooden rim, one short wooden perch peg under the hole, "
  "the box sits on a thick oak branch that runs left to right under it and extends to the LEFT as a flat sturdy branch platform where a bird can stand, with two olive oak leaves. ")
def att(op): return _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"v3-"+op,"model":MODEL})
def tier1():
    with att("house-tier1"): img=generate_image(HOUSE+"Tier one, one box, one branch stand. Single object centered, generous transparent margin, no background."+STYLE, model=MODEL, aspect_ratio="1:1", image_size="1K", transparent=True)
    img.save(f"{OUT}/house_tier1.png"); return img
def plate(img):
    bg=Image.new("RGB",img.size,(255,0,255)); bg.paste(img,(0,0),img); return bg
def key(img):
    a=np.asarray(img.convert("RGB")).astype(int); m=(a[...,0]>200)&(a[...,2]>200)&(a[...,1]<90)
    out=np.dstack([a.astype(np.uint8), (~m*255).astype(np.uint8)]); return Image.fromarray(out,"RGBA")
def grow(base, n, desc):
    p=("The attached image is a tier-one nest-box birdhouse sprite on a flat magenta background. Produce the SAME house upgraded to "+desc+
       " Keep the identical plank wood, sage roof, hole rim and branch style, same lighting, same straight-on front view. Keep the flat magenta background exactly, nothing else in frame.")
    with att("house-"+n): img=edit_image(plate(base), p+STYLE, model=MODEL, resize_to_input=True, quality="high")
    img.save(f"{OUT}/house_{n}_plate.png"); key(img).save(f"{OUT}/house_{n}.png")
CARDS={
 "robin":"a European robin: warm brown back, bright orange-red face and breast, cream belly, wearing a tiny olive green scarf",
 "bluejay":"a blue jay: cobalt blue crest and back, white face and belly, black necklace stripe, wearing a tiny red neckerchief",
 "thrush":"a song thrush: soft brown back, cream breast speckled with dark brown spots, wearing a tiny mustard yellow bow tie",
}
def card(n):
    p=("A collection portrait card for a cozy mobile game: a rounded-rectangle card of pale painted wood with a thick honey-wood frame and a small olive leaf sprig at the top corner, and inside it a ROUND porthole window like a birdhouse entrance hole with a thick wooden rim. "
       "Peeking out of the porthole from the chest up, filling it, is a small round chubby storybook bird, "+CARDS[n]+", big friendly eye, one wing resting on the rim. Only head, chest and the accessory are visible; the body is hidden inside. "
       "Single card centered, portrait orientation, generous transparent margin, no background."+STYLE)
    with att("card-"+n): img=generate_image(p, model=MODEL, aspect_ratio="1:1", image_size="1K", transparent=True)
    img.save(f"{OUT}/card_{n}.png")
with ThreadPoolExecutor(4) as ex:
    f1=ex.submit(tier1); fc=[ex.submit(card,n) for n in CARDS]; base=f1.result()
    f2=ex.submit(grow, base, "tier2", "tier two: two stacked boxes on one footprint, each with its own hole, rim and peg, a small sage eave between them, and the branch now has TWO flat stand platforms, one at each side of the house, each wide enough for a bird.")
    f3=ex.submit(grow, base, "tier3", "tier three: three stacked boxes on one footprint, each with its own hole, rim and peg, sage eaves between, a tiny lantern and a cream flower, and THREE flat branch stand platforms: left, right, and a higher side branch on the right, each wide enough for a bird.")
    [f.result() for f in fc+[f2,f3]]
print("done")
