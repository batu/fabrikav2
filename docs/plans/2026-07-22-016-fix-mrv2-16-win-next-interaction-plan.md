---
title: "fix: MRV2-16 win Next interaction"
date: 2026-07-22
type: fix
origin: trello-card-jF90JZii (card description; no brainstorm document)
trello: https://trello.com/c/jF90JZii
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-16 win Next interaction

## Goal Capsule

Restore the win screen's standalone Next button so a real tap advances from level 1 to level 2 and closes the result overlay. The Trello report and acceptance commands are authoritative. Work is limited to `games/marble_run/**`; `packages/ui/**`, pull requests, and unrelated visual changes are out of scope.

The implementation worker owns diagnosis, the smallest game-local fix, automated regression coverage, and the requested built-dist headless click-through proof. The conductor owns landing and any additional on-device confirmation.

---

## Product Contract

### Summary

MRV2-11 moved the Next action out of the result card and appended it directly to the modal backdrop. The current code still constructs the button with `onClick: runNext`, and `GameScene` already restarts after the overlay promise resolves, but Batu's device report proves that a physical tap does not complete that path. The defect must be localized to the actual event target, callback lifecycle, or overlay stacking/pointer-event seam before changing code.

### Requirements

- R1. The enabled standalone `[data-fab-action="result-next"]` accepts a real pointer click on the settled win screen.
- R2. One accepted click invokes the completion advance path exactly once, dismisses `#level-complete-overlay`, and restarts `GameScene` on level 2.
- R3. The button remains outside `.fab-modal-card` with the accepted MRV2-11 through MRV2-15 visual composition.
- R4. The fix remains game-local under `games/marble_run/**` and does not change `packages/ui/**`.
- R5. Typecheck, unit tests, ESLint, and the card-specific built-dist Playwright click-through are green.

### Acceptance Examples

- AE1. Given a harness-enabled built distribution at `?insituTour=win`, when the win state settles and Playwright clicks the visible Next button, then the result overlay disappears and the harness reports active `GameScene` at level 2.
- AE2. Given the win overlay DOM in a unit test, when the standalone Next button is clicked, then `gameState.markActiveCompletionAdvanced` advances once and the overlay's public promise resolves once after dismissal.
- AE3. Given a click coordinate at the center of the visible Next button, when the browser performs a hit test, then the button or an intentional descendant is the topmost interactive target rather than the scrim, card, transition cover, or modal root.

### Scope Boundaries

- Modify only `games/marble_run/**` plus this plan artifact.
- Preserve the standalone backdrop-level Next composition, reward stack, scrim appearance, and rate-prompt behavior.
- Do not add dependencies, edit the shared UI kit, open a pull request, or broaden the change into modal refactoring.
- The explicitly requested Playwright case is a targeted headless regression proof. It does not replace real-device verification under the project policy.

### Product Contract Preservation

Product Contract unchanged from the card; the plan makes the requested click-through and quality gates executable without widening scope.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Characterize before fixing. Use the built win state to inspect `elementFromPoint` at the button center, computed `pointer-events`, bounding boxes, disabled state, and click/callback counters. Choose the fix only after distinguishing an occluded target from lost handler wiring or a callback/promise lifecycle failure.
- KTD2. Keep `runNext` as the single advance authority. Preserve its idempotent `nextClicked` guard, `markActiveCompletionAdvanced`, rate-prompt branch, transition cover, handle dismissal, and public promise resolution. Do not create a second scene-restart path in the DOM layer.
- KTD3. Apply the smallest game-local correction at the proven seam. If hit testing is wrong, adjust only the Marble completion-mode stacking or pointer-event rule in `games/marble_run/design/theme.ts`; if event attachment is wrong, correct the `buildButtonElement` call or append lifecycle in `games/marble_run/src/ui/LevelCompleteOverlay.ts`. Do not edit `packages/ui`.
- KTD4. Test both halves of the contract. A unit test pins handler invocation and single-fire semantics; a direct Playwright spec against a harness-enabled built dist pins real browser targeting plus the level-1-to-level-2 transition.

### Existing Patterns and Constraints

- `games/marble_run/src/ui/LevelCompleteOverlay.ts` owns `runNext`, creates the standalone button through `buildButtonElement`, appends it to `handle.el`, and resolves only after dismissal.
- `games/marble_run/src/scenes/GameScene.ts` consumes the overlay result and restarts the active scene; `gameState.currentLevelIndex` is advanced synchronously by the click callback.
- `games/marble_run/design/theme.ts` owns the completion-mode backdrop layout and standalone button z-index; `games/marble_run/index.html` owns the fixed `#modal-root` layer.
- Extend `games/marble_run/tests/unit/shell-results.test.ts` for overlay wiring. Follow `games/marble_run/tests/e2e/boot.spec.ts`, `games/marble_run/playwright.config.ts`, and the existing `TestHarness` snapshot/drive APIs for the browser proof.
- Put generated dist, preview logs, and captures under `$TWF_OUT_DIR`; do not leave build output in the source worktree.

### Sequencing

