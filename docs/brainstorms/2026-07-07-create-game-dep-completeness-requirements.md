---
title: "MINE2-6: create-game dependency completeness"
date: 2026-07-07
trello: https://trello.com/c/VgodOC6l
card: VgodOC6l
stage: brainstormed
status: requirements-locked
---

# create-game dependency completeness - requirements

## Summary

Fresh games scaffolded by `tools/create-game` must be immediately complete for
the shared v2 runtime surface: dependency declarations include every workspace
package the generated shell/test harness uses, and the first human-facing docs
identify the actual game instead of carrying template boilerplate.

---

## Problem Frame

The `tap_ten` stress pass exposed a scaffold drift: `create-game` produced a
new game whose `package.json` declared only the kernel and testkit workspaces.
The generated game then needed manual `ui` and `sdk` dependency additions before
its shell/runtime surface matched the shared v2 platform.

The same pass also showed that the generated README and design brief remained
too template-shaped. A new game should still need a real design pass, but its
initial docs should clearly say which game was scaffolded and not ask future
workers to infer whether boilerplate has already been stamped.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The
items below are agent inferences that fill gaps in the input - un-validated bets
that should be reviewed before planning proceeds.*

- Dependency completeness means the scaffolded game declares all four current
  shared workspaces used by v2 game shells and tests: `@fabrikav2/kernel`,
  `@fabrikav2/ui`, `@fabrikav2/sdk`, and `@fabrikav2/testkit`.
- The desired dependency location remains `devDependencies`, matching the
  current template and generated games.
- README and brief stamping should be deterministic from the game id/title, not
  a prompt for custom copy at scaffold time.

---

## Requirements

**Dependency completeness**

- R1. A fresh scaffolded game's `package.json` declares the full shared v2 game
  workspace dependency set: kernel, UI, SDK, and testkit.
- R2. The dependency update preserves the existing scaffold contract: no install,
  no git-add, no unrelated package metadata churn, and no edits outside the new
  game directory during generation.
- R3. The generated dependency declarations must be stable enough for audit and
  workspace checks to catch regressions in the create-game test suite.

**Stamped human-facing docs**

- R4. The generated README identifies the actual game by title and no longer
  reads as the generic Template Game document after scaffolding.
- R5. The generated design brief identifies the actual game by title and/or id,
  while still leaving room for later human design content.
- R6. README and brief stamping must use the same deterministic title derivation
  already used elsewhere by create-game, so ids such as `tap_ten` produce a
  readable title such as `Tap Ten`.

**Regression coverage**

- R7. The create-game unit suite proves the scaffolded package declares all four
  shared workspace dependencies.
- R8. The create-game unit suite proves README and design brief stamping for a
  representative generated game.

---

## Acceptance Examples

- AE1. **Covers R1, R7.** Given the template only declares a subset of shared
  workspace packages, when `create-game` scaffolds `my_game`, the generated
  package declares kernel, UI, SDK, and testkit and the create-game unit test
  fails if any one is missing.
- AE2. **Covers R4, R5, R6, R8.** Given the template README and brief contain
  Template Game placeholders, when `create-game` scaffolds `tap_ten`, the
  generated README and brief contain `Tap Ten` and no longer present themselves
  as the generic template.

---

## Success Criteria

- A new v2 game produced by create-game starts with the same shared dependency
  completeness that `tap_ten` needed after manual correction.
- A downstream worker opening the generated README and brief can tell which game
  the scaffold belongs to without first replacing template boilerplate.
- The create-game test suite catches the specific regression that produced the
  `tap_ten` manual dependency and documentation fix-up.

---

## Scope Boundaries

- Implementation footprint is `tools/create-game/**` unless planning discovers
  the template itself must change to satisfy the generator contract.
- Do not broaden this into a full game-template content rewrite, design-sheet
  round-trip, or real game brief authoring workflow.
- Do not change shared package APIs, game runtime behavior, or device
  verification tooling.
- Do not claim on-device verification for this card; this is a scaffold/tooling
  completeness fix with unit-level coverage.

---

## Key Decisions

- Keep the fix in create-game coverage: the regression came from scaffold output,
  so the create-game test suite is the right gate for preventing recurrence.
- Stamp docs deterministically: scaffold creation should remove generic template
  identity, while leaving game-specific design detail for the normal design pass.

---

## Dependencies / Assumptions

- `@fabrikav2/kernel`, `@fabrikav2/ui`, `@fabrikav2/sdk`, and
  `@fabrikav2/testkit` remain the complete shared workspace dependency set for a
  fresh v2 game scaffold.
- The current title-case behavior is acceptable for generated doc identity.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] Confirm whether brief stamping is best handled by
  substituting the existing template placeholder text, rewriting only the title,
  or seeding a concise generated first paragraph.
