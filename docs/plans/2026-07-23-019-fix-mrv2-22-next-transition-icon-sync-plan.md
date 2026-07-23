---
title: "fix: MRV2-22 Next position, transition art, and icon sync"
date: 2026-07-23
type: fix
origin: trello-card-aGN2T48t (card description; no brainstorm document)
trello: https://trello.com/c/aGN2T48t
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-22 Next position, transition art, and icon sync

## Goal Capsule

Close Batu's three MRV2-22 QA defects without widening scope: move the settled win-screen Next button to v1's measured position, replace the inherited shell-template transition/loading art with v1 Marble Run's actual level-start presentation, and make native resource sync provably deliver branded launcher icons on both platforms.

The card description and live v1 are authoritative for behavior; the prior MRV2-21 captures are measurement inputs, not substitutes for fresh side-by-side evidence.
Work stays under `games/marble_run/**` plus the card-named `tools/marble-run/sync-native-resources.mjs`; tests and native resource inputs remain game-owned.
Do not edit `packages/ui/**`, open a pull request, or commit generated `ios/`/`android/` projects.
The implementation worker owns code, automated checks, and v1/v2 captures under `$TWF_OUT_DIR`; the conductor owns the final Pixelsmith device judgment and landing.

---

## Product Contract

### Summary

MRV2-21 corrected the Next button's width and transition behavior but left the standalone button almost against the bottom edge.
Its captured 390x844 geometry places v2 Next at `y=760`, height `68`, leaving 16 px below it; v1 places Next at `y=652.234`, height `75.297` inside a card ending at `y=802`, leaving about 74.5 px below the button and locating its top about 80.3% of the way from card top to card bottom.

The generic v2 level transition is explicitly rendered by `showSceneTransitionCover()` as `/ui/loading-icon.png`, a generated shell-template-era spinner.
The implementer must capture live v1's corresponding level-start/next-level sequence before choosing the replacement because the v1 source does not expose the same cover abstraction.

The committed native overlay includes Android `mipmap-*` launcher PNGs, and `tools/marble-run/sync-native-resources.mjs` claims to copy the entire resource tree, but no automated check executes the overlay against a generated-project-shaped fixture and compares launcher bytes.

### Requirements

- R1. At 390x844, the settled v2 win-screen Next button must match live v1's vertical relationship to the result card: use the measured v1 card-relative position and comfortable lower gap, not an arbitrary viewport-bottom offset.
- R2. The Next placement must remain usable on shorter/taller supported phone viewports and preserve the compact pill geometry and transition fixes already landed by MRV2-21.
- R3. Generic level-start and next-level transitions must present Marble Run's exact live-v1 visual treatment; `/ui/loading-icon.png` and any shell-template/FTD art must not appear.
- R4. Transition timing, input shielding, readiness caps, and reduced-motion behavior must remain intact unless fresh v1 evidence proves that a timing change is part of the parity fix.
- R5. `ios:add`/`ios:sync` and `android:add`/`android:sync` must overlay their respective committed branded icon resources after Capacitor generation/sync.
- R6. An automated integration-style test must fail when a generated Android launcher mipmap differs byte-for-byte from its committed source and pass after the sync operation restores it; it must also cover idempotent re-sync and the iOS overlay path.
- R7. Generated native project trees and captures remain disposable under `$TWF_OUT_DIR`; only `games/marble_run/**` and the card-named `tools/marble-run/sync-native-resources.mjs` may enter the branch.
- R8. Typecheck, unit tests, game-local ESLint, and the repo audit are green. Browser E2E is not routine close-out and must not be described as device verification.

### Acceptance Examples

