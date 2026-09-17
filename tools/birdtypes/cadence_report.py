"""Walk a player through the levels and stamp every progression event.

Deterministic: no models, no randomness. Reads the shaped species assignment
(shaped.jsonl) and the shipped level order, takes the thresholds, prices, level
reward and gates as constants mirrored from remoteConfigSchema.ts, and prints the
level each event lands on.

The player model is the one the game now nudges: claim a rung the moment it is
available, because the level-complete screen hands you to the Collection, and buy
the next nest box tier the moment it is affordable, because it hands you to the
Sanctuary. A species counts only while its card is open; the first bird's card is
always open, which is what feeds its early tease.

Levels are stamped the way Batu reads them. The game's gates test COMPLETED
levels, and an event is offered on the level-complete screen, so an event stamped
L15 is one the player meets as they enter level 15, having finished 14.

Off-path players matter more than the ideal line, so the scenarios are switches:
  --idle-every N        collect a full idle window every N levels
  --hint-bundle-every N buy a 600-coin hint bundle every N levels when affordable
"""
import argparse, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.abspath(os.path.join(HERE, '..', '..', 'games', 'find_the_bird', 'public'))

# Mirrored from remoteConfigSchema.ts. Keep in step by hand; the report is
# evidence for those numbers, not their source.
THRESHOLDS = {
    'sparrow': (10, 50, 130),
    'robin': (10, 70, 100),
    'bluebird': (20, 40, 50),
}
PRICES = (500, 550, 650)
LEVEL_REWARD = 45
IDLE_PER_HOUR = (15, 30, 60)       # by house tier
IDLE_CAP_HOURS = 8
HINT_BUNDLE = 600
# Both gates are arrival-based (ae3958e2c): the tile opens as the player arrives
# at the level, having completed the one before it.
COLLECTION_COMPLETED = 9           # completed levels the Collection needs (arrive at 10)
SANCTUARY_COMPLETED = 14           # completed levels the Sanctuary needs (arrive at 15)
BIRDS = ('sparrow', 'robin', 'bluebird')
OPENS_ON = {                       # mirrors BIRD_DEFS[...].opensOn in birds.ts
    'sparrow': ('always', 0),
    'robin': ('houseTier', 2),
    'bluebird': ('chain', 2),
}
RUNG_NAME = {1: 'card', 2: 'hat', 3: 'costume'}
# Opening levels worth checking per bird: earliest the card can open, and the
# latest a real player might drag it to. The sparrow's card is open from level
# one, so it has a single row.
COVERAGE = {'sparrow': (10, 10), 'robin': (15, 50), 'bluebird': (30, 65)}


def per_level_counts():
    order = [l['id'] for l in json.load(open(os.path.join(PUB, 'levels', 'levels-index.json')))]
    found = {}
    with open(os.path.join(HERE, 'shaped.jsonl')) as handle:
        for line in handle:
            row = json.loads(line)
            found.setdefault(row['level'], []).append(row['classification']['type'])
    return [{bird: sum(1 for t in found.get(level_id, []) if t == bird) for bird in BIRDS}
            for level_id in order]


def is_open(bird, claimed, house_tier, collection_open):
    """Whether a species is counting pickups.

    Nothing counts before the Collection unlocks, the sparrow included: a player
    arrives at the gate with an empty card rather than a banked pile.

    Trap for whoever reorders BIRDS: a 'chain' rule reads the bird BEFORE this
    one in that tuple, so the order is the chain. The first entry is guarded
    here, but a bare index - 1 elsewhere would wrap to the last bird.
    """
    if not collection_open:
        return False
    index = BIRDS.index(bird)
    kind, value = OPENS_ON[bird]
    if kind == 'always' or index == 0:
        return True
    if kind == 'houseTier':
        return house_tier >= value
    # 'chain': the bird before this one in the order must have claimed `value`.
    return claimed[BIRDS[index - 1]] >= value


