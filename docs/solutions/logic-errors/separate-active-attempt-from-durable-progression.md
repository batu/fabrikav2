---
title: Separate active gameplay attempts from durable progression
date: 2026-07-11
category: logic-errors
module: games/_template
problem_type: logic_error
component: service_object
symptoms:
  - Replaying the terminal level could corrupt the completed progression view
  - A completed-level replay could award currency and emit resource_change more than once
  - Result surfaces could label the durable next level instead of the active attempt
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - template-shell
  - progression-state
  - active-attempt
  - durable-state
  - reward-idempotency
  - result-labels
  - state-machine
---

# Separate active gameplay attempts from durable progression

## Problem

The reusable game template used one progression value for two different facts: the level unlocked in the durable save and the level involved in the current gameplay attempt. A win may advance durable progression before its result surface renders, so this conflation caused terminal replay drift, duplicate-reward risk, and result labels that depended on fragile arithmetic.

The snapshot now makes the distinction explicit: `currentLevel` and `completedLevels` belong to persisted progression, while `activeLevel` identifies the transient attempt (`games/_template/src/core/TemplateShellController.ts:22-30`).

## Symptoms

- After a normal win, `currentLevel` advances while the Win card and frozen gameplay backdrop must still name the level just completed. Both render from `activeLevel` (`games/_template/src/shell/TemplateShell.ts:358-364`, `games/_template/src/shell/TemplateShell.ts:511-568`).
- The final level has no higher level to unlock, but completion must still be representable. Completion normalization therefore permits the current level itself only at the terminal boundary (`games/_template/src/core/TemplateShellController.ts:108-115`).
- Replaying a completed final level must leave the balance unchanged and must not emit another `resource_change`; the regression test asserts one reward event across both completions (`games/_template/tests/unit/template-shell.test.ts:136-174`).
- Lose, Retry, and Home must preserve durable level and completion state (`games/_template/tests/unit/template-shell.test.ts:117-133`).

## What Didn't Work

Using persisted `currentLevel` as the displayed attempt fails because `win()` intentionally advances it before the terminal surface renders. Reconstructing the completed attempt as `currentLevel - 1` also fails at the final boundary, where progression remains clamped to the last level, and it cannot distinguish a first completion from a replay.

Always applying the win mutation is unsafe for the same reason. A completed level is replayable, so an unconditional balance update would duplicate both currency and analytics. Resetting or reseeding progression to represent the attempt would merely move the corruption into the save.

## Solution

Use the flow machine as the owner of transient attempt identity and persisted state as the owner of durable progression.

The flow machine retains the level supplied to `start()` or `next()` through complete, fail, pause, and menu transitions (`packages/kernel/src/flow/machine.ts:93-101`, `packages/kernel/src/flow/machine.ts:192-241`). The controller exposes that ID as `activeLevel` only outside Menu, preventing the retained machine value from leaking into the progression surface (`games/_template/src/core/TemplateShellController.ts:164-177`, `games/_template/src/core/TemplateShellController.ts:294-307`).

Completion then uses the attempt identity and makes the durable mutation idempotent:

```ts
const completedLevel = activeLevel() ?? persisted.currentLevel;
const rewardAmount = persisted.completedLevels.includes(completedLevel) ? 0 : 5;
const nextLevel = Math.min(LEVEL_COUNT, completedLevel + 1);

if (rewardAmount > 0) {
  persisted = {
    ...persisted,
    currentLevel: nextLevel,
    completedLevels: normalizedCompleted(
      [...persisted.completedLevels, completedLevel],
      nextLevel,
    ),
    currency: persisted.currency + rewardAmount,
  };
  persist();
}
```

This is the implemented completion transaction (`games/_template/src/core/TemplateShellController.ts:250-265`). The SDK emits `resource_change` only when that transaction produces a positive reward (`games/_template/src/sdk/TemplateSdk.ts:70-80`). Failure analytics, Retry, the result card, and the inert result backdrop consume the same active identity rather than deriving their own (`games/_template/src/core/TemplateShellController.ts:269-273`, `games/_template/src/core/TemplateShellController.ts:363-367`, `games/_template/src/shell/TemplateShell.ts:358-364`, `games/_template/src/shell/TemplateShell.ts:511-568`).

At terminal progression, Next returns to Menu instead of requesting a nonexistent next transition (`games/_template/src/core/TemplateShellController.ts:188-190`, `games/_template/src/core/TemplateShellController.ts:355-361`).

## Why This Works

The two values now change on the timelines they describe:

- `activeLevel` follows the running or just-finished attempt and is shared by rendering, outcome analytics, and Retry.
- In normal player-facing flow, `currentLevel` and `completedLevels` follow the save and change only when an uncompleted attempt wins; explicit test/setup controls may seed or reset them.
- Membership in `completedLevels` makes replay reward-neutral, which skips both persistence and `resource_change`.
- Menu maps `activeLevel` to `null`, even though the shared flow machine intentionally retains its last level ID.

No surface needs to reverse-engineer attempt identity from progression, and no presentation or non-completion transition needs to rewrite durable state.

## Prevention

Keep these invariants covered whenever progression or result flow changes:

1. A normal completion advances durable state exactly once (`games/_template/tests/unit/template-shell.test.ts:81-115`).
2. Lose, Retry, and Home never advance durable progression (`games/_template/tests/unit/template-shell.test.ts:117-133`).
3. Final completion records the terminal level, returns to a fully completed map, and remains replayable without another reward (`games/_template/tests/unit/template-shell.test.ts:136-174`).
4. The result eyebrow and frozen gameplay backdrop display the same active level (`games/_template/tests/unit/template-shell.test.ts:141-154`).
5. Rendered Win/Next and Lose/Retry/Home paths exercise the same controller seam as programmatic tests (`games/_template/tests/unit/template-shell.test.ts:802-845`).

As a design rule, state that must survive app restart belongs to Durable Progression. State that describes the running or just-finished play session belongs to the Active Attempt. Only the guarded completion transaction crosses that boundary.

## Related Issues

- [Data-first semantic contracts and immutable projections](../architecture-patterns/data-first-semantic-contract-and-immutable-projections.md) describes the broader rule against ambiguous or parallel authority; this learning applies it to runtime progression identity.
- No matching GitHub issue was found when this learning was captured.
