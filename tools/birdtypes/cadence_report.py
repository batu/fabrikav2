"""Walk a player through the levels and stamp every progression event.

Deterministic: no models, no randomness. Reads the shaped species assignment
(shaped.jsonl) and the shipped level order, takes the thresholds, prices, level
reward and gates as constants mirrored from remoteConfigSchema.ts, and prints the
level each event lands on.

The player model is the one the game now nudges: claim a rung the moment it is
available, because the level-complete screen hands you to the Collection, and buy
the next nest box tier the moment it is affordable, because it hands you to the
Sanctuary. A species counts only while its card is open.

Run with no arguments for the honest single-sitting case (no idle coins). Pass
--accrual-per-10-levels N to add N coins every ten levels, or --hint-bundles N to
spend 600 coins N times before the Sanctuary opens.
"""
import argparse, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.abspath(os.path.join(HERE, '..', '..', 'games', 'find_the_bird', 'public'))

# Mirrored from remoteConfigSchema.ts. Keep in step by hand; the report is
# evidence for those numbers, not their source.
THRESHOLDS = {
    'sparrow': (50, 100, 170),
    'robin': (10, 80, 130),
    'bluebird': (20, 50, 70),
}
PRICES = (500, 550, 600)
LEVEL_REWARD = 45
COLLECTION_LEVEL = 10          # completed levels before the Collection opens
SANCTUARY_LEVEL = 14           # completed levels before the Sanctuary opens (entering 15)
BIRDS = ('sparrow', 'robin', 'bluebird')
OPENS_ON = {                   # mirrors BIRD_DEFS[...].opensOn in birds.ts
    'sparrow': ('always', 0),
    'robin': ('houseTier', 2),
    'bluebird': ('chain', 2),
}


def per_level_counts():
    order = [l['id'] for l in json.load(open(os.path.join(PUB, 'levels', 'levels-index.json')))]
    found = {}
    with open(os.path.join(HERE, 'shaped.jsonl')) as handle:
        for line in handle:
            row = json.loads(line)
            found.setdefault(row['level'], []).append(row['classification']['type'])
    return [{bird: sum(1 for t in found.get(level_id, []) if t == bird) for bird in BIRDS}
            for level_id in order]


def is_open(bird, claimed, house_tier):
    """Whether a species is counting. The first bird counts from level one, long
    before the Collection page exists, which is what feeds its early tease; the
    others wait for their rule. Claiming is separate and needs the page."""
    kind, value = OPENS_ON[bird]
    if kind == 'always':
        return True
    if kind == 'houseTier':
        return house_tier >= value
    previous = BIRDS[BIRDS.index(bird) - 1]
    return claimed[previous] >= value


def simulate(accrual_per_10=0, hint_bundles=0, verbose=False):
    supply = per_level_counts()
    counts = {b: 0 for b in BIRDS}
    claimed = {b: 0 for b in BIRDS}
    coins, house_tier, events = 0, 0, []

    for index, yields in enumerate(supply, start=1):
        collection_open = index >= COLLECTION_LEVEL
        sanctuary_open = index >= SANCTUARY_LEVEL
        # Pickups during the level, counted only for species already collecting.
        for bird in BIRDS:
            if is_open(bird, claimed, house_tier):
                counts[bird] += yields[bird]
        coins += LEVEL_REWARD
        if accrual_per_10 and index % 10 == 0:
            coins += accrual_per_10
        if hint_bundles and index == 3:
            coins -= 600 * hint_bundles
            events.append((index, f'spent {600 * hint_bundles} on hints'))
        # Level complete: claim what is ready, buy what is affordable. Repeat,
        # because an upgrade can open a bird whose first rung is already earned.
        changed = True
        while changed:
            changed = False
            for bird in BIRDS:
                if not collection_open or not is_open(bird, claimed, house_tier):
                    continue
                rung = claimed[bird] + 1
                if rung <= 3 and counts[bird] >= THRESHOLDS[bird][rung - 1]:
                    claimed[bird] = rung
                    label = {1: 'card', 2: 'hat', 3: 'costume'}[rung]
                    events.append((index, f'{bird} {label} claimed ({counts[bird]} found)'))
                    changed = True
            if sanctuary_open and house_tier < 3 and coins >= PRICES[house_tier]:
                coins -= PRICES[house_tier]
                house_tier += 1
                events.append((index, f'nest box tier {house_tier} bought ({PRICES[house_tier - 1]} coins)'))
                changed = True
        if verbose and index <= 50:
            print(f"L{index:<3} coins {coins:5} tier {house_tier} "
                  + ' '.join(f"{b}:{counts[b]}/{claimed[b]}" for b in BIRDS))
    return events


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--accrual-per-10-levels', type=int, default=0)
    ap.add_argument('--hint-bundles', type=int, default=0)
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()
    events = simulate(args.accrual_per_10_levels, args.hint_bundles, args.verbose)
    print('\nevent                                        level   gap')
    previous = None
    for level, label in events:
        gap = '' if previous is None else str(level - previous)
        print(f'  {label:<44} L{level:<4} {gap}')
        previous = level


if __name__ == '__main__':
    main()
