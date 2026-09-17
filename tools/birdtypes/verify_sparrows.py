"""Second pass over every sprite tagged `sparrow`.

The broad classifier defaults small brown cartoon birds to "sparrow": a blind
audit found wrens, chickadees, finches and thrushes carrying the tag. Sparrow is
the only tag release 1 spends, so it gets its own binary verification with the
discriminating features spelled out, and anything that fails is demoted to
`unknown-songbird` rather than silently counting as a pickup.
"""
import base64, io, json, os, sys, threading
from concurrent.futures import ThreadPoolExecutor
import httpx
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PUB = os.path.join(ROOT, "games", "find_the_bird", "public")
SRC = os.path.join(HERE, "classified-ranked.jsonl")
KNOWN = os.path.join(HERE, "known.jsonl")
OUT = os.path.join(HERE, "sparrow-verdicts.jsonl")
MODEL = "google/gemini-3.8-flash"
KEY = os.environ["OPENROUTER_API_KEY"]

PROMPT = (
    "Look at this cartoon bird sprite. Ignore any clothing, hats or props it wears or holds. "
    "Decide if it is a SPARROW (house or tree sparrow): streaky brown and tan back, grey or "
    "chestnut crown, plain pale grey-cream underside with NO spots, short thick conical seed beak, "
    "tail held level. "
    "It is NOT a sparrow if it has: a spotted or speckled breast (thrush), a short tail cocked "
    "upright (wren), bright yellow/red/pink/blue plumage (finch, cardinal, bluebird), an orange "
    "or red breast (robin), a black cap with white cheeks (chickadee), or a crest. "
    'Reply STRICT JSON only: {"sparrow":true|false,"confidence":0.0-1.0,"seen":"<=8 words"}'
)

lock = threading.Lock()

def encode(path):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((320, 320), Image.LANCZOS)
    flat = Image.new("RGB", im.size, (255, 255, 255)); flat.paste(im, (0, 0), im)
    buf = io.BytesIO(); flat.save(buf, "WEBP", quality=85)
    return base64.b64encode(buf.getvalue()).decode()

def verify(item, client):
    for _ in range(3):
        try:
            r = client.post("https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {KEY}"},
                json={"model": MODEL, "max_tokens": 1200, "messages": [{"role": "user", "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{encode(item['sprite_abs'])}"}}]}]},
                timeout=120)
            if r.status_code != 200: continue
            text = r.json()["choices"][0]["message"]["content"]
            s, e = text.find("{"), text.rfind("}")
            if s < 0: continue
            v = json.loads(text[s:e+1])
            return {**{k: item[k] for k in ("level", "dog_id", "sprite_abs")}, "verdict": v}
        except Exception:
            pass
    return {**{k: item[k] for k in ("level", "dog_id", "sprite_abs")}, "verdict": None}

def main():
    rows = []
    for src in (KNOWN, SRC):
        if os.path.exists(src):
            rows += [json.loads(l) for l in open(src)]
    tagged = [r for r in rows if (r.get("classification") or {}).get("type") == "sparrow"]
    print(f"verifying {len(tagged)} sparrow-tagged sprites", flush=True)
    with httpx.Client() as client, ThreadPoolExecutor(16) as ex:
        results = list(ex.map(lambda i: verify(i, client), tagged))
    with open(OUT, "w") as f:
        for r in results: f.write(json.dumps(r) + "\n")
    kept = sum(1 for r in results if r["verdict"] and r["verdict"].get("sparrow"))
    unknown = sum(1 for r in results if r["verdict"] is None)
    print(f"confirmed {kept}, demoted {len(results)-kept-unknown}, unanswered {unknown}")
    print("->", OUT)

if __name__ == "__main__":
    main()
