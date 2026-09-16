"""Gate A: asset sanity for the collection + sanctuary art.

Split by nature of the question:
  * transparency, dimensions and file size are FILE facts -> measured with PIL,
    never asked of a model;
  * subject, costume, stray text, clipping and style match are PERCEPTUAL ->
    judged by gemini-3.8-flash through OpenRouter.

Writes verdicts.jsonl next to the assets it judged. Any FAIL is a defect.
"""
import base64, io, json, os, sys, threading
from concurrent.futures import ThreadPoolExecutor
import httpx
from PIL import Image

GAME = "/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/games/find_the_bird"
OUT = "/Users/base/dev/appletolye/fabrikav2/.worktrees/ftd-collection/docs/evidence/2026-09-16-ftb-collection-sanctuary/gate-a-verdicts.jsonl"
MODEL = "google/gemini-3.8-flash"
KEY = os.environ["OPENROUTER_API_KEY"]

# expected: (relative path, subject, costume, wants_alpha, intent)
# intent flags encode deliberate design so the gate cannot mistake it for a defect:
#   "bottom_cut" - a chest-up portrait, cut flat at the bottom because the body
#                  continues down into the card's porthole; "clipped" is correct here.
#   "flat_art"   - a silhouette or placeholder with no painted texture to judge,
#                  so the cozy-storybook style floor does not apply to it.
ASSETS = [
    ("public/ui/sanctuary/sanctuary-bg.webp", "an oak tree background with a bare horizontal branch", "n/a", False, set()),
    ("public/ui/sanctuary/house/house-tier1.webp", "a wooden birdhouse on a branch", "n/a", True, set()),
    ("public/ui/sanctuary/house/house-tier2.webp", "a wooden birdhouse with an annex on a branch", "n/a", True, set()),
    ("public/ui/sanctuary/house/house-tier3.webp", "a wooden birdhouse complex with a deck on a branch", "n/a", True, set()),
    ("public/ui/sanctuary/birds/sparrow-plain.webp", "a full-body cartoon sparrow", "none", True, set()),
    ("public/ui/sanctuary/birds/sparrow-hat.webp", "a full-body cartoon sparrow", "hat", True, set()),
    ("public/ui/sanctuary/birds/sparrow-cardigan.webp", "a full-body cartoon sparrow", "cardigan", True, set()),
    ("public/ui/sanctuary/markers/plot-marker.webp", "a wooden signpost with a rolled blueprint", "n/a", True, set()),
    ("public/ui/sanctuary/markers/pedestal-empty.webp", "a dotted outline of a bird with a question mark", "n/a", True, set()),
    ("public/ui/sanctuary/markers/coin-pile.webp", "a pile of gold coins", "n/a", True, set()),
    ("public/ui/collection/card-frame.webp", "an empty wooden card frame with a round hole", "n/a", True, set()),
    ("public/ui/collection/portrait-sparrow-silhouette.webp", "a dark silhouette of a bird", "none", True, {"flat_art", "bottom_cut"}),
    ("public/ui/collection/portrait-sparrow-plain.webp", "a chest-up cartoon sparrow portrait", "none", True, {"bottom_cut"}),
    ("public/ui/collection/portrait-sparrow-hat.webp", "a chest-up cartoon sparrow portrait", "hat", True, {"bottom_cut"}),
    ("public/ui/collection/portrait-sparrow-cardigan.webp", "a chest-up cartoon sparrow portrait", "cardigan", True, {"bottom_cut"}),
    ("public/ui/collection/portrait-unknown.webp", "a dark bird silhouette with a question mark", "n/a", True, {"flat_art", "bottom_cut"}),
]

PROMPT = (
    "You are checking one art asset for a cozy mobile game. Its intended subject is: {subject}. "
    "Its intended costume state is: {costume} (none = plain bird, hat = knitted beanie, "
    "cardigan = beanie plus knitted cardigan, n/a = not a bird). "
    "Reply with STRICT JSON only: "
    '{{"subject_matches":true|false,"costume":"none|hat|cardigan|n/a",'
    '"has_text":true|false,"cut_off":true|false,'
    '"style_match":0.0-1.0,"notes":"<= 15 words"}}. '
    "has_text is true if any letters, numbers or watermark appear. "
    "cut_off is true if the subject is clipped by the image edge. "
    "style_match rates how well it fits: soft hand-painted cozy storybook, painted wood and knitted "
    "textures, no hard black outlines, warm cream palette."
)

lock = threading.Lock()

def judge(entry, client):
    rel, subject, costume, wants_alpha, intent = entry
    path = os.path.join(GAME, rel)
    im = Image.open(path)
    has_alpha = im.mode in ("RGBA", "LA") and im.getextrema()[-1][0] < 255
    size = os.path.getsize(path)
    # perceptual half: flatten onto cream so the model sees it as the game does
    flat = Image.new("RGB", im.size, (243, 235, 220))
    rgba = im.convert("RGBA")
    flat.paste(rgba, (0, 0), rgba)
    flat.thumbnail((640, 640), Image.LANCZOS)
    buf = io.BytesIO(); flat.save(buf, "WEBP", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode()

    model_json, err = None, None
    for _ in range(3):
        try:
            r = client.post("https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {KEY}"},
                json={"model": MODEL, "max_tokens": 1200, "messages": [{"role": "user", "content": [
                    {"type": "text", "text": PROMPT.format(subject=subject, costume=costume)},
                    {"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{b64}"}}]}]},
                timeout=120)
            if r.status_code != 200:
                err = f"http {r.status_code}"; continue
            text = r.json()["choices"][0]["message"]["content"]
            s = text.find("{"); e = text.rfind("}")
            model_json = json.loads(text[s:e+1]); err = None; break
        except Exception as ex:
            err = repr(ex)[:120]

    problems = []
    if wants_alpha and not has_alpha: problems.append("expected transparency, file is opaque")
    if not wants_alpha and has_alpha: problems.append("background asset carries alpha")
    if model_json:
        if not model_json.get("subject_matches"): problems.append(f"subject mismatch: {model_json.get('notes','')}")
        if model_json.get("costume") != costume: problems.append(f"costume is {model_json.get('costume')}, expected {costume}")
        if model_json.get("has_text"): problems.append("stray text in art")
        if model_json.get("cut_off") and "bottom_cut" not in intent:
            problems.append("subject clipped by frame")
        if "flat_art" not in intent and float(model_json.get("style_match", 0)) < 0.7:
            problems.append(f"style_match {model_json.get('style_match')} < 0.7")
    else:
        problems.append(f"model did not answer: {err}")

    return {"asset": rel, "intent": sorted(intent), "bytes": size, "dimensions": list(im.size), "has_alpha": has_alpha,
            "expected_subject": subject, "expected_costume": costume,
            "model": model_json, "pass": len(problems) == 0, "problems": problems}

def main():
    with httpx.Client() as client, ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda e: judge(e, client), ASSETS))
    with open(OUT, "w") as f:
        for r in results: f.write(json.dumps(r) + "\n")
    failed = [r for r in results if not r["pass"]]
    print(f"gate A: {len(results) - len(failed)}/{len(results)} pass")
    for r in failed: print("  FAIL", r["asset"], r["problems"])
    print("->", OUT)
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