- AE1 (R1, R2). Given v1 and v2 settled win screens at 390x844, when card and Next bounds are captured, then v2 uses v1's card-relative placement (v1 reference: Next top/card top delta `610.234 / 760`, with about `74.47 px` between Next bottom and card bottom) within normal rendering tolerance, rather than v2's prior 16 px viewport-bottom gap.
- AE2 (R2). Given a short supported phone viewport, when the win screen settles, then the Next pill stays fully visible, comfortably separated from the card/edge, and does not overlap the safe area.
- AE3 (R3, R4). Given matched live-v1 and v2 level-start sequences, when equivalent frames are compared, then v2 shows the same Marble Run transition presentation and no `/ui/loading-icon.png` spinner; the cover still blocks taps until reveal and clears after readiness/reduced-motion rules.
- AE4 (R5, R6). Given fixture source icons and generated iOS/Android trees containing placeholder bytes, when the sync seam runs, then every expected target equals its source bytes; changing an Android `mipmap-*` target back to placeholder bytes makes the assertion fail until re-sync.
- AE5 (R5, R6). Given already synchronized targets, when sync runs again, then it reports no changed files and preserves byte-identical output.
- AE6 (R7, R8). `git diff --name-only` is limited to `games/marble_run/**` plus `tools/marble-run/sync-native-resources.mjs`; required code-health commands exit zero; per-item v1/v2 evidence paths are present under `$TWF_OUT_DIR`.

### Scope Boundaries

In scope: game-local completion layout/CSS, the generic scene transition and its Marble Run-owned assets, native resource sync behavior, and game-owned tests.

Out of scope: any other `tools/**` or shared UI kit changes, broader result-card redesign, play-entry home choreography unless live v1 proves it is the same defective path, icon redesign, committing native build trees, browser-first visual convergence, pull requests, and merging.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Express Next placement relative to the completion card/stage rather than as a viewport-bottom pin. The v1 source uses `bottom: 9.8%` on a full-height result card, and the prior capture supplies exact card/Next bounds; a game-local override should preserve that relationship across phone heights.
- KTD2. Capture v1 before changing transition art. `showSceneTransitionCover()` currently identifies the wrong v2 asset, but the correct replacement may be a different image, a no-icon cover, or a brief scene treatment. Fresh matched frames determine which; do not invent a new loading illustration.
- KTD3. Keep the existing transition lifecycle and replace only its presentation unless evidence requires more. This limits regression risk in `GameScene`/`HomeScene` readiness and input-shield paths.
- KTD4. Test native sync through exported filesystem behavior using temporary fixture trees. A source/target byte comparison after `copyOverlay()` directly proves the failure mode while avoiding committed generated projects or a full Capacitor build in unit tests.
- KTD5. Assert the launcher icon inventory, not just one arbitrary copied file. The Android proof covers `ic_launcher.png`, `ic_launcher_round.png`, and `ic_launcher_foreground.png` across committed density directories so a partial overlay cannot pass.

### Assumptions

- A1. The MRV2-21 390x844 captures under `.twf-out/E9l7SETU` remain valid geometry references, but implementation will re-capture live v1 and v2 for this card.
- A2. The visual target is the current live v1 checkout at `fabrika/games/marble_run/sugar3d`; static `refs/win.png` is a supporting reference.
- A3. Existing source icon files in `games/marble_run/native-resources/` are the intended branded assets; this card fixes delivery and verification, not artwork creation.
- A4. The generated-project stopgap copy is not source of truth and must not be imported back into the repository without byte-checking it against committed native resources.

### Critical Files and Patterns

- `games/marble_run/src/v1core/ui/ui.css` — base `.fab-complete-actions`/`.fab-complete-next-btn` geometry; inspect but prefer a Marble Run-local override.
- `games/marble_run/src/ui/styles.css` — game-owned completion overrides and generic `#scene-transition-cover` presentation.
- `games/marble_run/src/ui/SceneTransitionCover.ts` — `/ui/loading-icon.png` generic transition markup and lifecycle.
- `games/marble_run/src/ui/LevelCompleteOverlay.ts` — completion mount and Next-to-transition handoff.
- `games/marble_run/src/scenes/GameScene.ts` — generic cover call sites for level load/restart/advance.
- `games/marble_run/design/assets/loading-icon.png`, `games/marble_run/public/ui/loading-icon.png`, and `games/marble_run/design/asset-specs/loading-icon.json` — inherited loading artwork to remove from the transition path; delete only if asset inventory proves it has no other consumer.
- `tools/marble-run/sync-native-resources.mjs` — exported overlay map and byte-copy seam used by both platform scripts.
- `games/marble_run/native-resources/ios/App/App/Assets.xcassets/` — committed iOS icon source.
- `games/marble_run/native-resources/android-res/app/src/main/res/mipmap-*/` — committed Android launcher sources.
- `games/marble_run/tests/unit/ios-inject-team.test.ts` — nearby pattern for testing an exported native helper.
- `games/marble_run/tests/unit/device-parity-wave8.test.ts` and `games/marble_run/tests/unit/shell-results.test.ts` — nearby game-local CSS/DOM regression patterns.
- Read-only v1 reference: `fabrika/games/marble_run/sugar3d/src/ui/dom.ts` and `src/ui/style.css`, especially `.win-next-button { bottom: 9.8%; }`.

