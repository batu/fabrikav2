"""Gate C: does the device screen still match the approved design sheets?

Pairs a device capture with the panel of the design exploration it was drawn
from and asks whether the composition and asset placement still agree.
Differences in chrome (header bar, nav bar, live text) are expected and are
explicitly excluded; anything else is a regression against what was approved.
"""
import base64, io, json, os, sys
from concurrent.futures import ThreadPoolExecutor
import httpx
from PIL import Image

ROOT = "/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection"
CAPS = f"{ROOT}/docs/evidence/2026-09-16-ftb-collection-sanctuary/captures"
SHEETS = f"{ROOT}/docs/sanctuary-exploration/vertical-slice-2026-09-16/assets"
OUT = f"{ROOT}/docs/evidence/2026-09-16-ftb-collection-sanctuary/gate-c-verdicts.jsonl"
MODEL = "google/gemini-3.8-flash"
KEY = os.environ["OPENROUTER_API_KEY"]

# capture -> (design sheet, crop box in that sheet, what the pair should share)
PAIRS = [
    ("sanctuary-placed", "final_sheet.png", (0, 0, 1024, 1536),
     "a wooden nest box standing on an oak branch with a sparrow on the branch platform beside it"),
    ("sanctuary-tier3", "final_sheet.png", (2048, 0, 3072, 1536),
     "the largest nest box, with an annex, a lantern and a flower box, on the branch with a sparrow"),
    ("collection-unlocked", "cards_final.png", (530, 0, 1060, 780),
     "a wooden collection card with a round porthole holding a plain sparrow, a name plaque, a ribbon and a text bubble"),
    ("collection-cardigan", "cards_final.png", (1590, 0, 2120, 780),
     "a wooden collection card whose porthole holds a sparrow in a knitted beanie and cardigan"),
]

PROMPT = (
    "Two images of the same game screen design. IMAGE 1 is the approved design sheet. "
    "IMAGE 2 is a photograph of the built screen running on an iPhone.\n"
    "Both should show: {shared}\n"
    "Ignore differences of chrome and live data: the iOS status bar, the app's header bar and back "
    "button, the bottom navigation, any progress numbers, and overall crop or zoom.\n"
    "Judge whether the ARTWORK and its PLACEMENT still agree: same house, same bird, same relative "
    "position and proportion of the parts.\n"
    'Reply STRICT JSON only: {{"same_layout":true|false,"differences":["..."]}}'
)

def b64(im):
    im = im.convert("RGB"); im.thumbnail((640, 1000), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "WEBP", quality=85)
    return base64.b64encode(buf.getvalue()).decode()

def judge(pair, client):
    name, sheet, box, shared = pair
    cap = f"{CAPS}/{name}.png"
    if not os.path.exists(cap):
        return {"capture": name, "same_layout": False, "differences": ["capture missing"]}
    ref = b64(Image.open(f"{SHEETS}/{sheet}").crop(box))
    got = b64(Image.open(cap))
    err = None
    for _ in range(3):
        try:
            r = client.post("https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {KEY}"},
                json={"model": MODEL, "max_tokens": 1500, "messages": [{"role": "user", "content": [
                    {"type": "text", "text": PROMPT.format(shared=shared)},
                    {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{ref}"}},
                    {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{got}"}}]}]},
                timeout=180)
            if r.status_code != 200: err = f"http {r.status_code}"; continue
            text = r.json()["choices"][0]["message"]["content"]
            s, e = text.find("{"), text.rfind("}")
            v = json.loads(text[s:e+1])
            return {"capture": name, "sheet": sheet,
                    "same_layout": bool(v.get("same_layout")),
                    "differences": v.get("differences", [])}
        except Exception as ex:
            err = repr(ex)[:140]
    return {"capture": name, "same_layout": False, "differences": [f"model did not answer: {err}"]}

with httpx.Client() as client, ThreadPoolExecutor(4) as ex:
    results = list(ex.map(lambda p: judge(p, client), PAIRS))
with open(OUT, "w") as f:
    for r in results: f.write(json.dumps(r) + "\n")
bad = [r for r in results if not r["same_layout"]]
for r in results:
    print(("MATCH " if r["same_layout"] else "DIFFER"), r["capture"], r["differences"] or "")
print(f"gate C: {len(results)-len(bad)}/{len(results)} match -> {OUT}")
sys.exit(1 if bad else 0)
