---
date: 2026-04-20
status: accepted
---

# ADR — Solver contract surface is stable

## Context

The offline icon-to-level pipeline (`games/arrow/content/level-tools/icon2level/`,
landing in later cards of the Trello pipeline `hiEzmGo2`) generates
LevelSpec YAML by running a Python pipeline that shells out to a Node
CLI (`games/arrow/content/level-tools/solver-check.mjs`) to validate each candidate
level. The CLI imports from the TypeScript solver to compute per-level
branching-factor metrics.

Each generated level records its `branching_threshold` at generation
time. The CI gate (`npm run levels:check-all`) re-runs the solver on
every PR and rejects any level whose computed branching factor exceeds
the recorded threshold plus a tolerance band.

This ties the committed catalogue (100+ YAMLs) to the solver's
internals. A refactor of `solve()`'s greedy tiebreak — even one that
preserves correctness — can shift per-step legal counts and cause the
entire catalogue to fail CI.

## Decision

`solveTrace` and the types it returns (`SolveTrace`, `Coord`, `Path`)
form a **stable contract surface**.

- Changes to `solveTrace`'s return shape require a coordinated
  catalogue regeneration (`uv run icon2level-catalogue`) committed in
  the same PR.
- Changes to the greedy tiebreak inside `solveInPlace` or
  `slitherOutcome` require either:
  - preserving the solver-determinism hash in
    `tests/unit/solver-trace.test.ts` (silent fix), OR
  - updating the baseline hash AND regenerating every affected level's
    recorded `branching_threshold` (explicit fix with catalogue PR).
- The CI gate enforces this via a two-mode comparison:
  - If recorded `solver_content_hash` matches current solver hash:
    strict equality on branching factor.
  - If hashes differ: tolerance band of threshold × 1.1; exceed →
    "solver drift requires catalogue regeneration" CI failure.

## Input-order is part of the contract

`solveTrace(cols, rows, paths)` iterates `paths` in the order given —
`placePath` inserts into `g.arrows` as a `Map` (insertion-ordered), and
the greedy first-exit tiebreak walks `g.arrows.values()` in insertion
order.

Callers (the Python pipeline, the CI gate) MUST serialize `paths` in a
canonical order — e.g. by `id` ascending — before invoking `solveTrace`.
Shuffling the array shifts the greedy solution path and thus both the
branching-factor metrics AND the determinism hash, without the solver's
content hash changing.

## Tolerance band is asymmetric by design

`branching_computed ≤ branching_recorded × 1.1` is a one-sided check:
it catches branching drift *upward* (looser puzzle, players get more
options than recorded). Downward drift (tighter puzzle) is silently
accepted — this is intentional, because a tighter puzzle still
satisfies the recorded "at-most-this-loose" threshold contract.

If symmetric drift detection is ever needed (e.g. for regeneration
auditing), use `|computed - recorded| / recorded ≤ 0.1` and name it
`solver_drift_bound` to distinguish from the gate.

## Regenerating the determinism baseline

When a solver change is intentional and the baseline SHA in
`tests/unit/solver-trace.test.ts` must update:

```
npx vitest run tests/unit/solver-trace.test.ts
# Test fails with "expected ... to be <OLD_SHA>, got <NEW_SHA>".
# Copy NEW_SHA into BASELINE_SHA in the test file.
# Open a catalogue-regeneration PR per the CI-gate section above.
```

## Import discipline

The Python pipeline's Node CLI imports **only** `solveTrace` and the
types it references (`SolveTrace`, `Coord`, `Path`). Direct imports of
`solveInPlace`, `solveCount`, `solveBucket`, `blockedAtTurn1`, or the
internal greedy loop are forbidden from `games/arrow/content/level-tools/`.

Enforcement: not yet a lint rule. A future card in the pipeline may
extract `solveTrace` and its dependencies into `packages/core/arrow-solver/`
so that `content/level-tools/` can't physically import `src/game/*`. Until then, the
guardrail is social: PRs that add `import ... from "../../src/game/solver"`
in `content/level-tools/` beyond the allowlist of `{solveTrace, SolveTrace, Coord,
Path}` must be rejected in review.

## Consequences

**Positive.**
- Catalogue regenerations are intentional events, not surprises.
- The solver can be refactored for performance without breaking the
  pipeline, as long as the determinism hash holds.
- Future migration to `packages/core/arrow-solver/` is a mechanical
  refactor: the contract is already named.

**Negative.**
- Every solver PR must think about branching-factor stability, not
  just logical correctness.
- The tolerance band (×1.1) is a magic number; empirically appropriate
  for greedy tiebreak variation but undefined for major algorithm
  changes. A solver rewrite (e.g. to SAT) requires explicit catalogue
  regeneration regardless of tolerance.

**Neutral.**
- `solve()`, `validateLevel()`, and the other existing exports remain
  public but are not part of this contract. Game runtime uses them
  freely.

## Related

- Plan: `docs/plans/2026-04-20-001-feat-icon-to-level-pipeline-plan.md`
  (Revision 1, Revision 11).
- Trello card: https://trello.com/c/kh60WWbk (Arrow pipeline #01).
- Implementation: `src/game/solver.ts::solveTrace`.
- Test: `tests/unit/solver-trace.test.ts`.
