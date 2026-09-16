"""Classify bird sprites with agy (Antigravity CLI, gemini-3.8-flash).

Call shape per the plan: agy -p='PROMPT' --dangerously-skip-permissions
--output-format json, <=12 concurrent (96 exhausted the quota once), 10-20 s
per call, retry once on timeout. Results are appended as JSONL so a crash
keeps everything already earned.
"""
import json, subprocess, concurrent.futures, re, sys, os, threading

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = json.load(open(os.path.join(HERE, "worklist.json")))
OUT = os.path.join(HERE, "classified.jsonl")

PROMPT_TMPL = (
    "Open and view the image at the absolute path {path}. "
    "It is a transparent PNG cutout of a single bird sprite from a game. "
    "Classify it and respond with STRICT JSON only, no markdown fences, no extra text: "
    '{{"type": "<short common bird type, e.g. cardinal, blue jay, robin, sparrow, owl, hummingbird, parrot, toucan, flamingo, duck, generic-songbird>", '
    '"colors": ["dominant","secondary"], "pose": "perched|flying|standing|swimming", "confidence": 0-1}}. '
    'Use a coarse common name, not a species. If unsure, use "unknown-songbird" as the type.'
)

lock = threading.Lock()
calls = [0]

def extract_json(text):
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if not m: return None
    try: return json.loads(m.group(0))
    except Exception: return None

def classify_one(item):
    prompt = PROMPT_TMPL.format(path=item["sprite_abs"])
    last = None
    for _ in range(2):
        try:
            r = subprocess.run(["agy", f"-p={prompt}", "--dangerously-skip-permissions",
                                "--output-format", "json"],
                               capture_output=True, text=True, timeout=120)
            with lock: calls[0] += 1
            if r.returncode != 0:
                last = f"rc={r.returncode} {r.stderr[:200]}"; continue
            outer = extract_json(r.stdout)
            if outer is None:
                last = f"no-json-outer: {r.stdout[:200]}"; continue
            answer = None
            for key in ("response", "result", "output", "text", "message", "answer"):
                if isinstance(outer.get(key), str): answer = outer[key]; break
            if answer is None:
                if "type" in outer: return {**item, "classification": outer, "error": None}
                last = f"no-answer-field: {list(outer.keys())}"; continue
            inner = extract_json(answer)
            if inner is None or "type" not in inner:
                last = f"no-json-inner: {answer[:200]}"; continue
            return {**item, "classification": inner, "error": None}
        except subprocess.TimeoutExpired:
            last = "timeout"
        except Exception as e:
            last = str(e)
    return {**item, "classification": None, "error": last}

def main():
    done_keys = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                r = json.loads(line)
                if r.get("classification"): done_keys.add((r["level"], r["dog_id"]))
            except Exception: pass
    todo = [i for i in WORK if (i["level"], i["dog_id"]) not in done_keys]
    print(f"todo={len(todo)} (skipping {len(done_keys)} already in {os.path.basename(OUT)})", flush=True)
    n = 0
    with open(OUT, "a") as f, concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for res in ex.map(classify_one, todo):
            with lock:
                f.write(json.dumps(res) + "\n"); f.flush()
            n += 1
            if n % 25 == 0: print(f"{n}/{len(todo)} calls={calls[0]}", flush=True)
    fails = 0
    for line in open(OUT):
        if json.loads(line).get("classification") is None: fails += 1
    print(f"DONE calls={calls[0]} unresolved={fails}")

if __name__ == "__main__":
    main()
