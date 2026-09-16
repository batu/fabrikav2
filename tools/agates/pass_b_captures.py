"""Gate B: judge each device capture against the checklist row it is meant to show.

One call per capture with that row's expectation embedded, per the plan. The
model is told to fail on a missing element, clipped text, notch/home-indicator
collisions, or a sprite visibly mis-scaled against its house.
"""
import base64, io, json, os, sys
from concurrent.futures import ThreadPoolExecutor
import httpx
from PIL import Image

ROOT = "/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection"
CAPS = f"{ROOT}/docs/evidence/2026-09-16-ftb-collection-sanctuary/captures"
OUT = f"{ROOT}/docs/evidence/2026-09-16-ftb-collection-sanctuary/gate-b-verdicts.jsonl"
MODEL = "google/gemini-3.8-flash"
KEY = os.environ["OPENROUTER_API_KEY"]

ROWS = {
 "collection-locked":
   "The game's HOME screen. Both bottom-nav tiles 'Sanctuary' and 'Collection' must look LOCKED: "
   "greyed out and carrying a small gold padlock. The 'Shop' tile is normal.",
 "collection-silhouette":
   "The Collection page: one large card. The bird is NOT yet unlocked, so the round porthole shows a "
   "dark featureless SILHOUETTE with a padlock, the name plaque reads '? ? ?', the three personality "
   "lines are dashes rather than words, and a progress bar reads 6 / 10 labelled 'Unlock'.",
 "collection-unlocked":
   "The Collection page: one large card showing a PLAIN sparrow (no hat, no cardigan) in the round "
   "porthole, the name plaque reads 'Sparrow', a ribbon reads 'Garden bird', three readable "
   "personality lines about a sparrow, and a progress bar reading 10 / 20 labelled 'Hat'.",
 "collection-hat":
   "The Collection page: the sparrow in the porthole now wears a knitted BEANIE with a pom-pom. "
   "Name plaque 'Sparrow', and a progress bar reading 20 / 35 labelled 'Cardigan'.",
 "collection-cardigan":
   "The Collection page: the sparrow wears a knitted beanie AND a cream knitted cardigan with a "
   "scarf. The card is finished, so it reads 'Complete' instead of a numeric progress bar.",
 "sanctuary-nohouse":
   "The Sanctuary page: a big oak tree with a branch, NO birdhouse built yet, a wooden signpost/"
   "build marker on the branch, and a bottom sheet titled 'Build a nest box' with a price button.",
 "sanctuary-empty-perch":
   "The Sanctuary page: a wooden birdhouse stands on the branch and its perch is EMPTY, marked by a "
   "dotted outline of a bird with a question mark. No real bird is present.",
 "sanctuary-placed":
   "The Sanctuary page: a cartoon wooden birdhouse on a tree branch, with a cartoon sparrow standing "
   "on the flat wooden platform that juts out from the branch beside the house. That platform IS the "
   "bird's perch in this game, so a bird standing on it is CORRECT. Check the bird's feet actually "
   "rest on the wood rather than floating above it or overlapping the house.",
 "sanctuary-coins":
   "The Sanctuary page: a birdhouse with a sparrow on its perch, plus a pile of gold coins on the "
   "branch carrying a small '+3' badge.",
 "sanctuary-tier3":
   "The Sanctuary page: the LARGEST birdhouse (a multi-part house with an annex and a deck) on the "
   "branch, with a sparrow on a perch and two further empty perches marked with dotted question-mark "
   "outlines.",
}

PROMPT = (
    "This is a screenshot from an iPhone running the game Find the Bird.\n"
    "EXPECTATION: {expect}\n"
    "Judge only what is visible. Reply STRICT JSON only: "
    '{{"pass":true|false,"seen":"<=25 words","problems":["..."]}}. '
    "Set pass=false if an expected element is missing, if any text is clipped or overlaps another "
    "element, if content collides with the notch/status bar or the home indicator, or if a bird is "
    "visibly the wrong size relative to its birdhouse. Ignore the iOS status bar itself."
)

def judge(name, client):
    path = f"{CAPS}/{name}.png"
    if not os.path.exists(path):
        return {"row": name, "pass": False, "problems": ["capture missing"], "model": None}
    im = Image.open(path).convert("RGB")
    im.thumbnail((760, 1600), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "WEBP", quality=88)
    b64 = base64.b64encode(buf.getvalue()).decode()
    err = None
    for _ in range(3):
        try:
            r = client.post("https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {KEY}"},
                json={"model": MODEL, "max_tokens": 1500, "messages": [{"role": "user", "content": [
                    {"type": "text", "text": PROMPT.format(expect=ROWS[name])},
                    {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{b64}"}}]}]},
                timeout=180)
            if r.status_code != 200:
                err = f"http {r.status_code}"; continue
            text = r.json()["choices"][0]["message"]["content"]
            s, e = text.find("{"), text.rfind("}")
            v = json.loads(text[s:e+1])
            return {"row": name, "pass": bool(v.get("pass")), "seen": v.get("seen"),
                    "problems": v.get("problems", []), "model": MODEL}
        except Exception as ex:
            err = repr(ex)[:140]
    return {"row": name, "pass": False, "problems": [f"model did not answer: {err}"], "model": MODEL}

def main():
    names = sys.argv[1:] or list(ROWS)
    with httpx.Client() as client, ThreadPoolExecutor(6) as ex:
        results = list(ex.map(lambda n: judge(n, client), names))
    existing = []
    if os.path.exists(OUT):
        existing = [json.loads(l) for l in open(OUT) if json.loads(l)["row"] not in names]
    with open(OUT, "w") as f:
        for r in existing + results: f.write(json.dumps(r) + "\n")
    bad = [r for r in results if not r["pass"]]
    for r in results:
        print(("PASS " if r["pass"] else "FAIL "), r["row"], "|", r.get("seen") or r["problems"])
        if not r["pass"]:
            for p in r["problems"]: print("        -", p)
    print(f"gate B: {len(results)-len(bad)}/{len(results)} pass -> {OUT}")
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
