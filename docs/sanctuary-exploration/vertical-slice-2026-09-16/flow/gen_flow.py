import sys, json, time
sys.path.insert(0, ".")
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from merceka_core.image import edit_image
from merceka_core import costs as _mcosts
OUT=sys.argv[1]; MODEL="openai/gpt-image-2.5-sunburst"
R="/Users/base/dev/appletolye/fabrikav2/"; W=R+".worktrees/ftd-collection/"; G=W+"games/find_the_bird/"; S=W+"docs/sanctuary-exploration/vertical-slice-2026-09-16/"
SG=json.load(open(G+"design/style-guide.json"))
STYLE=(" UI style: "+SG["phrases"]["rendering"]+". "+SG["phrases"]["finish"]+". Avoid: "+"; ".join([n for n in SG["negative"] if "text" not in n])+".")
# reference sheet, portrait 1024x1536
def fit(p,box):
    im=Image.open(p).convert("RGBA"); im.thumbnail(box); return im
ref=Image.new("RGB",(1024,1536),(243,235,220))
ref.paste(fit(R+"docs/evidence/2026-09-05-ftb-ios-regressions/assets/settings-no-pickup-menu.png",(470,1020)),(8,8))
hud=fit(R+"docs/evidence/2026-09-14-ftb-android-tutorial/assets/cycle3-finished.png",(470,260)); ref.paste(hud.crop((0,40,hud.width,140)),(500,8))
ref.paste(fit(G+"public/ui/navigation/nav-bar-3.png",(500,160)),(500,120))
for i,n in enumerate(("robin","bluejay","thrush")): ref.paste(fit(S+f"v3/card_{n}.png",(160,200)),(500+i*170,290),fit(S+f"v3/card_{n}.png",(160,200)))
for i,t in enumerate(("v3/house_tier1","v4/house_tier2")): im=fit(S+t+".png",(250,250)); ref.paste(im,(500+i*255,500),im)
for i,n in enumerate(("sparrow","robin","bluebird")): im=fit(S+f"top5/bird_{n}_plain.png",(150,150)); ref.paste(im,(500+i*165,770),im)
im=fit(S+"v4/tree.png",(500,560)); ref.paste(im,(8,1040) if False else (500,940)); 
ref.save(f"{OUT}/reference_sheet.png")
REF=("The attached image is a reference sheet from the mobile game Find the Bird: left, the shipped Settings screen (olive header with a round wooden back button and a chunky drop-shadow title, honey-wood-rimmed cream panel, rounded cream rows with round icons, pill buttons); top right, the in-game HUD pills (feather counter, coin pill with a green plus, gear); "
     "the shipped 3-bay bottom nav bar; three collection portrait cards; the tier-1 and tier-2 nest-box houses with branch pedestals; three plain birds (sparrow, robin, bluebird); and a tree layout concept. "
     "Use these ONLY as the style, chrome and asset reference. Produce a NEW full phone screen mockup, portrait 9:16, same chrome language (olive header bar with back button and title, honey-rimmed cream panels, cream rows, olive and sky-blue pill buttons, coin pill top right). Keep text minimal, large and legible, in the same chunky rounded font. ")
SCREENS={
 "1_collection_day1": "SCREEN: 'Collection'. Under the header, one honey-rimmed cream panel holding THREE portrait cards in a row. Card 1 SPARROW: the sparrow peeking from its round porthole, full colour, a small progress bar under it reading '6 / 12' and the label 'Unlock', a small 'ACTIVE' ribbon. Card 2 ROBIN and card 3 BLUEBIRD: the same card frame but the porthole shows only a dark bird silhouette with a question mark, a small gold padlock on the frame, labels 'Next' and 'Then'. Below the panel a short hint row: 'Find sparrows in levels to unlock'. Bottom: the 3-bay nav bar with Sanctuary (locked, padlock), Collection (selected), Shop.",
 "2_first_unlock": "SCREEN: 'Collection', the moment the sparrow card completes. The sparrow card is large in the centre with a gold glow and a few sparkles, its progress bar full '12 / 12', a ribbon 'UNLOCKED'. A celebratory cream banner across the screen reads 'Sanctuary opened!' with a small tier-1 nest-box house icon, and a big sky-blue pill button 'Place sparrow'. The robin card below now shows 'ACTIVE  0 / 16'. The bottom nav bar's Sanctuary bay glows with its padlock falling off.",
 "3_sanctuary_day1": "SCREEN: 'Sanctuary'. The screen is the tall oak tree: trunk up the centre, warm cream sky, soft foliage. On the lowest right branch sits the tier-1 nest box on its branch pedestal, the SPARROW standing full-body on the pedestal facing the camera, a small coin sack hanging from the branch with a tiny '+3' coin bubble. Under the house a honey-rimmed pill button 'Upgrade  300' with a coin icon. Two higher branches are empty build slots each with a small wooden signpost and a rolled blueprint and the words 'Coming soon'. Coin pill top right shows '145'. Bottom: the 3-bay nav bar with Sanctuary selected.",
 "4_upgrade_preview": "SCREEN: 'Sanctuary' with the upgrade sheet open. The tier-1 nest box is on its branch with the sparrow; over it a translucent ghost preview of the tier-2 house (the annex and a second branch pedestal appear as a light blue-white outline overlay). A bottom sheet panel, honey-rimmed cream, reads 'Tier 2' with a row of two small icons '+1 perch' and '+coins per hour', and two pill buttons: olive 'Later' and sky-blue 'Upgrade  300' with a coin icon. Coin pill top right '145'.",
 "5_place_picker": "SCREEN: 'Sanctuary' with the placement picker open. The tier-2 nest box sits on the branch, the sparrow on the left pedestal; the RIGHT pedestal is empty and highlighted with a dotted cream outline and a small question-mark bird. A bottom sheet panel 'Who moves in?' shows the three portrait cards in a row: ROBIN in full colour with a sky-blue 'Place' pill under it, SPARROW greyed with the label 'Housed', BLUEBIRD as a locked silhouette with a padlock and '0 / 20'. Coin pill top right.",
}
def run(n):
    t0=time.time()
    with _mcosts.attribution({"app":"ftb-sanctuary-slice","operation":"flow-"+n,"model":MODEL}):
        img=edit_image(ref, REF+SCREENS[n]+STYLE, model=MODEL, resize_to_input=True, quality="high")
    img.save(f"{OUT}/{n}.png"); return n, img.size, round(time.time()-t0,1)
with ThreadPoolExecutor(5) as ex: print(list(ex.map(run,SCREENS)))
