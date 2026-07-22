---
title: "fix: MRV2-9 device parity wave 3 (in-level theme/HUD, drive hygiene, saga layout, teach art, settled win, settings)"
date: 2026-07-22
type: fix
origin: trello-card-0SmIpfaJ (card description; no brainstorm doc)
trello: https://trello.com/c/0SmIpfaJ
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-9 device parity wave 3

## Summary

Round-2 Pixelsmith judge (iPhone) confirms the wave-2 state mapping fix and leaves eight defects, all in `games/marble_run`. Reference truth (host-local): `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/{refs,v2caps2,judge2}/<state>.{png,json}` plus per-state drive logs `v2r2-<state>.log`.

Code-level ground truth established during planning:

1. **In-level look** — gameplay renders over the page-level purple gradient from `games/marble_run/index.html`, but the judge sees cream/beige: the board tray/`BOARD_SURFACE` (`src/three/BoardScene.ts`) plus `.mr-gameplay-screen` chrome dominate, and none of the v1 sugar3d in-level styling (purple bubble field behind the board, chunky FredokaOne pale-lavender HUD text with dark shadow, muted orange/tan HINT panel with lavender-gray frame, coin pill with icon left of value) is applied. The ported v1 material already exists in-repo: `src/v1core/ui/` (`ui.css`, `tokens.ts`, `fonts.ts`, `HudFrame.ts`), vida art under `public/v1/ui/vida/GameScreen/`, and the home bubble-field CSS at `src/ui/styles.css` ("v1 Sugar3D purple bubble field (MRV2-7)" block).
2. **Drive hygiene** — (a) `LEVEL_COIN_REWARD = 25` in `src/three/constants.ts` is passed by `GameplayController.onWin` and is the prime suspect for the 25-coin leak in every gameplay capture; drives seed via `GameState.setTotalLevelsCompletedForTest` which grants no coins, so the grant happens after level start — root-cause and zero it for seeded/driven states. (b) `driveToPixelsmithState('level-map')` (`src/testing/TestHarness.ts`) does **not** seed — it just calls `gotoHome()`, so the saga window still shows Level 2 / nodes 3-5; the ref shows LEVEL 110 / nodes 106-109. (c) `drivePauseViaUi` seeds `LEVEL_COUNT` before `startLevel(1)`, yet round-2 pause failed with the tutorial hand blocking the settings tap (`v2caps2/pause-MISSING.png`) — the hand gate (`GameScene isFirstLevel` / `tutorialShown`) fires despite seeding; root-cause the ordering or the second gate.
3. **Home saga layout** — the MRV2-8 `HomeBoardPreview` slot (`src/scenes/HomeScene.ts`, inserted after the header) pushed the kit SagaMap into a zigzag around a gray rail, with gold sun node 1 clipping below the LEVEL button. v1: tight centered vertical column, 4-3-2-1 top-to-bottom, node 1 fully above the button (`refs/home-fresh.png`).
4. **Completed node art** — `design/theme.ts` `--fab-levelmap-art-completed` points at `level-node-completed.webp` (wooden coin); v1 uses green candy/wreath tokens (`refs/level-map.png`).
5. **Teach overlay** — v2 shows an emoji hand + white spotlight + charcoal dim (`src/gameplay/hud.ts` `showTutorialHand`, `src/ui/TutorialOverlay.ts`); v1 shows the vida tutorial hand art with no emoji glyph and no full-screen scrim (`refs/gameplay-teach.png`).
6. **Win mid-transition** — win capture caught the overlay half-rendered with hearts/gear/hint still visible under a dim scrim. `styles.css` `completion-mode` already hides sibling chrome, but the predicate (`drivePredicates.ts` `win`: overlay mounted+visible) passes before the transition settles.
7. **Settings still failing** — `v2r2-settings.log`: app launched, XCUITest polled 25s, `tourstate:settings` never appeared; `settings-MISSING` attachment captured. The wave-2 drive (`driveMenuSettingsViaUi`: `gotoHome()` then click `HOME_GEAR_SELECTOR`) is correct in unit tests, so the failure is on-device: root-cause from the log/attachments (gear selector, gotoHome from cold launch under `VITE_INSITU_TOUR=settings`, or marker hosting inside the `.fab-modal-card` aria-modal).
8. **Win reward — conductor ruling**: set `levelCompleteCoinReward` default from 45 to **25** to match v1 (`src/config/remoteConfigSchema.ts:97`, mirrored in `src/config/remoteConfigTemplate.ts`).

