---
title: "Any-overlap eval metrics are gameable — gate rankings on one-to-one matching"
date: 2026-08-05
category: best-practices
module: tools/level-editor/eval
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - "evaluating candidates against ground-truth regions that can overlap"
  - "scoring detectors or placers whose candidate count is unconstrained"
  - "a metric change would renumber a history of archived runs"
  - "aggregate metrics could hide a single catastrophic level or example"
  - "results rows may be scored against different ground-truth snapshots"
tags: [eval-design, metric-gaming, one-to-one-matching, precision-recall, golden-set, hitbox-placement, ground-truth-hashing]
related_components:
  - hitbox-placement-hillclimb
  - level-editor
---

# Any-overlap eval metrics are gameable — gate rankings on one-to-one matching

## Context

The hitbox-placement hillclimb (PR #33 shipped the harness) scored candidate
placers against 412 hand-placed golden hitboxes across 22 painted levels
(`tools/level-editor/eval/GOAL.md:6-9`). Golden radii encode **tap
generosity, not bird extent** (`GOAL.md:33-35`), so in dense scenes goldens
overlap each other.

The original contract metrics were **any-overlap**:

- *recall*: a golden counts as found if ANY candidate center lies inside its
  radius;
- *precision*: a candidate is a TP if it lies inside ANY golden.

These survive in `score.py` as the legacy disclosure columns
(`tools/level-editor/eval/score.py:66-67`, `:100-101`).

Adversarial review — an in-process pass plus an independent cross-model pass
that empirically re-measured 90+ archived runs — found two gaming surfaces
(`tools/level-editor/eval/FINDINGS.md:41-48`):

1. **Overlap double-counting**: one candidate dropped between two overlapping
   goldens counts BOTH as found. Measured inflation: 1-2 birds per dense
   level (`FINDINGS.md:43-45`).
2. **Duplicate padding**: candidates stacked on an already-found bird all
   count as TPs, so a placer emitting extra rings on birds it already found
   pads precision with zero new coverage.

Decision (Batu, 2026-08-05, merged as PR #34): **the ranking gate IS the
one-to-one metrics** (`FINDINGS.md:46-48`). GOAL.md was amended and the
results table regenerated.

## Guidance

Gate rankings on **one-to-one greedy matching**: each golden can be
satisfied by at most one candidate and vice versa; pairs are admissible when
`dist <= golden.r`, matched nearest-first (`score.py:69-85`).

Before (any-overlap, now the legacy `_any` columns):

```python
# score.py:66-67 — any-overlap: gameable
found = [any(dist[i][j] <= g["r"] for j in range(n_c)) for i, g in enumerate(golden)]
tp_cand = [any(dist[i][j] <= golden[i]["r"] for i in range(n_g)) for j in range(n_c)]
# recall_any    = sum(found) / n_g       (score.py:100)
# precision_any = sum(tp_cand) / n_c     (score.py:101)
```

After (one-to-one, the ranking gate):

```python
# score.py:69-85 — greedy 1-to-1 over admissible pairs, nearest first
pairs = sorted(
    ((dist[i][j], i, j) for i in range(n_g) for j in range(n_c)
     if dist[i][j] <= golden[i]["r"]),
)
used_g, used_c, matches = set(), set(), []
for d, i, j in pairs:
    if i in used_g or j in used_c:
        continue
    used_g.add(i); used_c.add(j); matches.append((i, j, d))
# recall    = len(matches) / n_g         (score.py:97)
# precision = len(matches) / n_c         (score.py:98)
```

Duplicates (candidates overlapping an already-matched golden but stranded by
the 1-to-1 gate) count against precision AND are reported as their own
column (`score.py:85`, `:93`).

Ship the gate switch with the companion practices — each is a distinct
eval-design move that landed in the same PR:

1. **Keep legacy metrics as disclosure columns**, don't silently renumber
   history: `recall_any`/`precision_any` remain in every row
   (`score.py:99-101`, `:164-165`; `GOAL.md:21-23`, `:28-29`).
2. **Add a worst-case column**: `min_level_recall` in the summary
   (`score.py:169`) and the `min lvl R` column in RESULTS.md
   (`score.py:188`). The micro-averaged aggregate had hidden a level at 0.71
   recall — a 12-bird level at recall 0 costs only ~3% of the aggregate
   (`FINDINGS.md:44-45`, finding 5 at `FINDINGS.md:79-83`).
3. **Stamp the ground-truth hash into every row**: `golden_sha256`
   (`score.py:126-134`, `:170`) with the RESULTS.md header stating "Rows
   scored against a different golden sha are not comparable"
   (`score.py:187`).
4. **Pin the semantics with unit tests** so regressions fail loudly
   (`tools/level-editor/tests/test_hitbox_score.py`):
   - duplicates hurt 1-to-1 precision but not legacy `_any`
     (`test_hitbox_score.py:42-49`);
   - overlap doesn't double-count under the gate
     (`test_hitbox_score.py:52-58`);
   - matching prefers nearest and strands the farther candidate
     (`test_hitbox_score.py:61-68`);
   - center error is dimension-scaled to 4096-space
     (`test_hitbox_score.py:71-77`).
5. **Amend the contract IN PLACE with dated amendment notes** that preserve
   the original wording, so the contract's history stays legible
   (`GOAL.md:17-29`: *"(Amended 2026-08-05: originally 'a candidate whose
   center lies inside g' — any-overlap; that variant is still reported as
   `recall_any`.)"*).

## Why This Matters

The gate switch changed real numbers, and in the direction that mattered:

- The best free ensemble's precision fell from **.90 (padded, 74 duplicate
  rings) to .758 (honest)** — the ensembles had been padding precision with
  duplicates (`FINDINGS.md:10-13`, `:18`).
- The incumbent VLM pipeline barely moved (**.981 → .978 recall**) because
  it emits zero duplicates (`FINDINGS.md:43-44`, `:16`).
- Net effect: the honest gate **widened** the honest method's lead — the
  metric change strengthened the verdict rather than reshuffling it
  (`FINDINGS.md:10-12`). A metric fix that only reorders scores among gamed
  entrants is still worth shipping; one that confirms and sharpens the
  verdict is proof the original ranking was surviving on the incumbent's
  honesty, not the metric's rigor.

Without the switch, the leaderboard rewarded degenerate strategies: more
rings on already-found birds, one ring straddling two goldens. Neither
improves the product (a false positive is a "miss" tap on nothing — the
failure class Batu kept hitting on-device, `GOAL.md:26-28`).

## When to Apply

Any evaluation where **ground-truth regions can overlap** or the **candidate
count is unconstrained**:

- detection scored against generous tap/click targets (this case);
- region matching, dedup scoring, entity linking against overlapping spans;
- any leaderboard fed by adversarially-tuned submitters (including your own
  hillclimb ensembles).

The tell: **can a degenerate candidate set improve the score without
improving the product?** Ask literally — "a ring at every pixel", "a
duplicate on every known positive". If yes on either, the metric needs a
1-to-1 (or otherwise budgeted) matching gate before it can rank anything.

Companion tells for the shipped-alongside practices:

- History exists → keep old metrics as disclosure columns, never renumber
  silently.
- Aggregate is micro-averaged → add a worst-case (min-per-group) column.
- Ground truth can change → hash it into every result row.
- Metric semantics are load-bearing → pin them with unit tests.
- The metric lives in a contract doc → amend in place with dated notes.

## Examples

- Gate implementation: `tools/level-editor/eval/score.py:61-107`
  (`score_level`), aggregate + sha + min-recall at `score.py:155-173`,
  RESULTS.md writer at `score.py:179-202`.
- Amended contract: `tools/level-editor/eval/GOAL.md:13-39`.
- Semantics tests: `tools/level-editor/tests/test_hitbox_score.py:31-97`.
- Impact record: `tools/level-editor/eval/FINDINGS.md:8-57` (final
  standings under the 1-to-1 gate; post-review corrections).
- PRs: #33 (eval harness), #34 (merged — the 1-to-1 gate switch, legacy
  `_any` columns, `min_level_recall`, `golden_sha256`, semantics tests,
  GOAL.md amendment).

Degenerate-set thought experiment, concretely (from
`test_hitbox_score.py:42-49`): three candidates stacked on one golden score
`precision_any = 1.0` under the old contract but `precision = 1/3` under
the gate — stacking cannot pad precision.

## Related

- [yolo-hitbox-anchored-label-corpus](../logic-errors/yolo-hitbox-anchored-label-corpus.md) — the training-label half of the same hillclimb: labels can lie just like metrics can.
- [data-first-semantic-contract-and-immutable-projections](../architecture-patterns/data-first-semantic-contract-and-immutable-projections.md) — thematic cousin: distrust ungated derived signals until validated.
