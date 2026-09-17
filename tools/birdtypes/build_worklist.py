"""Build the classification worklist: every dog in every bundled level, minus
the ones already classified successfully in the exploration results."""
import json, os, sys

GAME = os.path.join(os.path.dirname(__file__), "..", "..", "games", "find_the_bird")
GAME = os.path.abspath(GAME)
PUB = os.path.join(GAME, "public")
PRIOR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..",
    "docs/sanctuary-exploration/vertical-slice-2026-09-16/birdtypes/results.jsonl"))

# levels-index.json is the full shipped list (92 levels on 2026-09-17); the
# bundled manifest only holds the 44 shipped inside the app binary.
level_ids = [lv["id"] for lv in json.load(open(os.path.join(PUB, "levels", "levels-index.json")))]

done = {}
if os.path.exists(PRIOR):
    for line in open(PRIOR):
        r = json.loads(line)
        if r.get("classification") and r["classification"].get("type"):
            done[(r["level"], r["dog_id"])] = r["classification"]

work, known = [], []
for lid in level_ids:
    lp = os.path.join(PUB, "levels", lid, "level.json")
    if not os.path.exists(lp):
        print(f"MISSING level.json: {lid}", file=sys.stderr); continue
    lvl = json.load(open(lp))
    for dog in lvl["dogs"]:
        rel = dog["sprite"]["image"]              # resolve from level.json, never folder index
        item = {"level": lid, "dog_id": dog["id"], "sprite_rel": rel,
                "sprite_abs": os.path.join(PUB, rel)}
        if (lid, dog["id"]) in done:
            known.append({**item, "classification": done[(lid, dog["id"])], "error": None})
        else:
            work.append(item)

out = os.path.join(os.path.dirname(__file__), "worklist.json")
json.dump(work, open(out, "w"))
with open(os.path.join(os.path.dirname(__file__), "known.jsonl"), "w") as f:
    for r in known: f.write(json.dumps(r) + "\n")
print(f"levels={len(level_ids)} already_classified={len(known)} to_classify={len(work)}")
