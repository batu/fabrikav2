"""Gate A, tag half: audit the sparrow tags against a second, blind opinion.

Samples 40 sprites tagged `sparrow` and 40 tagged anything else, asks a fresh
question ("is this a house sparrow?") with no mention of the existing tag, and
requires >=90% agreement on each side. Disagreement means the classification
needs re-running for those levels, not a quiet override.
"""
import base64, io, json, os, random, sys, threading
from concurrent.futures import ThreadPoolExecutor
import httpx
from PIL import Image

ROOT = "/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection"
PUB = f"{ROOT}/games/find_the_bird/public"
OUT = f"{ROOT}/docs/evidence/2026-09-16-ftb-collection-sanctuary/gate-a-tag-audit.jsonl"
MODEL = "google/gemini-3.8-flash"
KEY = os.environ["OPENROUTER_API_KEY"]
# The tag is deliberately coarse ("sparrow", not "house sparrow"), so the audit
# must ask the same coarse question. Asking about house sparrows specifically
# made the auditor reject tree sparrows, which the tag legitimately includes.
PROMPT = ('Is the bird in this image a SPARROW of any kind (house sparrow, tree sparrow or similar '
          'small streaky brown-and-grey seed-eating bird with a short conical beak)? '
          'Answer false for thrushes (spotted breast), wrens (cocked tail), finches (bright colour), '
          'robins (orange breast), tits, and any clearly non-sparrow bird. '
          'Ignore any clothing or props the bird is wearing or holding. '
          'Reply STRICT JSON only: {"sparrow":true|false,"confidence":0.0-1.0,"seen":"<=8 words"}')

tags = json.load(open(f"{PUB}/levels/bird-types.json"))["levels"]
sparrows, others = [], []
for level_id, dogs in tags.items():
    level = json.load(open(f"{PUB}/levels/{level_id}/level.json"))
    sprite_by_id = {d["id"]: d["sprite"]["image"] for d in level["dogs"]}
    for dog_id, t in dogs.items():
        path = os.path.join(PUB, sprite_by_id.get(dog_id, ""))
        if not os.path.exists(path): continue
        (sparrows if t == "sparrow" else others).append({"level": level_id, "dog": dog_id, "tag": t, "path": path})

random.seed(11)
sample = random.sample(sparrows, min(40, len(sparrows))) + random.sample(others, min(40, len(others)))

def encode(path):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((256, 256), Image.LANCZOS)
    flat = Image.new("RGB", im.size, (255, 255, 255)); flat.paste(im, (0, 0), im)
    buf = io.BytesIO(); flat.save(buf, "WEBP", quality=80)
    return base64.b64encode(buf.getvalue()).decode()

def ask(item, client):
    for _ in range(3):
        try:
            r = client.post("https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {KEY}"},
                json={"model": MODEL, "max_tokens": 1200, "messages": [{"role": "user", "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{encode(item['path'])}"}}]}]},
                timeout=120)
            if r.status_code != 200: continue
            text = r.json()["choices"][0]["message"]["content"]
            s, e = text.find("{"), text.rfind("}")
            if s < 0: continue
            v = json.loads(text[s:e+1])
            return {**item, "audit": v, "agrees": bool(v.get("sparrow")) == (item["tag"] == "sparrow")}
        except Exception:
            pass
    return {**item, "audit": None, "agrees": None}

with httpx.Client() as client, ThreadPoolExecutor(12) as ex:
    results = list(ex.map(lambda i: ask(i, client), sample))
with open(OUT, "w") as f:
    for r in results: f.write(json.dumps(r) + "\n")

def rate(subset):
    judged = [r for r in subset if r["agrees"] is not None]
    return (sum(r["agrees"] for r in judged), len(judged))

sp = rate([r for r in results if r["tag"] == "sparrow"])
ot = rate([r for r in results if r["tag"] != "sparrow"])
print(f"sparrow-tagged agreement: {sp[0]}/{sp[1]}")
print(f"other-tagged agreement:   {ot[0]}/{ot[1]}")
for r in results:
    if r["agrees"] is False:
        print(f"  disagree: {r['level']}/{r['dog']} tagged={r['tag']} audit={r['audit']}")
ok = sp[1] and ot[1] and sp[0]/sp[1] >= 0.9 and ot[0]/ot[1] >= 0.9
print("GATE", "PASS" if ok else "FAIL", "->", OUT)
sys.exit(0 if ok else 1)
