import sys, json, time
sys.path.insert(0, ".")
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import edit_image
from merceka_core import costs as _mcosts
OUT=sys.argv[1]; MODEL="openai/gpt-image-2.5-sunburst"
SG=json.load(open("/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird/design/style-guide.json"))
STYLE=(" Style: "+SG["phrases"]["rendering"]+". "+SG["phrases"]["shape"]+". "+SG["phrases"]["finish"]+". "+SG["phrases"]["lighting"]+". Avoid: "+"; ".join(SG["negative"])+". Flat plain cream background #F3EBDC, nothing else in frame, no text.")
ref=Image.open("/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird/public/ui/sanctuary/sanctuary-nav-icon.png").convert("RGBA")
bg=Image.new("RGB",(1024,1024),(243,235,220)); r=ref.resize((900,900)); bg.paste(r,(62,62),r)
REF=("The attached image is the shipped Sanctuary icon of the mobile game Find the Bird: two traditional nest-box birdhouses on an oak branch. Use it ONLY as the style and house-design reference. "
  "Produce a NEW single image: ONE traditional nest-box birdhouse of that same design (simple box, chunky shingle roof in sage green, one round hole with a wooden rim, one short perch peg, sitting on a short oak branch stub with two leaves), tier one, large in frame. ")
BIRD="The resident is a European robin: small, round, chubby storybook bird, warm brown back, bright orange-red face and breast, cream belly, big friendly eye, wearing a tiny olive green scarf and a small straw hat, with a small brown satchel on its hip. "
C={
 "1_front_peek":   "CAMERA: strict straight-on orthographic front view, no perspective. OCCUPANCY: the robin peeks out of the round hole, head and upper chest inside the rim, the rim overlapping its body, one wing resting on the rim.",
 "2_front_perch":  "CAMERA: strict straight-on orthographic front view, no perspective. OCCUPANCY: the robin stands on the perch peg in front of the hole in full side profile facing right, whole body, hat, scarf and satchel visible, feet gripping the peg, soft contact shadow on the house wall.",
 "3_threequarter_perch": "CAMERA: three-quarter view from slightly above and to the left, so the roof top and the left side wall are visible with gentle depth. OCCUPANCY: the robin stands on the perch peg turned three-quarters toward the camera, whole body and costume visible.",
 "4_lowangle_roof":"CAMERA: slight low angle looking up at the house on its branch, roof edge prominent. OCCUPANCY: the robin sits proudly on the roof ridge next to the chimney-less peak, whole body visible, like a lookout.",
 "5_front_branch": "CAMERA: strict straight-on orthographic front view, no perspective. OCCUPANCY: the robin stands on the oak branch beside the house entrance at full size, whole body and costume visible, the house is its backdrop; the hole is empty and dark.",
 "6_cutaway_room": "CAMERA: strict straight-on front view. OCCUPANCY: dollhouse cutaway, the front wall is open like a hinged door revealing a tiny cozy room inside: the robin sits on a small nest bed inside, a tiny lantern and a hook holding its straw hat and satchel on the wall; the roof and outer walls stay intact.",
}
def run(n):
    t0=time.time()
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"concept-"+n,"model":MODEL}):
        img=edit_image(bg, REF+BIRD+C[n]+STYLE, model=MODEL, resize_to_input=True, quality="high")
    img.save(f"{OUT}/{n}.png"); return n, round(time.time()-t0,1)
with ThreadPoolExecutor(6) as ex: print(dict(ex.map(run,C)))