def simulate(idle_every=0, hint_every=0, verbose=False):
    supply = per_level_counts()
    counts = {b: 0 for b in BIRDS}
    claimed = {b: 0 for b in BIRDS}
    coins, house_tier, events = 0, 0, []

    for playing in range(1, len(supply) + 1):
        # Pickups during this level: the gates read the levels already completed.
        counting = playing - 1 >= COLLECTION_COMPLETED
        for bird in BIRDS:
            if is_open(bird, claimed, house_tier, counting):
                counts[bird] += supply[playing - 1][bird]
        coins += LEVEL_REWARD
        if idle_every and playing % idle_every == 0 and house_tier >= 1:
            coins += IDLE_CAP_HOURS * IDLE_PER_HOUR[house_tier - 1]
        if hint_every and playing % hint_every == 0 and coins >= HINT_BUNDLE:
            coins -= HINT_BUNDLE
            events.append((playing + 1, f'spent {HINT_BUNDLE} on a hint bundle'))

        completed = playing
        collection_open = completed >= COLLECTION_COMPLETED
        sanctuary_open = completed >= SANCTUARY_COMPLETED
        # An upgrade can open a bird whose first rung is already earned, so keep
        # settling until nothing more is claimable or affordable.
        changed = True
        while changed:
            changed = False
            for bird in BIRDS:
                if not is_open(bird, claimed, house_tier, collection_open):
                    continue
                rung = claimed[bird] + 1
                if rung <= 3 and counts[bird] >= THRESHOLDS[bird][rung - 1]:
                    claimed[bird] = rung
                    events.append((playing + 1,
                                   f'{bird} {RUNG_NAME[rung]} claimed ({counts[bird]} found)'))
                    changed = True
            if sanctuary_open and house_tier < 3 and coins >= PRICES[house_tier]:
                coins -= PRICES[house_tier]
                house_tier += 1
                events.append((playing + 1,
                               f'nest box tier {house_tier} bought ({PRICES[house_tier - 1]} coins)'))
                changed = True
        if verbose:
            print(f"L{playing:<3} coins {coins:5} tier {house_tier} "
                  + ' '.join(f"{b}:{counts[b]}/{claimed[b]}" for b in BIRDS))
    unfinished = [f"{b} stuck at rung {claimed[b]} ({counts[b]} of {THRESHOLDS[b][claimed[b]]} found)"
                  for b in BIRDS if claimed[b] < 3]
    return events, unfinished


def coverage_table():
    """How late a card can open and still finish its ladder.

    A species counts only from the level its card opens, so the supply laid down
    before that is lost to that player. For each bird and each opening level this
    prints what remains afterwards against the top rung, which is the check that
    catches a ceiling set too low — the failure mode a level-based window had.
    """
    supply = per_level_counts()
    total = len(supply)
    print('\nlate-opener coverage: birds left after a card opens, against its top rung')
    for bird in BIRDS:
        need = THRESHOLDS[bird][2]
        first, last = COVERAGE[bird]
        cells = []
        for opens in range(first, last + 1, 5) if last > first else [first]:
            left = sum(supply[i][bird] for i in range(opens - 1, total))
            cells.append(f"L{opens}:{left}{'' if left >= need else ' FAIL'}")
        print(f"  {bird:9} needs {need:4}  " + '  '.join(cells))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--idle-every', type=int, default=0)
    ap.add_argument('--hint-bundle-every', type=int, default=0)
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--coverage', action='store_true')
    args = ap.parse_args()
    if args.coverage:
        coverage_table()
        return
    events, unfinished = simulate(args.idle_every, args.hint_bundle_every, args.verbose)
    print('\nevent                                        entering   gap')
    previous = None
    for level, label in events:
        gap = '' if previous is None else str(level - previous)
        print(f'  {label:<44} L{level:<7} {gap}')
        previous = level
    for line in unfinished:
        print(f'  UNFINISHED at level 92: {line}')


if __name__ == '__main__':
    main()
