"""Choose each sprite's species from its five ranked candidates to shape pacing.

The classifier returns five ranked candidates per sprite (classified-ranked.jsonl).
Top-1 is ornithologically best but makes a poor ladder: robins and bluebirds are
plentiful in the opening levels, so a card that opens late arrives with its rungs
already earned. This pass picks, per sprite, whichever candidate the level's
pacing needs, taking the highest-confidence sprites first, and leaves everything
else on a species the Collection does not count.

Each collectable bird has a start level and a rate. Supply begins at the earliest
level the bird could be collecting and continues to the end of the order, so no
schedule drift can strand a ladder: a species counts only from the moment its
card opens, and a supply that stopped would leave a late player short forever.

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

# bird -> (steps of (from this level, wanted per level), total to lay down)
# A bird's supply opens on the EARLIEST level it could be collecting and never
# closes by level. A level cutoff would strand anyone off the predicted line: a
# species counts only once its card opens, so a player who opens a card late
# would find its supply already behind them and could never finish that ladder.
#
# What does stop is the TOTAL. Once a bird has had enough sprites laid down to
# finish its ladder even after arriving very late, it stops asking and the birds
# still climbing get those sprites. The ceiling is the ladder's top rung plus the
# most a late opener could waste before its card opened.
#
# The rate is stepped for the same reason the ceilings exist: the three birds
# compete for the same sprites. A bluebird laid down before the bluebird's card
# can open is waste that also costs the robin a sprite, and starving the robin
# delays the bluebird in turn, since the robin's hat is what opens it. So the
# bluebird gets a protective trickle from the first level a fast player could
# reach it, and its full rate from the level an ordinary player does.
#
# Earliest possible: the sparrow from level 2, the level the Collection unlocks,
# because nothing counts before that gate for any bird; the robin from level 10,
# an anti-waste bound rather than a consequence of the Sanctuary's gate; the
# bluebird from level 25, the soonest 80 robins can be found once the robin can
# open at 10.
#
# 2026-09-19, second pass: the gates moved again (Collection 5 -> 2, Sanctuary
# 10 -> 7) against the funnel — 80.1% of players reach one completion against
# 43.2% who reach four. Only the SPARROW's start moved with its gate this time.
#
# The sparrow's start is the point of the change, not a side effect. At a start
# of L5 and exactly 5/level the card completed on L5 whatever the gate said, so
# shipping the gate alone would have shown a pill reading 0/5 for three levels —
# worse than the locked tile it replaced. From L2 the player gets one level of
# countdown and the card lands entering L3 (69.3% reach) instead of L6 (33.2%).
#
# The robin's start does NOT move with the Sanctuary's gate. L10 is an
# anti-waste bound — a robin laid down before its card can open is a sprite the
# sparrow could have used — and its card lands on L26 regardless, so nothing is
# stranded by leaving it. Its CEILING rises 240 -> 250 because the earlier
# sparrows take sprites the robin would have had: at 240 late-opener coverage
# fell to L45:99 against 100 needed, a regression against main's L45:101. At 250
# it is L45:110, better than main at every column.
SUPPLY = {
    'sparrow': (((2, 5),), 210),
    'robin': (((10, 5),), 250),
    'bluebird': (((25, 2), (40, 6)), 150),
}
# Chain order, not scarcest first: the bird that opens earlier gets first pick.
# Starving an earlier bird delays every later one, because each card is what
# opens the next, so a scarce late bird taking sprites from an early one costs
# more than it gains.
LADDER = ('sparrow', 'robin', 'bluebird')


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
            steps, ceiling = SUPPLY[bird]
            rate = 0
            for step_from, step_rate in steps:
                if index >= step_from:
                    rate = step_rate
            if running[bird] >= ceiling:
                rate = 0
            want = rate + debt[bird] if rate else 0
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
            if rate:
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
