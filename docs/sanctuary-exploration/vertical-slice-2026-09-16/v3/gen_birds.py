import sys, json, time
sys.path.insert(0, ".")
import numpy as np
from PIL import Image
from scipy import ndimage
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import generate_image
from merceka_core import costs as _mcosts
OUT=sys.argv[1]; MODEL="openai/gpt-image-2.5-sunburst"
SG=json.load(open("/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird/design/style-guide.json"))
STYLE=(" Style: "+SG["phrases"]["rendering"]+". "+SG["phrases"]["shape"]+". "+SG["phrases"]["finish"]+". "+SG["phrases"]["lighting"]+". Avoid: "+"; ".join(SG["negative"])+". No background, no ground, no shadow on the ground, no text.")
B={
 "robin":  dict(d="a European robin: warm brown back and wings, bright orange-red face and breast, cream belly", a="a tiny olive green scarf", c="a tiny green flat cap and a small olive explorer jacket", m="a small brown leather satchel and a tiny gold star pin on the cap"),
 "bluejay":dict(d="a blue jay: cobalt blue crest and back, white face and belly, black necklace stripe, black-and-white barred wing tips", a="a tiny red neckerchief", c="a tiny straw sun hat and a small tan vest", m="a small brown leather satchel and a tiny gold star pin on the hat"),
 "thrush": dict(d="a song thrush: soft brown back, cream breast speckled with dark brown spots", a="a tiny mustard yellow bow tie", c="a tiny brown bowler hat and a small charcoal waistcoat", m="a small brown leather satchel and a tiny gold star pin on the hat"),
}
def run(n):
    b=B[n]
    p=("A horizontal row of exactly FOUR separate copies of the SAME small round chubby storybook bird, evenly spaced with clear gaps, all facing LEFT, all in the identical standing pose with both feet flat on the same invisible floor line, "
       "so all four birds' feet are at exactly the same height. Left to right: 1 plain; 2 wearing "+b["a"]+"; 3 wearing "+b["a"]+" plus "+b["c"]+"; 4 wearing "+b["a"]+", "+b["c"]+" plus "+b["m"]+". "
       "The bird is "+b["d"]+", big friendly eye, small beak. Body shape, colours and face identical in all four."+STYLE)
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"v3-birds-"+n,"model":MODEL}):
        img=generate_image(p, model=MODEL, aspect_ratio="16:9", image_size="1K", transparent=True)
    img.save(f"{OUT}/birds_{n}_row.png")
    a=np.asarray(img)[...,3]>8; lab,k=ndimage.label(ndimage.binary_dilation(a,iterations=8))
    boxes=sorted([s for s in ndimage.find_objects(lab) if (s[0].stop-s[0].start)>150], key=lambda s:s[1].start)
    for st,s in zip(("plain","accessory","costume","mastered"),boxes):
        img.crop((s[1].start,s[0].start,s[1].stop,s[0].stop)).save(f"{OUT}/bird_{n}_{st}.png")
    return n,len(boxes)
with ThreadPoolExecutor(3) as ex: print(dict(ex.map(run,B)))
