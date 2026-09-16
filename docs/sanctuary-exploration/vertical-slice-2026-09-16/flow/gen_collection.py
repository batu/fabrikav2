import sys, json, time
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
REF=("The attached image is a reference sheet from the mobile game Find the Bird: the shipped Settings screen (olive header, round wooden back button, chunky drop-shadow title, honey-wood-rimmed cream panel, cream rows, pill buttons), HUD pills, the 3-bay bottom nav bar, three portrait cards, nest-box houses, three plain birds (sparrow, robin, bluebird). "
     "Use these ONLY as the style, chrome and asset reference. Produce a NEW full phone screen mockup, portrait 9:16, same chrome language. Text minimal, large, legible, same chunky rounded font. ")
S={
 "c1_cabinet": "SCREEN 'Collection': a tall painted-wood display CABINET fills the panel, two wooden shelves. TOP shelf, three framed portrait cards standing upright: SPARROW in full colour peeking from its porthole with a small progress bar '6 / 12' under it, ROBIN and BLUEBIRD as dark silhouettes with a question mark and a small gold padlock, small numerals '2' and '3' on their frames showing unlock order. A small brass shelf plaque reads 'Garden birds  0 / 3'. BOTTOM shelf is empty except a small wooden sign 'More birds soon' and a little potted plant. Bottom: 3-bay nav bar, Sanctuary locked, Collection selected, Shop.",
 "c2_detail": "SCREEN 'Collection' with a card DETAIL sheet open over a dimmed cabinet: a large sparrow portrait card at the top (sparrow peeking from its porthole, full colour), the name 'Sparrow' on a wooden plaque, a progress bar '6 / 12  Unlock' with the next threshold, and under it a vertical LADDER of five rungs as small rows with icons and labels: 'Discovered' (checked), 'Unlocked' (12, a small house icon), 'Scarf' (20), 'Cap and jacket' (35), 'Master' (60, a small star). One big sky-blue pill button at the bottom 'Find more sparrows' with a small play icon. A small round close X top right of the sheet.",
 "c3_album_grid": "SCREEN 'Collection' as an ALBUM: honey-rimmed cream panel with a 2-column grid of six square card slots. Slot 1 SPARROW in colour with '6 / 12'; slots 2 and 3 ROBIN and BLUEBIRD silhouettes with question marks and padlocks; slots 4 to 6 empty dotted frames. A page indicator '1 / 1' under the grid. Bottom: 3-bay nav bar, Collection selected.",
}
def run(n):
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"collection-"+n,"model":MODEL}):
        img=edit_image(ref, REF+S[n]+STYLE, model=MODEL, resize_to_input=True, quality="high")
    img.save(f"{OUT}/{n}.png"); img.convert("RGB").save(f"{OUT}/{n}.jpg",quality=86); return n
with ThreadPoolExecutor(3) as ex: print(list(ex.map(run,S)))
