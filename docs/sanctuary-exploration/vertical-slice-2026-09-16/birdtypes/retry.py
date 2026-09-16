import json, subprocess, concurrent.futures, re, sys

SCRATCH = "/private/tmp/claude-501/-Users-base-dev-appletolye/7abacacb-2cd7-454a-bb3a-b0aa4a5b3029/scratchpad/birdtypes"
data = json.load(open(f"{SCRATCH}/fails3.json"))

PROMPT_TMPL = (
    "Open and view the image at the absolute path {path}. "
    "It is a transparent PNG cutout of a single bird sprite from a game. "
    "Classify it and respond with STRICT JSON only, no markdown fences, no extra text: "
    '{{"type": "<short common bird type, e.g. cardinal, blue jay, robin, sparrow, owl, hummingbird, parrot, toucan, flamingo, duck, generic-songbird>", '
    '"colors": ["dominant","secondary"], "pose": "perched|flying|standing|swimming", "confidence": 0-1}}. '
    'Use a coarse common name, not a species. If unsure, use "unknown-songbird" as the type.'
)

call_count = [0]

def extract_json(text):
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None

def run_agy(prompt):
    cmd = ["agy", f"-p={prompt}", "--dangerously-skip-permissions", "--output-format", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=150)
    return r.returncode, r.stdout, r.stderr

def classify_one(item):
    path = item["sprite_abs"]
    prompt = PROMPT_TMPL.format(path=path)
    last_err = None
    for attempt in range(2):
        try:
            rc, out, err = run_agy(prompt)
            call_count[0] += 1
            outer = extract_json(out)
            if outer is None:
                last_err = f"no-json-outer: {out[:300]}"
                continue
            answer_text = None
            for key in ("response", "result", "output", "text", "message", "answer"):
                if key in outer and isinstance(outer[key], str):
                    answer_text = outer[key]
                    break
            if answer_text is None:
                if "type" in outer:
                    return {**item, "classification": outer, "error": None}
                last_err = f"no-answer-field: {list(outer.keys())}"
                continue
            inner = extract_json(answer_text)
            if inner is None or "type" not in inner:
                last_err = f"no-json-inner: {answer_text[:300]}"
                continue
            return {**item, "classification": inner, "error": None}
        except subprocess.TimeoutExpired:
            last_err = "timeout"
        except Exception as e:
            last_err = str(e)
    return {**item, "classification": None, "error": last_err}

def main():
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(classify_one, item): item for item in data}
        done = 0
        for fut in concurrent.futures.as_completed(futs):
            res = fut.result()
            results.append(res)
            done += 1
            print(f"{done}/{len(data)} done, calls={call_count[0]}", file=sys.stderr)
    with open(f"{SCRATCH}/retry_results3.jsonl", "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    print(f"RETRY3_TOTAL_CALLS={call_count[0]}")
    fails = [r for r in results if r["classification"] is None]
    print(f"RETRY3_FAILURES={len(fails)}")
    for f in fails:
        print("FAIL:", f["level"], f["dog_id"], f["error"])

if __name__ == "__main__":
    main()