### Sequencing

1. Capture fresh live-v1 and current-v2 settled win metrics plus matched level-start/next-level frame sequences at 390x844 under `$TWF_OUT_DIR`.
2. Implement and test the card-relative Next placement without changing shared kit defaults.
3. Port the transition presentation proven by the v1 sequence, preserving cover lifecycle semantics and removing obsolete loading-art references only when unused.
4. Harden native resource sync and add fixture-based byte/inventory coverage for both platforms, with explicit Android launcher mismatch proof.
5. Run code-health gates, capture matched v2 evidence for each visual item, then leave the final real-device Pixelsmith judgment to the conductor.

---

## Implementation Units

### U1. Pin Next to v1 card-relative geometry

- **Goal:** Move the standalone Next pill from the viewport edge to v1's measured result-card position while preserving MRV2-21 width and transition behavior.
- **Requirements:** R1, R2.
- **Files:** `games/marble_run/src/ui/styles.css`; optionally `games/marble_run/src/ui/LevelCompleteOverlay.ts` only if a game-local class/hook is missing; `games/marble_run/tests/unit/shell-results.test.ts` or a focused new game-local test.
- **Approach:** Re-capture bounds, then encode the v1 card-relative `bottom: 9.8%` relationship (or an equivalent stage-relative rule) in the game-owned completion layer. Include safe-area/short-height constraints without reverting to the old near-bottom pin.
- **Test Scenarios:** settled 390x844 geometry matches AE1; short viewport keeps button visible and non-overlapping; Next retains compact width and enabled/clickable behavior; existing result-card claim-to-Next transition still works.
- **Verification:** focused DOM/CSS unit test plus v1/v2 settled screenshots and metrics JSON under `$TWF_OUT_DIR`.

### U2. Port live-v1 transition presentation

- **Goal:** Remove the shell-template loading icon from generic level transitions and reproduce the observed live-v1 transition.
- **Requirements:** R3, R4.
- **Files:** `games/marble_run/src/ui/SceneTransitionCover.ts`; `games/marble_run/src/ui/styles.css`; exact game-owned asset files determined by v1 capture/inventory; focused transition test.
- **Approach:** Capture both v1 transition paths first, identify the actual presentation and source asset(s), then make the smallest markup/CSS substitution. Preserve current cover generation checks, minimum visibility/readiness cap, input shield, fade cleanup, and reduced-motion branch unless the parity evidence directly contradicts them.
- **Test Scenarios:** generic cover contains the correct Marble Run presentation and never references `/ui/loading-icon.png`; repeated show/hide remains generation-safe; cover intercepts input while active; normal and reduced-motion paths remove it; play-entry behavior is unchanged unless proven in scope.
- **Verification:** focused unit test plus timestamped v1/v2 frame sequences for level start and Next-to-next-level.

### U3. Make native icon overlay byte-verifiable

