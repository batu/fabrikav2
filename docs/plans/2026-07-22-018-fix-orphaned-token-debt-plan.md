---
title: Orphaned Design Token Debt - Plan
type: fix
date: 2026-07-22
origin: trello-card-fwUgU6WG (card description; no brainstorm document)
trello: https://trello.com/c/fwUgU6WG
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Orphaned Design Token Debt - Plan

## Goal Capsule

Remove every `token-consumers` orphan warning reported by the repository audit without changing rendered game behavior. Treat `npm run audit` as the authoritative inventory, keep `packages/ui` out of scope, and finish with the affected games' unit suites green. Stop and reassess any proposed consumer wiring that would intentionally change a game's presentation; this card is debt cleanup, not a visual redesign.

## Product Contract

### Summary

The repository currently carries design-token declarations that the static audit cannot connect to a `var()` consumer. Each reported declaration must either be removed as dead template residue or connected to the existing behavior it already represents.

### Problem Frame

The live 2026-07-22 baseline reports 44 `orphaned-token` warnings across seven `games/*/design/tokens.css` files. Although `npm run audit` currently exits 0 with warnings, these warnings are unresolved repository debt and make the intended land-gate signal ambiguous.

### Requirements

- R1. Re-run the audit immediately before editing and use its `token-consumers` findings as the complete working inventory.
- R2. Remove declarations that have no legitimate rendered or runtime consumer.
- R3. Wire declarations that represent existing game behavior through direct game-owned consumers without changing presentation.
- R4. Leave `packages/ui` and the audit implementation unchanged.
- R5. Finish with zero `token-consumers` warnings and no new failing audit category.
- R6. Keep every affected game's unit suite green.
- R7. Record the final per-token disposition as dead-and-removed or legitimate-and-wired in the implementation handoff.

### Scope Boundaries

In scope are `games/*/design/tokens.css` and the corresponding game's direct `src` consumers when wiring is required. The baseline inventory covers `_template`, `arrow`, `block_blast`, `find_the_dog`, `marble_run`, `shell_template`, and `tap_ten`.

Out of scope are `packages/ui`, changes to `tools/audit`, unrelated audit warnings, visual polish, and browser E2E or device capture. Device verification is unnecessary only while the implementation preserves existing computed values and removes declarations proven to have no consumer; any intentional visual change exceeds this plan.

### Success Criteria

- `npm run audit` exits 0 and the `token-consumers` category reports `ok` with no orphan allowlist entries added.
- Unit tests pass for each game whose tokens or direct consumers changed.
- The diff contains no `packages/ui` or audit-rule changes.
- The handoff names every reported token and its disposition.

## Planning Contract

### Key Technical Decisions

- KTD1. Classify tokens from behavior outward. Search game source, runtime style reads, and same-value declarations before deciding that a declaration is dead; name similarity alone is not evidence of a consumer.
- KTD2. Prefer removal for generic shell/template leftovers. A token with no source consumer, dynamic runtime read, or documented game-specific role should be deleted rather than connected to an arbitrary element to satisfy the linter.
- KTD3. Preserve legitimate dynamic consumers with a game-owned static CSS bridge. `games/tap_ten/src/shell/TapTenScreen.ts` reads the board palette, gap, radius, and font through runtime style lookup, which the audit's static `var()` scan does not recognize. Wire these through the existing Tap Ten CSS/runtime boundary so the audit sees a real `var()` dependency while canvas output keeps the same values.
- KTD4. Do not use the orphan-token allowlist. The card requires removing or wiring each token, and an allowlist would retain the debt.
- KTD5. Treat the current green-with-warnings audit as the baseline. The implementation target is zero token warnings, not merely exit code 0.

### Baseline Inventory

The initial audit reports 44 warnings:

- `_template` (2): `--fab-seed-color-hero-border`, `--fab-color-on-secondary`.
- `arrow` (6): `--fab-color-on-secondary`, `--fab-color-secondary-border`, `--fab-color-container-outline`, `--fab-space-screen-padding`, `--fab-font-display`, `--fab-levelmap-offset`.
- `block_blast` (2): `--fab-color-secondary-border`, `--fab-levelmap-offset`.
- `find_the_dog` (7): `--fab-color-surface-strong`, `--fab-color-accent-strong`, `--fab-color-reward`, `--fab-color-warning`, `--fab-space-screen-padding`, `--fab-font-display`, `--fab-font-body`.
- `marble_run` (8): `--fab-color-surface-strong`, `--fab-color-accent-strong`, `--fab-color-reward`, `--fab-color-warning`, `--fab-space-screen-padding`, `--fab-font-display`, `--fab-font-body`, `--fab-font-number`.
- `shell_template` (7): the same seven tokens reported for `find_the_dog`.
- `tap_ten` (12): `--fab-color-on-secondary`, `--fab-color-secondary-border`, `--fab-font-display`, plus the nine `--fab-tap-*` board gap, tile radius, board font, board background/text, and tile idle/lit/done/fail tokens.

### Assumptions

- The card description predates the live baseline: `npm run audit` currently exits 0 and labels orphaned tokens as warnings.
- Existing computed styles and canvas parameters are the behavioral baseline; this cleanup must not substitute new values.
- Audit warnings outside `token-consumers` are unrelated and may remain warnings so long as their state does not regress.

### Sequencing

