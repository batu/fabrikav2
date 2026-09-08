"""Reproduce the finite pacing search without editing the game or draft.

Run with `uv run python <this-file>` from tools/level-editor.
"""
import itertools
import json
from pathlib import Path

root = Path(__file__).resolve().parent
ranking = json.loads((root / 'ranking.json').read_text())['ranking']
scores = {row['rank']: row['visualIndex'] for row in ranking}
previous = [20, 30, 40, 45, 48, 51, 52, 53, 54]
best = None
candidates = feasible = 0
for selected in itertools.combinations([r for r in range(11, 51) if r != 48], 4):
    challenges = sorted([*selected, 48, 51, 52, 53, 54])
    recovery = [r for r in range(11, 55) if r not in challenges]
    gaps = [scores[c] - scores[r] for i, c in enumerate(challenges)
            for r in recovery[i * 4:(i + 1) * 4]]
    minimum = min(gaps)
    candidates += 1
    if minimum <= 0:
        continue
    feasible += 1
    key = (minimum, -sum(abs(a - b) for a, b in zip(challenges, previous)),
           tuple(-r for r in challenges))
    if best is None or key > best[0]:
        best = (key, challenges)

assert best is not None
expected = json.loads((root / 'progression-optimization.json').read_text())
assert candidates == expected['candidatesChecked']
assert feasible == expected['strictlyEasierFeasible']
assert best[1] == expected['challengeDifficultyRanks']
assert abs(best[0][0] - expected['minimumRecoveryGap']) < 1e-9
print(json.dumps({'candidates': candidates, 'challengeRanks': best[1],
                  'maximumMinimumGap': best[0][0], 'reproduced': True}))