First reproduce and capture the browser hit-test/callback boundary on current code. Then implement the narrow correction and unit regression. Finally build with the test harness enabled and run the direct card-specific Playwright click-through before the full local quality gates.

---

## Implementation Units

### U1. Diagnose and repair the standalone Next interaction

- **Goal:** Make a real click reach the existing single-fire advance callback without changing the accepted win composition.
- **Files:** `games/marble_run/src/ui/LevelCompleteOverlay.ts`; conditionally `games/marble_run/design/theme.ts` or another directly proven game-local completion style file.
- **Dependencies:** none.
- **Patterns:** Preserve `runNext`, `nextClicked`, `handle.dismiss()`, and `handle.dismissed`; keep the button as a direct backdrop child.
- **Test Scenarios:** The button exists once outside `.fab-modal-card`; its center hit-tests to the intended action; it is enabled when the win tour settles; one click advances once; repeated/programmatic clicks cannot double-advance; the overlay dismisses after the accepted click.
- **Verification:** Observe pre-fix and post-fix hit-test/callback results in the same built win state, then cover the resolved seam with U2 and U3.

### U2. Pin handler wiring and dismissal semantics in unit coverage

- **Goal:** Prevent future DOM moves or style changes from leaving a visible but inert Next action.
- **Files:** `games/marble_run/tests/unit/shell-results.test.ts`; test-only mocks in that file as needed.
- **Dependencies:** U1.
- **Patterns:** Reuse the suite's `#modal-root` fixture and mocked transition/audio modules. Spy on or assert the observable `gameState` completion index and returned overlay promise rather than duplicating implementation internals.
- **Test Scenarios:** Clicking `[data-fab-action="result-next"]` marks the active completion advanced to the next index, dismisses the overlay, resolves with the expected next-level result, and remains single-fire under a second dispatched click. Existing outside-card structure assertions stay green.
- **Verification:** Run the narrowed Vitest file, then the full Marble Run unit suite.

### U3. Add built-dist Playwright level-transition proof

- **Goal:** Prove the browser event targets the visible button and the game reaches level 2 through the production scene path.
- **Files:** `games/marble_run/tests/e2e/boot.spec.ts` or a focused new spec under `games/marble_run/tests/e2e/`; `games/marble_run/playwright.config.ts` only if a build-preview configuration is needed; game-local scripts only if existing commands cannot serve `$TWF_OUT_DIR` deterministically.
- **Dependencies:** U1 and U2.
- **Patterns:** Build with `VITE_ENABLE_TEST_HARNESS=true`, serve the generated dist from `$TWF_OUT_DIR`, enter `?insituTour=win`, wait on harness state rather than animation sleeps, and use Playwright's real `click()` on `[data-fab-action="result-next"]`.
- **Test Scenarios:** The win marker settles at level 1; the locator is visible and enabled; center-point hit testing identifies the Next action; one Playwright click removes `#level-complete-overlay`; the harness snapshot reports active `GameScene`, non-complete play state, and level 2 after restart.
- **Verification:** Run the focused spec directly with `npx playwright test --config games/marble_run/playwright.config.ts <spec>` against the harness-enabled built preview and retain command output under `$TWF_OUT_DIR`.

---

## Verification Contract

| Gate | Command or observation | Covers | Done signal |
|---|---|---|---|
| Narrow unit | `npm --prefix games/marble_run run test:unit -- tests/unit/shell-results.test.ts` | U1, U2 | Next wiring, single-fire advance, and dismissal assertions pass. |
| Built dist | Build Marble Run with `VITE_ENABLE_TEST_HARNESS=true` and direct output under `$TWF_OUT_DIR` | U3 | Preview serves the newly built harness-enabled assets, not a stale dev server. |
| Headless click-through | Direct `npx playwright test --config games/marble_run/playwright.config.ts <focused-spec>` against that preview | R1, R2, R3, AE1, AE3 | Real click closes the overlay and harness observes level 2 in active `GameScene`. |
| Typecheck | `npm --prefix games/marble_run run typecheck` | R4, R5 | Exits zero. |
| Unit suite | `npm --prefix games/marble_run run test:unit` | R2-R5 | Exits zero. |
| ESLint | `npm --prefix games/marble_run run lint` | R4, R5 | Exits zero. |
| Device follow-up | Real iPhone WKWebView tap on the win Next button | R1-R3 | Batu or the conductor observes level 2 after a physical tap; until captured, device behavior remains unverified. |

---

## Definition of Done

- The root cause is documented in the implementation handoff with the pre-fix hit-test or callback evidence that distinguished it from the other suspected seams.
- The smallest game-local fix is implemented under `games/marble_run/**`, with no `packages/ui/**` changes.
- Unit coverage proves the standalone button invokes the advance path once and dismissal resolves the overlay flow.
- A harness-enabled built distribution under `$TWF_OUT_DIR` passes the focused Playwright click-through from win at level 1 to active `GameScene` at level 2 with the result overlay closed.
- Marble Run typecheck, full unit suite, and ESLint pass.
- Any missing real-device confirmation is reported explicitly rather than described as verified.