First refresh and capture the warning inventory. Then classify and fix generic tokens game by game, wire any legitimate runtime-only consumers, and finally run the audit plus all affected unit suites. Keep the classification ledger current during implementation so the final handoff is exact rather than reconstructed from memory.

## Implementation Units

### U1. Refresh and classify the orphan inventory

**Goal:** Produce a per-token decision ledger grounded in current source behavior.

**Requirements:** R1, R2, R3, R7

**Files:** `games/_template/design/tokens.css`, `games/arrow/design/tokens.css`, `games/block_blast/design/tokens.css`, `games/find_the_dog/design/tokens.css`, `games/marble_run/design/tokens.css`, `games/shell_template/design/tokens.css`, `games/tap_ten/design/tokens.css`, and matching `games/*/src` consumers.

**Approach:** Re-run the audit, search both static `var()` references and runtime custom-property lookups, and label every finding as dead or legitimate before editing. For duplicated shell-derived files, classify each game independently because copied names do not prove identical usage.

**Test scenarios:**

- The refreshed audit emits a finite list that maps one-to-one onto ledger entries.
- A token read dynamically at runtime is classified as legitimate even when no static `var()` reference exists.
- A generic token with neither a static nor runtime consumer is classified as dead rather than wired speculatively.

**Verification:** Review the ledger against the audit output and confirm all reported games and tokens are represented exactly once.

### U2. Remove dead game and template declarations

**Goal:** Delete declarations proven not to influence current behavior.

**Requirements:** R2, R4, R5, R7

**Files:** The affected `games/*/design/tokens.css` files identified by U1.

**Approach:** Remove only ledger entries marked dead. Preserve comments and nearby token structure unless they become inaccurate because of the deletion. Do not edit generated consumers, shared UI defaults, or unrelated literal values.

**Test scenarios:**

- Each removed token disappears from the audit inventory.
- Removing a declaration does not create an unresolved `var()` reference in the `token-references` category.
- Tokens still used by shared UI or game source remain declared.

**Verification:** Re-run the audit after each small game grouping and inspect the diff for declaration-only removal with no unrelated formatting churn.

### U3. Wire legitimate game-owned consumers

**Goal:** Make existing behavior statically traceable without changing its values.

**Requirements:** R3, R4, R5, R6, R7

**Files:** Legitimate-token declarations in `games/*/design/tokens.css` and the smallest matching direct consumer under `games/*/src`; Tap Ten is expected to involve `games/tap_ten/src/shell/tapTen.css` and `games/tap_ten/src/shell/TapTenScreen.ts`.

**Approach:** Add a natural game-owned `var()` dependency at the existing styling boundary. Where runtime code reads canvas parameters, bridge from the audited design token to the runtime-facing custom property and keep the same fallback and computed value. Do not attach unused declarations to arbitrary DOM elements.

**Test scenarios:**

- Tap Ten's canvas receives the same board colors, spacing, radii, and font values before and after wiring.
- Every wired token disappears from the orphan inventory because a production source file contains a real `var()` dependency.
- Missing CSS custom properties still follow the existing runtime fallback behavior.

**Verification:** Run the affected game's unit suite and add or update a focused source-level/composition assertion if existing tests do not protect the bridge and value preservation.

### U4. Prove repository and per-game gates

**Goal:** Demonstrate zero orphan warnings and no affected-game regression.

**Requirements:** R4, R5, R6, R7

**Files:** Test files only if U3 requires focused coverage; otherwise no additional production files.

**Approach:** Run the repository audit, targeted game unit suites for every touched game, and a final scoped diff review. Produce the per-token disposition ledger in the durable TWF handoff.

**Test scenarios:**

- The audit prints `token-consumers: ok`, exits 0, and introduces no new failures.
- Every touched workspace's unit suite passes.
- The final diff contains no files under `packages/ui` or `tools/audit`.
- The handoff ledger accounts for all warnings from the refreshed U1 inventory.

**Verification:** Preserve command output or concise counts in the handoff and explicitly distinguish dead removals from legitimate wiring.

## Verification Contract

- Baseline and final repository audit: `npm run audit`.
- Per-game unit coverage: `npm run test:unit -w <affected-workspace>` for each touched game workspace, including the template workspace if `_template` changes.
- Focused Tap Ten proof: its existing `test:unit` suite plus an assertion that the production CSS bridge and runtime reads preserve the nine board token values if no current test covers this boundary.
- Scope review: `git diff --name-only` must show only the planned document, affected `games/*/design/tokens.css`, direct `games/*/src` consumers, and narrowly related tests.
- Do not run browser E2E as routine verification. No device capture is required for provably dead declarations and value-preserving wiring; if values or rendered selectors change, stop because the task has crossed into device-first visual work.

## Definition of Done

- U1 has an exact current inventory and per-token classification.
- U2 removes every token classified as dead without unresolved references.
- U3 wires every token classified as legitimate through a natural game-owned consumer with preserved values.
- U4 proves `token-consumers: ok`, audit exit 0, green unit suites for all touched games, and no changes to `packages/ui` or `tools/audit`.
- The implementation diff contains no abandoned bridge experiments, speculative styling, allowlist debt, or unrelated cleanup.
- The TWF handoff cites which tokens were dead versus wired and notes any baseline audit warnings that remain outside this card's scope.
