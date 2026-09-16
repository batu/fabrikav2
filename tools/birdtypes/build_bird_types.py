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

rows = {}
for src in [os.path.join(HERE, "known.jsonl"), os.path.join(HERE, "classified.jsonl")]:
    if not os.path.exists(src): continue
    for line in open(src):
        try: r = json.loads(line)
        except Exception: continue
        c = r.get("classification")
        if not c or not c.get("type"): continue
        t = str(c["type"]).strip().lower().replace(" ", "-")
        rows[(r["level"], r["dog_id"])] = t

manifest = json.load(open(os.path.join(PUB, "levels", "bundled-manifest.json")))
level_ids = [lv["id"] for lv in manifest["levels"]]

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
    "source": "agy gemini-3.8-flash image classification (tools/birdtypes/classify.py)",
    "coverage": {"levels": len(levels), "birds": total, "tagged": tagged,
                 "untagged": total - tagged},
    "levels": levels,
}
json.dump(doc, open(OUT, "w"), indent=1, sort_keys=True)
sparrows = sum(1 for v in levels.values() for t in v.values() if t == "sparrow")
print(f"levels={len(levels)} birds={total} tagged={tagged} untagged={total-tagged} sparrows={sparrows}")
print("->", OUT)
