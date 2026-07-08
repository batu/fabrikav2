# Level grammar + difficulty arc

This is the backbone for cards `arrow-04` through `arrow-14`. Every
level definition in `src/game/levels.ts` must conform to a row of the
table below.

## Primitives

| Primitive | Description | Introduced at |
|---|---|---|
| **Straight shot** | Arrow whose ray reaches the edge without passing any other arrow | L1 |
| **Blocking chain** | Arrow A blocked by arrow B; clear B first, then A works | L2 |
| **Parallel chains** | Two independent chains; order within each chain matters, between chains doesn't | L3 |
| **Cross-direction** | Mix of horizontal and vertical arrows on the same level; unblocks via a vertical may re-block a horizontal or vice-versa | L4 |
| **Convergent meeting** | Two arrows whose rays intersect at a cell; requires careful sequencing | L5 |
| **Dense grid** | More arrows than there are "edge-adjacent" cells; many moves must be earned | L6 |
| **Forced-order bottleneck** | A cell that MUST be cleared in a specific spot for the rest of the board to unlock | L7 |
| **Mixed densities** | Sparse + dense regions; learning to pick the entry point | L8 |
| **Long chains** | Chains of depth 3+ | L9 |
| **Multi-constraint convergence** | All the above, in a bigger grid with more arrows | L10 |

## Per-level arc

| # | Cols×Rows | Arrows | Primitive intro | Est. solve (s) | Aha |
|---|---|---|---|---|---|
| 1 | 4×5 | 2 | Straight shot | 5 | "Tap the arrow, it slides off" |
| 2 | 4×6 | 3 | Blocking chain | 10 | "The one in the way has to go first" |
| 3 | 5×6 | 4 | Parallel chains | 15 | "Two chains don't interfere" |
| 4 | 5×7 | 5 | Cross-direction | 20 | "Horizontal and vertical can help each other" |
| 5 | 5×7 | 6 | Convergent meeting | 25 | "Two arrows heading to the same cell need ordering" |
| 6 | 6×7 | 7 | Dense grid | 30 | "Most arrows are locked — find the one free move" |
| 7 | 6×8 | 8 | Forced-order bottleneck | 40 | "There's a keystone cell — unlock it or be stuck" |
| 8 | 6×8 | 9 | Mixed densities | 50 | "Start from the sparse side" |
| 9 | 7×8 | 10 | Long chains (depth ≥ 3) | 60 | "Follow the chain forward step by step" |
| 10 | 7×9 | 12 | Multi-constraint convergence | 80 | "Put it all together" |

## Solvability guarantee

Every level ships via the seeded reverse-construction generator in
`src/game/generator.ts`. The invariant: on each placement step, the
newly-placed arrow's ray to the edge is clear of already-placed
arrows, so tapping in REVERSE placement order always succeeds. The
forward-search solver in `tests/unit/levels.test.ts` proves each
registered level clears to `arrowCount === 0`.

The generator's per-level seeds are hardcoded in `levels.ts` so
content is reproducible. Adjust a seed → regenerate → re-run tests
→ the grammar table may need an updated aha row.

## Open curve questions

- L5's "convergent meeting" aha needs playtest confirmation — may
  read as too similar to L4. If so, either swap with L6 or tighten
  via a different seed.
- L10 may be too long at 12 arrows; consider 10 for pace.
- First-correct solve time estimates are synthetic; replace with
  real playtest medians as they roll in.

## Non-goals for v1

- Uniqueness of solution. Current levels admit multiple orderings.
  Uniqueness is a harder design target and is out of scope until
  after the 10-level curve ships.
- Progressive mechanics beyond what the specimen covers (gates,
  teleporters, multi-push). The original game reportedly introduces
  some of these at higher levels (research RF7 — "evolves into a
  complex traffic jam of logic"), and those are explicit future-card
  territory.