- **Goal:** Ensure both platform sync scripts restore committed branded icons after Capacitor writes placeholders, with Android launcher mipmaps explicitly protected.
- **Requirements:** R5, R6, R7.
- **Files:** `tools/marble-run/sync-native-resources.mjs`; new `games/marble_run/tests/unit/sync-native-resources.test.ts`; `games/marble_run/native-resources/README.md` if the verified contract/command needs correction.
- **Approach:** Keep `copyOverlay()` idempotent and test it using temporary, generated-project-shaped source/target fixtures. Add a deterministic expected-icon inventory or validation helper if the current broad tree walk cannot distinguish “copied something” from “all launcher icons delivered.” Exercise both `OVERLAYS.ios` and `OVERLAYS.android` layouts without writing generated trees into the worktree.
- **Test Scenarios:** placeholder Android launcher files become byte-identical to source; every density and launcher variant is covered; a deliberately re-corrupted mipmap fails comparison; second sync is a no-op; nested iOS AppIcon assets copy and re-sync idempotently; missing expected launcher source/target is surfaced rather than silently passing.
- **Verification:** focused Vitest output and byte/hash comparison output from a disposable `$TWF_OUT_DIR` generated-resource fixture.

### U4. Integrated close-out evidence

- **Goal:** Produce an honest handoff that distinguishes automated checks, dev-server reference captures, and conductor-owned device judgment.
- **Requirements:** R7, R8.
- **Files:** no source file required; all disposable builds/captures go under `$TWF_OUT_DIR`.
- **Approach:** Run focused tests first, then full game gates. Capture v1 and v2 side-by-side for each visual item and record paths/measurements. Exercise icon overlay against disposable generated trees and record source/target hashes. Do not run browser E2E as routine game close-out or call it device proof.
- **Test Scenarios:** all required commands exit zero; diff remains game-scoped; evidence contains itemized v1/v2 paths; no generated `ios/`/`android/` tree is tracked; conductor can run Pixelsmith from the handoff without reconstructing state.
- **Verification:** command logs, metrics/frame artifacts, hash output, `git diff --name-only`, and `git status --short`.

---

## Verification Contract

| Gate | Command / observation | Proves |
| --- | --- | --- |
| Focused results tests | `npm run test:unit -w @fabrikav2/marble_run -- --run tests/unit/shell-results.test.ts` (adjust to the final focused file list) | U1 result DOM/CSS regression |
| Focused native sync test | `npm run test:unit -w @fabrikav2/marble_run -- --run tests/unit/sync-native-resources.test.ts` | U3 byte overlay, inventory, mismatch, and idempotence |
| Type safety | `npm run typecheck -w @fabrikav2/marble_run` | Game TypeScript compiles |
| Unit suite | `npm run test:unit -w @fabrikav2/marble_run` | Game-local regressions are green |
| ESLint | `npm run lint -w @fabrikav2/marble_run` | Game-local JS/TS lint is green |
| Repository audit | `npm run audit` | Existing repository audit gate remains green |
| Win geometry evidence | Fresh 390x844 v1/v2 screenshots plus element-bounds JSON under `$TWF_OUT_DIR` | U1 matches v1 card-relative placement |
| Transition evidence | Matched timestamped v1/v2 frame sequences for level start and Next advance under `$TWF_OUT_DIR` | U2 ports the actual v1 presentation |
| Native resource proof | Disposable generated iOS/Android trees under `$TWF_OUT_DIR`, with source/target hashes for all launcher icons | U3 affects build-shaped outputs, not only a mock call |
| Scope check | `git diff --name-only` and `git status --short` | No shared-kit, generated-tree, or unrelated changes |
| Device judgment | Conductor Pixelsmith capture/judge on the real mobile target after worker handoff | Real-device visual close-out; cannot be replaced by desktop captures |

---

## Definition of Done

- U1 is complete when fresh metrics show the v2 Next button matches v1's card-relative vertical placement across the reference viewport and remains safe on a short phone viewport.
- U2 is complete when matched sequences show v2 using the live-v1 transition presentation with no shell-template loading icon while lifecycle/input behavior remains covered.
- U3 is complete when an integration-style test proves both platform overlays, explicitly fails on mismatched Android launcher bytes, passes after sync, and proves idempotence.
- U4 is complete when all required code-health gates are green, itemized evidence lives under `$TWF_OUT_DIR`, the diff is scoped, and generated native projects are absent from tracked changes.
- No abandoned assets, temporary fixtures, debug hooks, or failed-attempt code remain in the source diff.
- The handoff explicitly marks conductor Pixelsmith device judgment as remaining until the conductor performs it.
