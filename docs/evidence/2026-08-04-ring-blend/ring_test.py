"""Ring-marker blending experiment (Batu's option c).

Instead of a magenta-filled target, mark the target with a magenta RING on the
clean scene crop so the model sees the scene it must blend into. Recover the
cutout by diffing result vs clean crop; measure leakage outside the ring.
"""
import json, sys, time
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, "/Users/base/dev/appletolye/merceka-core")
sys.path.insert(0, "/Users/base/dev/appletolye/fabrikav2/tools/level-editor")
from merceka_core.image import edit_image

LV = Path("/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels/square_pirate_cove_flash_4k")
HERE = Path(__file__).parent
OUT = HERE / "out"; OUT.mkdir(exist_ok=True)
MODEL = "google/gemini-3.1-flash-image-preview"

PROMPT = (
  "This is a crop of an illustrated hidden-object scene. A magenta circle outline marks a target spot. "
  "Paint exactly one small charming bird INSIDE the marked circle, fully blended into the scene: "
  "sitting naturally on the surfaces that are there, with a soft contact shadow, matching the scene's "
  "illustration style, line weight, palette and lighting. The bird may be partially tucked behind "
  "scenery that is already in front of it. Then remove the magenta circle completely, restoring "
  "whatever it covered. CRITICAL: every pixel outside the circle, and every pixel inside the circle "
  "that is not the bird or its shadow, must remain EXACTLY as in the input. Do not restyle, recolor "
  "or redraw anything else."
)

def run(indices, ring_scale=1.0, tag="v1"):
    import numpy as np
    hbs = json.loads((LV/"hitboxes.json").read_text())
    clean = Image.open(LV/"bg_00.png").convert("RGB")
    cur = Image.open(LV/"color.png").convert("RGB")
    old = Image.open(LV/"color.pre-flatkey.png").convert("RGB")
    results = []
    for i in indices:
        hb = hbs[i]; cx, cy, r = hb["x"], hb["y"], int(hb["r"]*ring_scale)
        half = max(256, int(r*2.6))
        box = (max(0,cx-half), max(0,cy-half), min(clean.width,cx+half), min(clean.height,cy+half))
        crop = clean.crop(box)
        marked = crop.copy(); d = ImageDraw.Draw(marked)
        lx, ly = cx-box[0], cy-box[1]
        d.ellipse([lx-r, ly-r, lx+r, ly+r], outline=(255,0,255), width=10)
        t0=time.time()
        res = edit_image(marked, PROMPT, model=MODEL).convert("RGB")
        if res.size != crop.size: res = res.resize(crop.size, Image.LANCZOS)
        # diff-based recovery + leakage
        a = np.asarray(crop, dtype=int); b = np.asarray(res, dtype=int)
        diff = (abs(a-b).sum(axis=2) > 40)
        yy, xx = np.mgrid[0:crop.height, 0:crop.width]
        inside = ((xx-lx)**2 + (yy-ly)**2) <= (r+14)**2
        leak = int((diff & ~inside).sum()); changed = int(diff.sum())
        results.append({"i": i, "leakOutsideRing": leak, "changedPx": changed,
                        "leakFrac": round(leak/max(1,changed), 3), "secs": round(time.time()-t0,1)})
        for name, img in (("a_oldpaint", old.crop(box)), ("b_current", cur.crop(box)),
                          ("c_marked_input", marked), ("c_result", res)):
            img.save(OUT/f"dog{i:02d}_{tag}_{name}.png")
        # extraction preview: changed pixels inside ring on checker
        ext = Image.new("RGB", crop.size, (200,200,200))
        m = Image.fromarray(((diff & inside)*255).astype('uint8'))
        ext.paste(res, (0,0), m); ext.save(OUT/f"dog{i:02d}_{tag}_c_extract.png")
        print(results[-1], flush=True)
    (OUT/f"ledger_{tag}.json").write_text(json.dumps(results, indent=1))

if __name__ == "__main__":
    run([int(x) for x in sys.argv[1].split(",")], tag=sys.argv[2] if len(sys.argv)>2 else "v1")
