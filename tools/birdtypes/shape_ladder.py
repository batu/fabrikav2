"""Choose each sprite's species from its five ranked candidates to shape pacing.

The classifier returns five ranked candidates per sprite (classified-ranked.jsonl).
Top-1 is ornithologically best but makes a poor ladder: robins and bluebirds are
plentiful in the opening levels, so a card that opens late arrives with its rungs
already earned. This pass picks, per sprite, whichever candidate the level's
pacing needs, taking the highest-confidence sprites first, and leaves everything
else on a species the Collection does not count.

Each collectable bird has a window and a rate: the level its supply starts and
how many of it a level should yield once started. Supply before a bird's card
opens is deliberately zero-ish, because a species only counts from the moment its
card opens, and a window that starts a few levels early only protects a player
who gets there late.

Availability is uneven — a level may hold eight candidate robins or one — so the
allocator carries unmet demand forward instead of dropping it. That keeps the
CUMULATIVE curve close to the ideal line, which is what thresholds read, while
per-level counts stay lumpy. Scarcest species pick first.

Measured availability across the 92 levels (candidate appears in a sprite's top
five): sparrow 1081, finch 912, thrush 590, tit 589, wren 557, chickadee 476,
robin 410, bluebird 248, of 1714 sprites. The trio is held to sparrow, robin and
bluebird because those three already have card and Sanctuary art; bluebird's thin
supply is answered with lower thresholds rather than new artwork.

Writes shaped.jsonl; build_bird_types.py reads it.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.abspath(os.path.join(HERE, '..', '..', 'games', 'find_the_bird', 'public'))

# bird -> (first level that yields it, last level that yields it, wanted per level)
# A window opens on the level the bird's card is designed to open, because supply
# before that is uncounted, and closes once its top rung is earned, which hands
# the sprites to the birds still climbing.
SUPPLY = {
    'bluebird': (41, 92, 6),
    'robin': (24, 66, 5),
    'sparrow': (1, 40, 5),
}
# Scarcest first: it gets first pick of the sprites that can be it.
LADDER = tuple(SUPPLY)


def norm(t):
    return str(t).strip().lower().replace(' ', '-')


def load_candidates():
    per_level = {}
    with open(os.path.join(HERE, 'classified-ranked.jsonl')) as handle:
        for line in handle:
            row = json.loads(line)
            classification = row.get('classification')
            if not classification:
                continue
            cands = [(norm(c['type']), float(c.get('confidence', 0)))
                     for c in classification.get('candidates', [])]
            if cands:
                per_level.setdefault(row['level'], []).append((row['dog_id'], cands))
    return per_level


def shape():
    order = [l['id'] for l in json.load(open(os.path.join(PUB, 'levels', 'levels-index.json')))]
    per_level = load_candidates()
    debt = {bird: 0 for bird in LADDER}
    shaped, curve = {}, {bird: [] for bird in LADDER}
    running = {bird: 0 for bird in LADDER}

    for index, level_id in enumerate(order, start=1):
        sprites = per_level.get(level_id, [])
        taken = {}
        for bird in LADDER:
            start, end, rate = SUPPLY[bird]
            inside = start <= index <= end
            want = (rate + debt[bird]) if inside else 0
            ranked = sorted(
                ((dog, next((p for t, p in cands if t == bird), 0.0))
                 for dog, cands in sprites if dog not in taken),
                key=lambda kv: -kv[1],
            )
            got = 0
            for dog, confidence in ranked:
                if got >= want or confidence <= 0:
                    break
                taken[dog] = bird
                got += 1
            if inside:
                # Carry the shortfall so the cumulative curve catches up later.
                debt[bird] = max(0, want - got)
            running[bird] += got
            curve[bird].append(running[bird])
        out = {}
        for dog, cands in sprites:
            out[dog] = taken.get(dog) or next((t for t, _ in cands if t not in LADDER), 'unknown-songbird')
        shaped[level_id] = out

    return order, shaped, curve


def main():
    order, shaped, curve = shape()
    with open(os.path.join(HERE, 'shaped.jsonl'), 'w') as handle:
        for level_id, dogs in shaped.items():
            for dog, species in dogs.items():
                handle.write(json.dumps({'level': level_id, 'dog_id': dog,
                                         'classification': {'type': species}}) + '\n')
    print('shaped totals', {b: curve[b][-1] for b in curve})
    print('cumulative at key levels:')
    for level in (10, 15, 20, 24, 28, 32, 37, 41, 48, 55, 65, 75, 92):
        print(f"  L{level:<3}", {b: curve[b][level - 1] for b in curve})
    print('->', os.path.join(HERE, 'shaped.jsonl'))


if __name__ == '__main__':
    main()
