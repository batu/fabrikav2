import sys, json
sys.path.insert(0, ".")
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import edit_image
from merceka_core import costs as _mcosts
OUT=sys.argv[1]; MODEL="openai/gpt-image-2.5-sunburst"
G="/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird/"
SG=json.load(open(G+"design/style-guide.json"))
STYLE=(" UI style: "+SG["phrases"]["rendering"]+". "+SG["phrases"]["finish"]+". Avoid: "+"; ".join([n for n in SG["negative"] if "text" not in n])+".")
ref=Image.open(f"{OUT}/reference_sheet.png"); ref.load()
REF=("The attached image is a reference sheet from the mobile game Find the Bird: the shipped Settings screen (olive header, round wooden back button, chunky drop-shadow title, honey-wood-rimmed cream panel, pill buttons), HUD pills, the 3-bay bottom nav bar, portrait cards, nest-box houses on branches, three plain birds (sparrow, robin, bluebird). "
     "Use these ONLY as the style, chrome and asset reference. Produce a NEW full phone screen mockup, portrait 9:16, same chrome language. Text large and legible, same chunky rounded font. ")
S={
 "d1_card_sparrow": "SCREEN 'Collection' as a SWIPE DECK: one big honey-rimmed cream card fills almost the whole screen with the edges of the neighbouring cards peeking in at left and right. On the card: a large round porthole portrait of the SPARROW peeking out (full colour, big friendly eyes), a wooden name plaque 'Sparrow', a small ribbon 'Garden bird', three short lines of personality copy in a cream speech-bubble panel: 'Loud. Opinionated. Never on time.' / 'Will fight a pigeon for a crumb.' / 'Loves: your sandwich.' Under that a progress bar '6 / 12' with the label 'Unlock', and a big sky-blue pill button 'Find sparrows'. Below the card, three small page dots with the first active. Bottom: 3-bay nav bar, Collection selected.",
 "d2_card_robin_locked": "SCREEN 'Collection' as a SWIPE DECK: one big honey-rimmed cream card fills almost the whole screen, edges of the neighbouring cards peeking at left and right. On the card: a large round porthole showing only a dark ROBIN silhouette with a question mark and a gold padlock on the rim, the name plaque reads '? ? ?', the personality panel shows three lines of dashes as hidden text, a progress bar '0 / 16' with the label 'Locked  ·  unlocks after Sparrow', an olive pill button 'Next'. Page dots with the second active. Bottom: 3-bay nav bar, Collection selected.",
 "s1_three_houses": "SCREEN 'Sanctuary', a single non-scrolling screen: one big oak tree fills the screen, warm cream sky, soft foliage. THREE traditional nest-box birdhouses sit on three branches at different heights (low left, middle right, high left), each with a flat branch pedestal in front of it. The low-left pedestal has the SPARROW standing full-body facing the camera. The other two pedestals are empty, each with a dotted cream outline and a small question-mark bird. A coin pill top right shows '145'. Bottom: 3-bay nav bar with Sanctuary selected. No buttons on the scene.",
}
def run(n):
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"simple-"+n,"model":MODEL}):
        img=edit_image(ref, REF+S[n]+STYLE, model=MODEL, resize_to_input=True, quality="high")
    img.save(f"{OUT}/{n}.png"); img.convert("RGB").save(f"{OUT}/{n}.jpg",quality=86); return n
with ThreadPoolExecutor(3) as ex: print(list(ex.map(run,S)))
