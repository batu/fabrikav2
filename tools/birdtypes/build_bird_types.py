"""Merge agy classifications into games/find_the_bird/public/levels/bird-types.json.

Shape: {"version":1,"generatedAt":iso,"coverage":{...},"levels":{levelId:{dogId:type}}}
Levels or dogs missing from the file are treated by the runtime as "unknown"
(never a sparrow), so a partial file is safe to ship but under-counts.
"""
import json, os, glob, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PUB = os.path.join(ROOT, "games", "find_the_bird", "public")
OUT = os.path.join(PUB, "levels", "bird-types.json")

# Sparrow is the only tag release 1 spends, so it is held to a second, stricter
# opinion (verify_sparrows.py). A blind audit caught wrens, chickadees, finches
# and thrushes wearing the sparrow tag, and a false positive is visible to the
# player: a wren would tick the sparrow card. Anything the verification does not
# confirm is demoted to unknown-songbird, trading recall for precision.
verdicts = {}
vp = os.path.join(HERE, "sparrow-verdicts.jsonl")
if os.path.exists(vp):
    for line in open(vp):
        r = json.loads(line)
        v = r.get("verdict") or {}
        verdicts[(r["level"], r["dog_id"])] = bool(v.get("sparrow"))

# shaped.jsonl (tools/birdtypes/shape_ladder.py) wins when present: it picks each
# sprite's species from the five ranked candidates to serve the ladder's pacing.
# Without it the top candidate is used, which is truer to the bird and worse to play.
SHAPED = os.path.join(HERE, "shaped.jsonl")
sources = [SHAPED] if os.path.exists(SHAPED) else [os.path.join(HERE, "known.jsonl"), os.path.join(HERE, "classified-ranked.jsonl")]

rows = {}
for src in sources:
    if not os.path.exists(src): continue
    for line in open(src):
        try: r = json.loads(line)
        except Exception: continue
        c = r.get("classification")
        if not c or not c.get("type"): continue
        t = str(c["type"]).strip().lower().replace(" ", "-")
        key = (r["level"], r["dog_id"])
        if t == "sparrow" and verdicts.get(key) is False:
            t = "unknown-songbird"
        rows[key] = t

# levels-index.json is the full shipped list (92 levels on 2026-09-17); the
# bundled manifest only holds the 44 shipped inside the app binary.
level_ids = [lv["id"] for lv in json.load(open(os.path.join(PUB, "levels", "levels-index.json")))]

levels, total, tagged = {}, 0, 0
for lid in level_ids:
    lp = os.path.join(PUB, "levels", lid, "level.json")
    if not os.path.exists(lp): continue
    lvl = json.load(open(lp))
    per = {}
    for dog in lvl["dogs"]:
        total += 1
        t = rows.get((lid, dog["id"]))
        if t: per[dog["id"]] = t; tagged += 1
    levels[lid] = per      # always present, possibly empty

doc = {
    "version": 1,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "source": "gemini-3.8-flash via OpenRouter (tools/birdtypes/classify_openrouter.py), "
              "five ranked candidates per sprite; species chosen for ladder pacing by "
              "tools/birdtypes/shape_ladder.py",
    "coverage": {"levels": len(levels), "birds": total, "tagged": tagged,
                 "untagged": total - tagged},
    "levels": levels,
}
json.dump(doc, open(OUT, "w"), indent=1, sort_keys=True)
sparrows = sum(1 for v in levels.values() for t in v.values() if t == "sparrow")
print(f"levels={len(levels)} birds={total} tagged={tagged} untagged={total-tagged} sparrows={sparrows}")
print("->", OUT)
