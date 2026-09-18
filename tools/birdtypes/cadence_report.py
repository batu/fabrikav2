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
    'robin': (10, 80, 100),
    'bluebird': (20, 40, 50),
}
PRICES = (500, 550, 750)
LEVEL_REWARD = 45
IDLE_PER_HOUR = (10, 20, 40)       # by house tier
IDLE_CAP_HOURS = 2
HINT_BUNDLE = 600

# The order Batu asked for, as the events that must appear in this relative
# sequence. Anything else the schedule produces may sit between them.
REQUIRED = (('claim', ('sparrow', 1)), ('buy', 1), ('claim', ('sparrow', 2)), ('buy', 2),
            ('claim', ('robin', 1)), ('claim', ('sparrow', 3)), ('buy', 3),
            ('claim', ('robin', 2)), ('claim', ('bluebird', 1)))


class Settings:
    """Everything a scenario can vary. Defaults mirror remoteConfigSchema.ts."""

    def __init__(self, prices=PRICES, idle_per_hour=IDLE_PER_HOUR, idle_cap=IDLE_CAP_HOURS,
                 idle_every=0, hint_every=0):
        self.prices = tuple(prices)
        self.idle_per_hour = tuple(idle_per_hour)
        self.idle_cap = idle_cap
        self.idle_every = idle_every
        self.hint_every = hint_every
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


def simulate(settings=None, verbose=False):
    settings = settings or Settings()
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
        if settings.idle_every and playing % settings.idle_every == 0 and house_tier >= 1:
            coins += settings.idle_cap * settings.idle_per_hour[house_tier - 1]
        if settings.hint_every and playing % settings.hint_every == 0 and coins >= HINT_BUNDLE:
            coins -= HINT_BUNDLE
            events.append((playing + 1, 'hint', 0, f'spent {HINT_BUNDLE} on a hint bundle'))

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
                    events.append((playing + 1, 'claim', (bird, rung),
                                   f'{bird} {RUNG_NAME[rung]} claimed ({counts[bird]} found)'))
                    changed = True
            if sanctuary_open and house_tier < 3 and coins >= settings.prices[house_tier]:
                coins -= settings.prices[house_tier]
                house_tier += 1
                events.append((playing + 1, 'buy', house_tier,
                               f'nest box tier {house_tier} bought '
                               f'({settings.prices[house_tier - 1]} coins)'))
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


def order_violations(events):
    """Which of the required events are out of sequence, by position."""
    seen = [(kind, key) for _, kind, key, _ in events if kind in ('claim', 'buy')]
    wanted = [e for e in REQUIRED if e in seen]
    order = [seen.index(e) for e in wanted]
    bad = []
    for i in range(1, len(order)):
        if order[i] < order[i - 1]:
            bad.append(f'{label_of(wanted[i])} before {label_of(wanted[i - 1])}')
    missing = [label_of(e) for e in REQUIRED if e not in seen]
    return bad, missing


def label_of(event):
    kind, key = event
    return f'tier {key}' if kind == 'buy' else f'{key[0]} {RUNG_NAME[key[1]]}'


def gaps_of(events):
    levels = [lvl for lvl, kind, _, _ in events if kind in ('claim', 'buy')]
    return [b - a for a, b in zip(levels, levels[1:])]


def print_events(events, title):
    print(f'\n{title}')
    print('  event                                        entering   gap')
    previous = None
    for level, _, _, label in events:
        gap = '' if previous is None else str(level - previous)
        print(f'    {label:<42} L{level:<7} {gap}')
        previous = level


def compare(settings_a, settings_b, title_a, title_b):
    """Base case and idle collector side by side, so the trade is visible."""
    rows = []
    for settings in (settings_a, settings_b):
        events, _ = simulate(settings)
        rows.append({label_of((kind, key)): lvl
                     for lvl, kind, key, _ in events if kind in ('claim', 'buy')})
    print(f'\n{"event":<20}{title_a:>14}{title_b:>16}')
    for event in REQUIRED:
        name = label_of(event)
        left = rows[0].get(name, '-')
        right = rows[1].get(name, '-')
        print(f'  {name:<18}{("L" + str(left)):>14}{("L" + str(right)):>16}')
    for i, settings in enumerate((settings_a, settings_b)):
        events, _ = simulate(settings)
        bad, missing = order_violations(events)
        title = (title_a, title_b)[i]
        print(f'  {title}: ' + ('order holds' if not bad else 'VIOLATION ' + '; '.join(bad))
              + (f'; never reached: {", ".join(missing)}' if missing else ''))


def sweep(idle_every=10):
    """Price of tier 3 against idle income, judged on BOTH players at once."""
    print('\nsweep: does the required order hold for both players?')
    print('  cap  rates        tier3   no-idle              idle every '
          f'{idle_every}')
    for cap, rates in ((8, (15, 30, 60)), (4, (15, 30, 60)), (8, (8, 15, 30)), (2, (15, 30, 60))):
        for price3 in (650, 700, 750, 800, 900):
            verdicts = []
            for idle in (0, idle_every):
                settings = Settings(prices=(500, 550, price3), idle_per_hour=rates,
                                    idle_cap=cap, idle_every=idle)
                events, _ = simulate(settings)
                bad, missing = order_violations(events)
                if missing:
                    verdicts.append('unreached')
                elif bad:
                    verdicts.append(bad[0][:20])
                else:
                    verdicts.append('holds')
            print(f'  {cap:3}  {str(rates):12} {price3:5}   {verdicts[0]:<20} {verdicts[1]}')


def main():

    ap = argparse.ArgumentParser()
    ap.add_argument('--idle-every', type=int, default=0)
    ap.add_argument('--hint-bundle-every', type=int, default=0)
    ap.add_argument('--idle-cap', type=int, default=IDLE_CAP_HOURS)
    ap.add_argument('--idle-rates', default=','.join(str(r) for r in IDLE_PER_HOUR))
    ap.add_argument('--prices', default=','.join(str(p) for p in PRICES))
    ap.add_argument('--sweep', action='store_true')
    ap.add_argument('--compare', action='store_true')
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--coverage', action='store_true')
    args = ap.parse_args()
    if args.coverage:
        coverage_table()
        return
    prices = tuple(int(v) for v in args.prices.split(','))
    rates = tuple(int(v) for v in args.idle_rates.split(','))
    if args.sweep:
        sweep(args.idle_every or 10)
        return
    if args.compare:
        compare(Settings(prices=prices, idle_per_hour=rates, idle_cap=args.idle_cap),
                Settings(prices=prices, idle_per_hour=rates, idle_cap=args.idle_cap,
                         idle_every=args.idle_every or 10),
                'no idle', f'idle/{args.idle_every or 10}')
        return
    settings = Settings(prices=prices, idle_per_hour=rates, idle_cap=args.idle_cap,
                        idle_every=args.idle_every, hint_every=args.hint_bundle_every)
    events, unfinished = simulate(settings, args.verbose)
    print_events(events, 'schedule')
    bad, missing = order_violations(events)
    print('  order holds' if not bad else '  VIOLATION: ' + '; '.join(bad))
    for line in unfinished:
        print(f'  UNFINISHED at level 92: {line}')


if __name__ == '__main__':
    main()
