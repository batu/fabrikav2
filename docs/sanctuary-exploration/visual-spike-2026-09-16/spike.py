import json, sys, os, time, traceback
sys.path.insert(0, ".")
from PIL import Image
from merceka_core.image import generate_image, edit_image
from merceka_core import costs as _mcosts
MODEL, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True)
REF = Image.open("/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/refs/art/mascot/02_p3-explorer-bluebird-turnaround.png").convert("RGB")
STYLE = ("Art style: bold flat-shaded cardstock illustration with crisp cut-paper cardboard depth and soft drop shadows, "
         "friendly storybook proportions, warm cream paper background, palette of cobalt blue, cream, olive green, saddle brown, charcoal, mustard gold. "
         "Never felt or plush, never realistic anatomy, no photoreal rendering. Mobile game UI asset quality. No text, no labels, no watermark.")
REFNOTE = ("The attached image is the locked mascot of the game Find the Bird (P3 Explorer Bluebird). Use it ONLY as the style and character-proportion reference. "
           "Do not reproduce the turnaround sheet; produce a completely NEW composition described below. ")
BRIEFS = {
 "house_cottage_stages": "A horizontal sheet of THREE birdhouses side by side showing one upgrade path of a cozy woodland cottage theme, left to right: stage 1 a simple wooden nest box on a branch stub with one round door; stage 2 the same box grown into a cottage with a shingle roof, two windows with shutters, a small perch balcony, one small songbird resident on the perch; stage 3 a grand two-story cottage with a chimney, flower boxes, a wraparound balcony, a lantern, and three small songbird residents. Each stage sits on a thick oak branch. Same style, same footprint growing upward.",
 "house_pagoda_stages": "A horizontal sheet of THREE birdhouses side by side showing one upgrade path of a Japanese garden pagoda theme, left to right: stage 1 a small square hut with a curved tile roof; stage 2 a two-tier pagoda with a red lantern, a tiny torii-gate perch, one small songbird resident; stage 3 a three-tier pagoda with a bell, a bridge perch, a bonsai on the branch, and three small songbird residents. Each stage sits on a thick oak branch.",
 "house_tiki_stages": "A horizontal sheet of THREE birdhouses side by side showing one upgrade path of a tropical beach hut theme, left to right: stage 1 a small palm-thatched hut; stage 2 a bigger hut with a bamboo deck, a hammock perch, tiki torches, one small songbird resident; stage 3 a stilted two-level hut with a surfboard leaning on it, a rope swing, string lights, and three small songbird residents. Each stage sits on a thick oak branch.",
 "portrait_states": "A 2x2 grid of collection portrait cards for ONE bird species, a round robin with an orange breast, in four states: top-left UNDISCOVERED, a dark silhouette of the robin on a faded card with a question mark; top-right DISCOVERED, the plain robin on a card with a thin frame; bottom-left RESIDENT, the same robin wearing a small green neckerchief on a card with a wooden frame and a small birdhouse icon; bottom-right MASTERED, the same robin wearing a tiny explorer cap, neckerchief and satchel on a card with an ornate gold frame and a laurel. Cards are identical size, portrait orientation, no text.",
 "costume_progression": "A horizontal row of FOUR versions of the SAME small round yellow finch, showing cosmetic milestone rewards in order: 1 plain finch; 2 finch with a red bandana; 3 finch with a red bandana and a tiny straw hat; 4 finch with bandana, straw hat, a small olive jacket and a leather satchel. The bird silhouette, colors and face stay identical so it is recognizable at small size. Each on a small round cream badge.",
 "tree_developed": "A tall vertical section of a huge old oak tree trunk filling the frame, a sanctuary for birds: four themed birdhouses on thick branches at different heights, a cozy cottage house, a Japanese pagoda house, a tropical hut, and one empty construction spot marked with a small wooden signpost and a rolled blueprint. Small songbirds of different colors sit on perches, balconies and branches, one in flight. Soft distant foliage behind, dappled light, warm cream sky. Composed for a phone screen that scrolls vertically.",
 "tree_early": "A tall vertical section of a huge old oak tree trunk filling the frame, early state of a bird sanctuary: only one small wooden nest-box birdhouse on a low branch with one small blue songbird sitting on its perch, and two empty branch spots higher up each marked with a small wooden signpost and a rolled blueprint. Bare readable branches, soft distant foliage behind, warm cream sky. Composed for a phone screen that scrolls vertically.",
}
log = {}
for name, brief in BRIEFS.items():
    t0 = time.time()
    try:
        with _mcosts.attribution({"app": "ftb-sanctuary-spike", "operation": name, "model": MODEL}):
            if name.startswith("tree"):
                img = generate_image(brief + " " + STYLE, model=MODEL, aspect_ratio="9:16", image_size="1K")
            else:
                kw = {"quality": "high"} if MODEL.startswith("openai/") else {}
                img = edit_image(REF, REFNOTE + brief + " " + STYLE, model=MODEL, resize_to_input=False, **kw)
        p = f"{OUT}/{name}.png"; img.save(p)
        log[name] = {"path": p, "size": img.size, "elapsed_s": round(time.time()-t0, 1)}
        print("OK", name, img.size, round(time.time()-t0, 1), flush=True)
    except Exception as e:
        log[name] = {"error": repr(e), "trace": traceback.format_exc()[-800:]}
        print("FAIL", name, repr(e), flush=True)
    json.dump(log, open(f"{OUT}/log.json", "w"), indent=2)
