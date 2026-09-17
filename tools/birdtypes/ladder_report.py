"""Where the collection rungs land, from the ranked tags.

For each species of interest: cumulative count along the shipped level order
(levels-index.json), under two counting rules -- strict (top candidate only)
and lenient (species appears in the top N with confidence >= cutoff). Prints
the level number at which each threshold is first reached so the ladder can
be tuned without another model run.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.abspath(os.path.join(HERE, "..", "..", "games", "find_the_bird", "public"))
order = [l["id"] for l in json.load(open(os.path.join(PUB, "levels", "levels-index.json")))]
rows = {}
for line in open(os.path.join(HERE, "shaped.jsonl" if os.path.exists(os.path.join(HERE, "shaped.jsonl")) else "classified-ranked.jsonl")):
    r = json.loads(line); c = r.get("classification")
    if c: rows[(r["level"], r["dog_id"])] = c

def norm(t): return str(t).strip().lower().replace(" ", "-")

def count(species, rule):
    out, cum = [], 0
    for lid in order:
        n = 0
        for (l, d), c in rows.items():
            if l != lid: continue
            cands = c.get("candidates") or [{"type": c.get("type"), "confidence": 1}]
            if rule(species, [(norm(x["type"]), float(x.get("confidence", 0))) for x in cands]): n += 1
        cum += n; out.append(cum)
    return out

strict = lambda s, cs: cs and cs[0][0] == s
def lenient(cut): return lambda s, cs: any(t == s and p >= cut for t, p in cs)

species = sys.argv[1:] or ["sparrow", "robin", "bluebird"]
thresholds = [5, 10, 20, 30, 50, 60, 100]
def first(cum, th): return next((i + 1 for i, v in enumerate(cum) if v >= th), None)
for s in species:
    for name, rule in [("strict", strict), ("top5>=.30", lenient(.30)), ("top5>=.15", lenient(.15))]:
        cum = count(s, rule)
        print(f"{s:9} {name:10} total={cum[-1]:4}  " + "  ".join(f"{th}@L{first(cum, th)}" for th in thresholds))