Scope fence: `games/marble_run/**` only (plus this plan doc). No `packages/ui` / `packages/testkit` edits — if the kit SagaMap cannot express the v1 column layout via theme/props, report in handoff SURPRISES instead of editing the kit. No PRs; conductor merges and judges device captures. Worker verification: typecheck + unit + eslint.

## Key Technical Decisions

- **KTD1: Port v1's in-level look from the already-ported v1core/vida material, not new art.** Gameplay screen background becomes the same purple bubble field as home (reuse the `styles.css` MRV2-7 bubble-field recipe / `marble-shadow-tile.png`, applied to `.mr-gameplay-screen`). HUD text switches to the FredokaOne-style chunky filled pale-lavender with dark shadow via `src/v1core/ui/fonts.ts`/`tokens.ts`; HINT panel restyled muted orange/tan with lavender-gray frame per `refs/gameplay-opener.png`; coin pill markup reordered icon-before-value in `src/gameplay/hud.ts` `currencyCounterHtml`. All CSS stays scoped under `.mr-gameplay-screen` in `src/gameplay/hud.css`.
- **KTD2: Drives own their save-state deterministically.** Every seeded drive must leave the wallet at 0 coins (v1 `recordWin(i, 0)` parity) and the level-map drive must apply the full seed (all 110 levels' progress → current level 110) **and force the menu to re-render from the seeded state before the predicate can settle** — seeding after the home shell has rendered is a silent no-op visually.
- **KTD3: Predicates assert settled UI truth.** The `win` predicate additionally requires transition-complete: gameplay HUD chrome (hearts, gear, hint) hidden and the overlay opaque/settled — mounted+visible alone is not enough. This extends the wave-2 "UI truth" principle from presence to settledness.
- **KTD4: Root-cause before patching for 2(a), 2(c), and 7.** Each has a confirmed symptom but an unconfirmed mechanism; the units below name the suspects and the evidence artifacts (drive logs, attachments) to consult first. Do not ship a speculative fix without demonstrating the mechanism in a unit test or log trace.
- **KTD5: Win reward parity via config default, not a hardcode.** Change the schema default (and template mirror) to 25; `GameScene.winLevel` keeps reading `remoteConfigService.value('levelCompleteCoinReward')`.

---

## Implementation Units

### U1. In-level background + HUD style port

**Goal:** Gameplay screens match v1: purple bubble field background, chunky pale-lavender FredokaOne HUD text with dark shadow, muted orange/tan HINT panel with lavender-gray frame, coin pill icon-left-of-value (card defect 1).

**Dependencies:** none.

**Files:** `games/marble_run/src/gameplay/hud.ts`, `games/marble_run/src/gameplay/hud.css`, `games/marble_run/src/ui/styles.css` (bubble-field reuse only), `games/marble_run/src/v1core/ui/{fonts.ts,tokens.ts}` (consume, not restructure), `games/marble_run/tests/unit/gameplay-hud.test.ts`.

**Approach:** Apply the home bubble-field background to `.mr-gameplay-screen` (the three canvas already clears transparent — `Stage.ts` `setClearColor(0x000000, 0)` — so a CSS background behind it is sufficient). Restyle HUD counters/HINT per `refs/gameplay-opener.png`, sourcing colors/typography from v1core tokens and the vida GameScreen art rather than inventing values. Reorder the coin pill DOM so the icon precedes the value.

**Test scenarios:** (1) `showGameHud()` renders the coin icon element before the value element in the pill. (2) The gameplay screen root carries the bubble-field background class/style. (3) HINT button/panel classes carry the new v1 styling hooks (assert class names / key CSS custom properties, not pixel colors). (4) Existing hint-affordability disable behavior unchanged (`coins < HINT_COIN_COST` → disabled).

**Verification:** typecheck + unit green; visual truth is conductor-judged on device against `refs/gameplay-opener.png`.

### U2. Drive hygiene: zero-coin seeds, all-110 level-map seed, pause drive tutorial suppression

**Goal:** (a) Seeded/driven gameplay states show 0 coins; (b) level-map capture shows LEVEL 110 with completed nodes 106-109; (c) pause drive reaches the in-game settings modal without the tutorial hand blocking the tap (card defect 2).

**Dependencies:** none (independent of U1).

**Files:** `games/marble_run/src/testing/TestHarness.ts`, `games/marble_run/src/testing/pixelsmithStates.ts` (if predicate needs a seeded-level signal), `games/marble_run/src/core/GameState.ts` (only if a zero-coin seed helper is needed), `games/marble_run/tests/unit/drive-to.test.ts`, `games/marble_run/tests/unit/pixelsmith-states.test.ts`.

**Approach:**
- (a) Root-cause the 25-coin leak: prime suspect `LEVEL_COIN_REWARD = 25` (`src/three/constants.ts`) flowing through `GameplayController.onWin` → shell hooks during drives, or a completion transaction firing during `startLevel`. Once demonstrated, make drives explicitly zero the wallet (`setWallet({coins: 0})` / `setCoinsForTest(0)`) after seeding and before capture, and prevent the drive path from granting.
- (b) `driveToPixelsmithState('level-map')`: apply the all-110 seed (`setTotalLevelsCompletedForTest(LEVEL_COUNT - 1)` so current = 110 — confirm off-by-one against `buildSagaNodes` windowing in `src/menu/saga.ts`, which renders current + 3 ahead; ref shows nodes 106-109 completed below LEVEL 110, so match the ref, not an assumption) **before** `gotoHome()`, and force a home-shell re-render from the seeded state before waiting on the predicate.
- (c) Pause drive: `drivePauseViaUi` already seeds before `startLevel(1)`, yet the hand appeared on device. Check both gates: `GameScene` `isFirstLevel` (`totalLevelsCompleted === 0`) and the separate `tutorialShown` flag on `TutorialOverlay`; also check whether the insitu-tour cold-launch path (`bootstrap.ts`) reaches the drive with a save that resets after seeding. Fix the demonstrated mechanism; additionally make the drive dismiss/suppress any tutorial overlay before tapping the gear as a belt-and-braces step.

**Execution note:** Reproduce each mechanism in a unit test first (a failing test that shows the coin grant / stale menu / hand gate), then fix.

**Test scenarios:** (1) Driving any `gameplay-*` state leaves `coinBalance === 0`. (2) The win drive's final capture state also shows the wallet without a phantom seed grant (win itself may grant the real reward — assert the pre-win balance is 0). (3) level-map drive: after drive, saga nodes reflect current level 110 with the ref's completed-node window; predicate does not settle before the re-render. (4) pause drive: with a seeded save, no tutorial hand/overlay element exists in the DOM when the gear is tapped; drive reaches `settingsVariant === 'ingame'`.

**Verification:** unit green; on-device pause/level-map/gameplay captures conductor-judged.

### U3. Home saga layout: restore v1 vertical column

**Goal:** Home saga renders a tight centered vertical column, order 4-3-2-1 top-to-bottom, gold sun node 1 fully visible above the LEVEL button, with the board preview intact (card defect 3, `refs/home-fresh.png`).

**Dependencies:** none.

**Files:** `games/marble_run/src/scenes/HomeScene.ts`, `games/marble_run/src/menu/homeMenu.ts`, `games/marble_run/src/menu/saga.ts`, `games/marble_run/design/theme.ts`, `games/marble_run/design/tokens.css`, `games/marble_run/src/ui/ftdTheme.ts`, `games/marble_run/src/ui/styles.css`, `games/marble_run/tests/unit/shell-saga.test.ts`, `games/marble_run/tests/unit/home-menu-polish.test.ts`.

**Approach:** The kit SagaMap's layout is driven by `--fab-levelmap-*` theme vars and node props; the regression came from the preview slot insertion (`header.insertAdjacentElement('afterend', slot)`) compressing the map. Constrain the preview slot's height and re-anchor the saga column via game-owned CSS/theme vars (zigzag off, rail hidden or restyled, spacing tightened) so node 1 clears the LEVEL button. **Scope fence:** if the kit cannot express the column via theme/props from the game layer, do the best achievable game-side approximation and report the kit limitation in the handoff SURPRISES — do not edit `packages/ui`.

**Test scenarios:** (1) `buildSagaNodes` ordering unchanged (current last / 4-3-2-1 render order as the kit consumes it). (2) The preview slot carries an explicit max-height/flex constraint (assert the class/style hook). (3) Home shell DOM places the saga container after the preview slot and before the LEVEL/play button.

**Verification:** unit green; layout truth conductor-judged on device against `refs/home-fresh.png`.

### U4. Level-map completed-node art: v1 green candy/wreath tokens

**Goal:** Completed saga nodes use v1's green candy/wreath art, not wooden coins (card defect 4, `refs/level-map.png`).

**Dependencies:** U2(b) (completed nodes only visible once the level-map drive seeds progress).

**Files:** `games/marble_run/design/theme.ts` (`--fab-levelmap-art-completed`, completed color), asset copy into `games/marble_run/public/v1/ui/` from `games/marble_run/refs/assets/` (locate the v1 green candy/wreath token; if absent from `refs/assets`, extract path from the v1 sugar3d tree referenced in wave-2 plan), `games/marble_run/tests/unit/style-guide-alignment.test.ts` or `shell-saga.test.ts`.

**Approach:** Swap the theme var to the v1 completed-node asset and adjust the completed node tint to match. If no green candy/wreath asset exists anywhere in the repo/refs, flag in SURPRISES with the closest available asset applied.

**Test scenarios:** (1) Theme var points at the new asset path and the file exists in `public/`. (2) No other node-state art vars regressed (current/locked/default unchanged).

**Verification:** unit green; art identity conductor-judged against `refs/level-map.png`.

### U5. Teach overlay: vida tutorial hand, no emoji/spotlight/charcoal scrim

**Goal:** `gameplay-teach` shows v1's vida tutorial hand art with no emoji glyph, no white spotlight, no full-screen charcoal dim (card defect 5, `refs/gameplay-teach.png`).

**Dependencies:** U1 (shares hud.ts/hud.css surfaces).

**Files:** `games/marble_run/src/gameplay/hud.ts` (`showTutorialHand`), `games/marble_run/src/gameplay/hud.css`, `games/marble_run/src/ui/TutorialOverlay.ts` (charcoal dim / bubbles, to the extent they appear at capture time), `games/marble_run/tests/unit/gameplay-hud.test.ts`, `games/marble_run/tests/unit/insitu-tour.test.ts`.

**Approach:** Replace the emoji hand with the vida hand image (present under `public/v1/ui/vida/GameScreen/` per the ported v1 hud — confirm the exact filename), remove the spotlight and full-screen scrim, and match v1's presentation (hand anchored to the target cell, subtle motion). Keep the existing gate (only pristine save, level 1).

**Test scenarios:** (1) `showTutorialHand` renders an `<img>` referencing the vida hand asset, no emoji text node. (2) No full-screen scrim element is added by the teach presentation. (3) Hand still absent when `totalLevelsCompleted > 0`.

**Verification:** unit green; conductor-judged against `refs/gameplay-teach.png`.

### U6. Settled win: transition-complete predicate + HUD hidden

**Goal:** Win captures show the settled full-screen result like v1 — no hearts/gear/hint peeking, no mid-transition scrim (card defect 6, `refs/win.png`).

**Dependencies:** none (touches predicate + overlay CSS; coordinate with U2 in `TestHarness.ts`).

**Files:** `games/marble_run/src/testing/drivePredicates.ts`, `games/marble_run/src/testing/TestHarness.ts` (snapshot fields for HUD visibility / settledness), `games/marble_run/src/ui/LevelCompleteOverlay.ts` + `games/marble_run/src/ui/styles.css` (ensure `completion-mode` actually hides the marble HUD chrome, which lives in `.mr-gameplay-screen`, not only `#hud-overlay` siblings), `games/marble_run/tests/unit/drivePredicates` coverage (`src/testing/drivePredicates.test.ts`), `games/marble_run/tests/unit/overlay-visibility.test.ts`, `games/marble_run/tests/unit/shell-results.test.ts`.

**Approach:** Two halves. (1) Behavior: on win, hide the in-level HUD (hearts, gear, HINT — the `GameHud` elements) like v1; `completion-mode` today hides `#hud-overlay` children but the marble HUD may live outside it — confirm and extend. (2) Truth: extend the drive snapshot with `gameplayHudVisible` / overlay-settled signals (e.g. overlay opacity ≥ ~1 and no in-flight transition cover) and require them in the `win` predicate so `tourstate:win` publishes only on the settled frame.

**Test scenarios:** (1) With the overlay mounted but gameplay HUD still visible, `win` predicate is false. (2) With overlay settled and HUD hidden, predicate true. (3) `showLevelCompleteOverlay` hides the marble HUD elements (DOM assertion). (4) Dismissing the overlay restores the HUD for the next level.

**Verification:** unit green; settled-win capture conductor-judged against `refs/win.png`.

### U7. Settings capture: root-cause the on-device failure and fix

**Goal:** `tourstate:settings` publishes on device over the home-shell Close-variant settings modal (card defect 7).

**Dependencies:** none.

**Files:** `games/marble_run/src/testing/TestHarness.ts` (`driveMenuSettingsViaUi`, `gotoHome`, `HOME_GEAR_SELECTOR`), `games/marble_run/src/bootstrap.ts` (insitu-tour launch path), `games/marble_run/src/menu/settings.ts` (aria-modal / marker hosting), `games/marble_run/tests/unit/shell-settings.test.ts`, `games/marble_run/tests/unit/bootstrap-insitu-tour.test.ts`.

**Approach:** Start from evidence: `scratchpad/v2r2-settings.log` tail plus the `settings-MISSING` attachments (UI hierarchy dumps, screen recording, UI snapshots) under `scratchpad/v2caps2/settings.png.attachments/` — determine what was actually on screen at timeout. Candidate mechanisms, in order: (1) `gotoHome()` from cold launch never satisfies `homeShellVisible` under the tour build; (2) `HOME_GEAR_SELECTOR` doesn't match the rendered gear (header built by `buildHeader` in `homeMenu.ts`); (3) modal opens but the marker isn't hosted inside the `.fab-modal-card` aria-modal element so the StaticText never surfaces in the accessibility tree; (4) predicate variant detection (`detectSettingsVariant`) fails on device. Fix the demonstrated mechanism and add a unit test pinning it. This is a first-live-run seam (Operating Contract #7): the code-level fix is verifiable in unit tests, but only the conductor's next device run proves the marker publishes — state that plainly in the handoff.

**Test scenarios:** (1) A regression test reproducing the found mechanism (exact shape depends on root cause — e.g. gear selector matches the actual header DOM; or marker host resolves to the settings modal card when open). (2) `driveMenuSettingsViaUi` resolves true in the jsdom harness from a cold-start state, not just from an already-home state.

**Verification:** unit green; device marker publication remains conductor-verified.

### U8. Win reward config: 45 → 25

**Goal:** v1 parity for the win coin reward (card defect 8, conductor ruling).

**Dependencies:** none.

**Files:** `games/marble_run/src/config/remoteConfigSchema.ts` (default `levelCompleteCoinReward`), `games/marble_run/src/config/remoteConfigTemplate.ts` (mirror), any unit test asserting the 45 default (search and update), `games/marble_run/tests/unit/shell-results.test.ts` if it pins the reward figure.

**Approach:** Change the schema default to 25. Note `LEVEL_COIN_REWARD = 25` in `src/three/constants.ts` already matches v1; after U2(a)'s root-cause, decide whether `GameplayController.onWin`'s constant and the remote-config value should be unified through one source — prefer the remote-config read at the shell seam (existing `GameScene.winLevel` path) and treat the constant as the v1-core-internal value; do not refactor beyond what U2(a) requires.

**Test scenarios:** (1) Schema default for `levelCompleteCoinReward` is 25. (2) Win overlay reward row shows +25 with the default config.

**Verification:** typecheck + unit green.

---

## Verification Contract

- `npm run typecheck`, unit suite (vitest), `npx eslint .` — all green in `games/marble_run` scope.
- Unit tests updated/added per unit: drive hygiene (zero-coin seeds, all-110 seed, pause tutorial suppression), truthful settled-win predicate, settings root-cause regression test, HUD/teach DOM assertions, reward default.
- Device captures are **conductor-judged** — the worker must not claim visual parity; on-device proof of every visual defect (1, 3, 4, 5, 6) and the settings marker (7) is explicitly out of worker reach and stated as unverified in the handoff.
- No browser e2e as close-out (repo policy).

## Definition of Done

All eight card defects addressed in code within `games/marble_run/**`, local code health green, unit coverage for the drive/predicate behavior changes, and a `twf handoff` naming exactly which behaviors remain device-unverified for the conductor's round-3 judge run.

## Open Questions / Deferred

- Exact source of the 25-coin leak (U2a) and the on-device settings failure mechanism (U7) are root-cause tasks by design — the plan names suspects and evidence, not conclusions.
- If the kit SagaMap cannot express the v1 column layout via theme/props (U3) or no green candy/wreath asset exists (U4), the worker reports in SURPRISES rather than widening scope into `packages/ui`.
