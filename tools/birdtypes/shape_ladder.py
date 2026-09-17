"""Choose each sprite's species from its five ranked candidates to shape pacing.

The classifier returns five ranked candidates per sprite (classified-ranked.jsonl).
Top-1 is ornithologically best but makes a poor ladder: robins and bluebirds are
plentiful in the opening levels, so by the time the chain opens those cards the
player already holds enough to claim two rungs without playing. This pass picks,
per sprite, whichever candidate serves the pacing target for its level, taking
the highest-confidence sprites first, and leaves everything else on a species the
Collection does not count.

Supply targets: the sparrow flows from level 1 (its counter is the early tease
and its first rung is meant to be claimable the moment the Collection opens at
level 10). The robin is held back until the sparrow's second rung is near, and
the bluebird until the robin's second rung is near, so each card opens with only
a small bank and then climbs with play.

Writes the shaped assignment to shaped.jsonl; build_bird_types.py reads it.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.abspath(os.path.join(HERE, '..', '..', 'games', 'find_the_bird', 'public'))
LADDER = ('bluebird', 'robin', 'sparrow')      # scarcest first: it gets first pick


def target(bird, level):
    """Sprites of `bird` wanted in `level` (1-based position in the shipped order)."""
    if bird == 'sparrow':
        return 4 if level <= 40 else 3
    if bird == 'robin':
        return 1 if level <= 16 else 3
    return 1 if level <= 22 else 3              # bluebird


def norm(t):
    return str(t).strip().lower().replace(' ', '-')


def main():
    order = [l['id'] for l in json.load(open(os.path.join(PUB, 'levels', 'levels-index.json')))]
    per_level = {}
    for line in open(os.path.join(HERE, 'classified-ranked.jsonl')):
        r = json.loads(line)
        c = r.get('classification')
        if not c:
            continue
        cands = [(norm(x['type']), float(x.get('confidence', 0))) for x in c.get('candidates', [])]
        if cands:
            per_level.setdefault(r['level'], []).append((r['dog_id'], cands))

    shaped, short = {}, []
    for index, level_id in enumerate(order, start=1):
        sprites = per_level.get(level_id, [])
        taken = {}
        for bird in LADDER:
            want = target(bird, index)
            # Highest confidence for this bird first, whatever rank it sits at.
            ranked = sorted(
                ((d, next((p for t, p in c if t == bird), 0.0)) for d, c in sprites if d not in taken),
                key=lambda kv: -kv[1],
            )
            got = 0
            for dog, conf in ranked:
                if got >= want or conf <= 0:
                    break
                taken[dog] = bird
                got += 1
            if got < want:
                short.append((index, bird, want - got))
        out = {}
        for dog, cands in sprites:
            if dog in taken:
                out[dog] = taken[dog]
            else:
                # Anything not needed for pacing keeps its best uncounted species.
                out[dog] = next((t for t, _ in cands if t not in LADDER), 'unknown-songbird')
        shaped[level_id] = out

    with open(os.path.join(HERE, 'shaped.jsonl'), 'w') as f:
        for level_id, dogs in shaped.items():
            for dog, species in dogs.items():
                f.write(json.dumps({'level': level_id, 'dog_id': dog, 'classification': {'type': species}}) + '\n')
    counts = {b: sum(1 for d in shaped.values() for s in d.values() if s == b) for b in LADDER}
    print('shaped totals', counts)
    if short:
        print(f'levels short of target: {len(short)} (first 8) {short[:8]}')
    print('->', os.path.join(HERE, 'shaped.jsonl'))


if __name__ == '__main__':
    main()
