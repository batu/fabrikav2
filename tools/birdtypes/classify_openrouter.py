"""Classify bird sprites with gemini-3.8-flash through OpenRouter.

Replaces the agy CLI path, whose individual quota was exhausted mid-run
(2026-09-16). Sprites are downscaled before sending: species is legible at
256px and full-size cutouts would pay for detail the model does not need.
Results append as JSONL so a crash keeps whatever was earned.
"""
import base64, io, json, os, sys, threading
from concurrent.futures import ThreadPoolExecutor
import httpx
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# Ranked results (2026-09-17): five candidates per sprite so the collection
# ladder can be retuned to other species without another model run.
# classified.jsonl holds the older single-label run and is kept for the record.
OUT = os.path.join(HERE, "classified-ranked.jsonl")
MODEL = "google/gemini-3.8-flash"
KEY = os.environ["OPENROUTER_API_KEY"]

PROMPT = (
    "This is a transparent PNG cutout of a single bird sprite from a hidden-object game. "
    "Rank the FIVE most likely bird types it depicts, most likely first. Use coarse common "
    "names, not species (e.g. sparrow, robin, wren, bluebird, finch, cardinal, blue jay, owl, "
    "duck, chickadee, goldfinch, nuthatch, wagtail, tit, thrush, blackbird, swallow, dove, "
    "unknown-songbird). Reply with STRICT JSON only, no markdown fences, no prose: "
    '{"candidates":[{"type":"<name>","confidence":0-1}, ... exactly 5],'
    '"colors":["dominant","secondary"],"pose":"perched|flying|standing|swimming"}. '
    "Confidences are your probability for each candidate and should sum to about 1."
)

lock = threading.Lock()
done = [0]

def encode(path: str) -> str:
    im = Image.open(path).convert("RGBA")
    im.thumbnail((256, 256), Image.LANCZOS)
    flat = Image.new("RGB", im.size, (255, 255, 255))
    flat.paste(im, (0, 0), im)
    buf = io.BytesIO()
    flat.save(buf, "WEBP", quality=80)
    return base64.b64encode(buf.getvalue()).decode()

def extract(text: str):
    start, depth = text.find("{"), 0
    if start < 0: return None
    for i in range(start, len(text)):
        if text[i] == "{": depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try: return json.loads(text[start:i+1])
                except Exception: return None
    return None

def classify(item, client):
    for _ in range(3):
        try:
            r = client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
                json={"model": MODEL, "max_tokens": 1200, "messages": [{"role": "user", "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{encode(item['sprite_abs'])}"}},
                ]}]},
                timeout=120,
            )
            if r.status_code != 200:
                last = f"http {r.status_code}: {r.text[:160]}"
                continue
            body = r.json()
            text = body["choices"][0]["message"]["content"]
            parsed = extract(text if isinstance(text, str) else json.dumps(text))
            cands = parsed.get("candidates") if parsed else None
            if isinstance(cands, list) and cands and all(isinstance(c, dict) and c.get("type") for c in cands):
                # Top candidate doubles as `type` so the verifier and builder keep working.
                parsed["type"] = cands[0]["type"]
                return {**item, "classification": parsed, "error": None}
            last = f"unparsed: {str(text)[:160]}"
        except Exception as e:
            last = repr(e)[:160]
    return {**item, "classification": None, "error": last}

def main():
    work = json.load(open(os.path.join(HERE, "worklist.json")))
    have = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                r = json.loads(line)
                if r.get("classification"): have.add((r["level"], r["dog_id"]))
            except Exception: pass
    todo = [i for i in work if (i["level"], i["dog_id"]) not in have]
    print(f"todo={len(todo)} (have {len(have)})", flush=True)
    with httpx.Client(http2=False) as client, open(OUT, "a") as f, ThreadPoolExecutor(20) as ex:
        for res in ex.map(lambda i: classify(i, client), todo):
            with lock:
                f.write(json.dumps(res) + "\n"); f.flush()
                done[0] += 1
                if done[0] % 50 == 0: print(f"{done[0]}/{len(todo)}", flush=True)
    fails = sum(1 for l in open(OUT) if json.loads(l).get("classification") is None)
    print(f"DONE unresolved={fails}")

if __name__ == "__main__":
    main()
