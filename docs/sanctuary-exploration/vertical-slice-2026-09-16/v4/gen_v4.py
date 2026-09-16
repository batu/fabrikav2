import sys, json, time
sys.path.insert(0, ".")
import numpy as np
from PIL import Image
from scipy import ndimage
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import generate_image, edit_image
from merceka_core import costs as _mcosts
OUT=sys.argv[1]; V3=OUT.replace("/v4","/v3"); MODEL="openai/gpt-image-2.5-sunburst"
SG=json.load(open("/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird/design/style-guide.json"))
STYLE=(" Style: "+SG["phrases"]["rendering"]+". "+SG["phrases"]["shape"]+". "+SG["phrases"]["finish"]+". "+SG["phrases"]["lighting"]+". Avoid: "+"; ".join(SG["negative"])+". No text.")
def att(op): return _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"v4-"+op,"model":MODEL})
B={
 "robin":  dict(d="a European robin: warm brown back and wings, bright orange-red face and breast, cream belly", a="a tiny olive green scarf", c="a tiny green flat cap and a small olive explorer jacket", m="a small brown leather satchel and a tiny gold star pin on the cap"),
 "bluejay":dict(d="a blue jay: cobalt blue crest and back, white face and belly, black necklace stripe, black-and-white barred wing tips", a="a tiny red neckerchief", c="a tiny straw sun hat and a small tan vest", m="a small brown leather satchel and a tiny gold star pin on the hat"),
 "thrush": dict(d="a song thrush: soft brown back, cream breast speckled with dark brown spots", a="a tiny mustard yellow bow tie", c="a tiny brown bowler hat and a small charcoal waistcoat", m="a small brown leather satchel and a tiny gold star pin on the hat"),
}
def birds(n):
    b=B[n]
    p=("A horizontal row of exactly FOUR separate copies of the SAME small round chubby storybook bird, evenly spaced with clear gaps. POSE: standing, body turned THREE-QUARTERS toward the viewer (front-left three-quarter view), head turned to look almost straight at the camera with BOTH eyes visible, friendly and curious, both feet flat on the same invisible floor line so all four birds' feet are at exactly the same height. "
       "Left to right: 1 plain; 2 wearing "+b["a"]+"; 3 wearing "+b["a"]+" plus "+b["c"]+"; 4 wearing "+b["a"]+", "+b["c"]+" plus "+b["m"]+". The bird is "+b["d"]+", big friendly eyes, small beak. Body shape, colours and face identical in all four. No background, no ground, no shadow."+STYLE)
    with att("birds-"+n): img=generate_image(p, model=MODEL, aspect_ratio="16:9", image_size="1K", transparent=True)
    img.save(f"{OUT}/birds_{n}_row.png")
    a=np.asarray(img)[...,3]>8; lab,k=ndimage.label(ndimage.binary_dilation(a,iterations=8))
    boxes=sorted([s for s in ndimage.find_objects(lab) if (s[0].stop-s[0].start)>150], key=lambda s:s[1].start)
    for st,s in zip(("plain","accessory","costume","mastered"),boxes): img.crop((s[1].start,s[0].start,s[1].stop,s[0].stop)).save(f"{OUT}/bird_{n}_{st}.png")
    return n,len(boxes)
base=Image.open(f"{V3}/house_tier1.png")
def plate(img): bg=Image.new("RGB",img.size,(255,0,255)); bg.paste(img,(0,0),img); return bg
def key(img):
    a=np.asarray(img.convert("RGB")).astype(int); m=(a[...,0]>200)&(a[...,2]>200)&(a[...,1]<90)
    return Image.fromarray(np.dstack([a.astype(np.uint8),(~m*255).astype(np.uint8)]),"RGBA")
def grow(n,desc):
    p=("The attached image is a tier-one nest-box birdhouse on an oak branch, sprite on a flat magenta background. Produce the SAME house upgraded to "+desc+
       " The upgrade grows OUTWARD and sideways, claiming more of the branch, not just taller: the silhouette must get wider and more asymmetric and exciting. Keep the identical plank wood, sage roof, hole rim, branch style and lighting, straight-on front view. Every bird stand is a flat wooden platform or flat branch top. Keep the flat magenta background exactly, everything fully inside the frame."+STYLE)
    with att("house-"+n): img=edit_image(plate(base), p, model=MODEL, resize_to_input=True, quality="high")
    img.save(f"{OUT}/house_{n}_plate.png"); key(img).save(f"{OUT}/house_{n}.png"); return n
def tree():
    p=("Vertical phone-screen concept art for the Sanctuary screen of a cozy mobile game: one huge oak trunk runs up the centre of the frame, big branches alternate left and right at rising heights. "
       "On the lowest right branch: a grand tier-three nest-box birdhouse complex with an annex, a small deck with a swing, a lantern and three flat wooden bird stands. On the next left branch higher up: a simple tier-one nest box on its branch stand. "
       "Two branches higher up are EMPTY build slots, each marked with a small wooden signpost and a rolled blueprint. Soft distant foliage and a warm cream sky behind, a few olive leaves, no birds. Straight-on front view, no perspective on the houses."+STYLE)
    with att("tree"): img=generate_image(p, model=MODEL, aspect_ratio="9:16", image_size="1K")
    img.save(f"{OUT}/tree.png"); return "tree"
with ThreadPoolExecutor(6) as ex:
    fs=[ex.submit(birds,n) for n in B]+[ex.submit(grow,"tier2","tier two: the original box plus a second smaller annex box attached at one side under its own little sage roof, a short plank walkway between them, and TWO flat bird stands: the branch platform on the left and a new branch platform on the right."),
        ex.submit(grow,"tier3","tier three: the original box, the side annex, plus a small raised deck on top of the annex with a tiny rope swing, a hanging lantern, a cream flower box, and a third branch reaching out the other side; THREE flat bird stands: left branch platform, right branch platform, and the raised deck."), ex.submit(tree)]
    print([f.result() for f in fs])
