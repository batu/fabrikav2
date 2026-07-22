---
title: "fix: MRV2-8 device parity wave 2 (home board preview, state drives, truthful predicates, win/settings modals)"
date: 2026-07-22
type: fix
origin: trello-card-xHpTSmuI (card description; no brainstorm doc)
trello: https://trello.com/c/xHpTSmuI
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-8 device parity wave 2

## Summary

Second on-device Pixelsmith judge pass (iPhone 12) found five defects in games/marble_run vs canonical v1 sugar3d. Root causes are all confirmed in code:

1. **Home board preview missing** — v1 `App.gotoMenu()` calls `showMenuDecor()`: a non-interactive `BoardScene` of `LEVELS[2]` added to the three stage, framed at `boardSize * 1.42`, rendered between banner and saga chain. v2 `src/scenes/HomeScene.ts` renders no three content at all (no Stage/BoardScene references).
2. **Wrong drive boards + seeding** — v2 `src/testing/pixelsmithStates.ts` maps opener/plugs/voids/teach → 1/2/3/4 (stub-era values). v1 maps → 1/8/6/1 against the same 110-level set (levels are byte-identical, so v1's indices are directly correct). v1 `driveTo` seeds full progress for opener/plugs/voids (`recordWin` for every level — suppresses the tutorial hand, which fires only on level 1 with `currentLevel() === 1`) and resets to pristine save for teach only. v2's `startLevel` does neither, so opener shows the tutorial hand (judge blocker).
3. **Lying predicates** — v2 `pause` predicate accepts `lifecycleSuspended` (the drive suspends the lifecycle without any UI change → gameplay screenshot published as `tourstate:pause`); `win` accepts internal `levelComplete`/`status === 'complete'` before/without the overlay in the DOM. Both must assert the actual mounted, visible UI.
4. **Settings drive/predicate wrong variant + marker** — `openSettingsFromUi` clicks `#home-nav-settings, #settings-btn` without ensuring home first, so it opened the in-game (Restart/Home) variant over gameplay; the marker never published (capture FAILED). MRV2-5 ruling: menu settings = Close variant. `packages/testkit` `markerHost.ts` already re-parents the marker into the topmost `[aria-modal="true"]` element — the game-side fix is driving the right variant and ensuring the settings modal actually sets `aria-modal="true"`.
5. **Win result card art** — `src/ui/LevelCompleteOverlay.ts` already builds ribbon/crown/reward-row/Next, but the wave-1 win capture showed raw gameplay (defect 3), so the card art is unverified vs `refs/win.png`; align tokens/CSS once the drive genuinely wins.

Reference truth (host-local, readable on this machine): `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/{refs,v2caps,judge}/<state>.{png,json}`. v1 reference code: `fabrika/games/marble_run/sugar3d/src/main.ts` (`driveTo`), `src/App.ts` (`showMenuDecor`, `startLevel` tutorial-hand gate), `src/testing/pixelsmithStates.ts` (state→level map + rationale).

Scope fence: `games/marble_run/**` only (plus this plan doc). No `packages/ui` or `packages/testkit` edits. No PRs. Device captures remain conductor-judged; worker verification is typecheck + unit + eslint + new unit tests for predicates and the state→level map.

## Key Technical Decisions

- **KTD1: Port `showMenuDecor`, not a screenshot.** HomeScene gains a real three decor board using the already-ported `src/three/Stage.ts` + `src/three/BoardScene.ts` and `src/marble-board` engine — same mechanism v1 uses (`BoardEngine(LEVELS[2])`, non-interactive callbacks, `stage.frameBoard(w * 1.42, d * 1.42)`, `setViewOffsetYRatio(0.11)`). No static image. Ownership/lifecycle: create on HomeScene mount, dispose on shutdown/gameplay entry (mirror v1 `clearBoard` for the decor board).
- **KTD2: Mirror v1's drive semantics verbatim.** State→level map becomes 1/8/6/1. opener/plugs/voids seed full progress *before* starting the level; teach resets to pristine save. Seeding uses the v2 save API (`GameState` equivalent of v1's `saveState.recordWin`/`resetProgress`) via the harness (`seedSave`/`resetSave` already exist).
- **KTD3: Predicates assert UI truth (DOM mounted AND visible), not state flags.** `win`: `#level-complete-overlay` present and visible (not `display:none`/detached) — internal `levelComplete` flags may narrow but never satisfy alone. `pause`: GameScene active + in-game settings modal (Restart/Home variant) visible — drop `lifecycleSuspended` as a sufficient condition. `settings`: home shell visible + Close-variant settings modal visible. Distinguish variants via a deterministic DOM hook (e.g. existing `data-action="settings-close"` vs `settings-restart` rows, or a variant class on the modal root).
- **KTD4: Drives produce the state through the real UI path.** Win: start level 1 (seeded save), `setAnimationSpeed(6)` (GameplayController already exposes it), then repeatedly tap `movableMarbles()[0]` until the engine genuinely wins and the overlay mounts — v1 `driveTo('win')` semantics; no `scene.winLevel()` shortcut for the Pixelsmith path. Pause: from live gameplay, open the in-game settings modal (HUD settings/pause button), not lifecycle suspension. Settings: `gotoHome()` first, then open menu settings (Close variant).
- **KTD5: Marker hosting is already solved in testkit** (`ensureHostedMarker` re-parents into `[aria-modal="true"]`); game-side requirement is only that the settings/win modals carry `aria-modal="true"` so the marker survives the accessibility-tree clamp. Verify, add the attribute where missing — game-local change.

---

## Implementation Units

### U1. Home/level-map board preview tile + header/saga layout parity

**Goal:** Home renders the tilted wooden board preview between banner and saga chain like `refs/home-fresh.png`; coin pill + gear sit ABOVE the banner (confirmed in ref); saga nodes sit on the single center chain line.
**Dependencies:** none.
**Files:** `games/marble_run/src/scenes/HomeScene.ts`, `games/marble_run/src/three/Stage.ts` / `src/three/BoardScene.ts` (consume, don't rewrite), `games/marble_run/src/menu/homeMenu.ts`, `games/marble_run/src/ui/styles.css`; test: `games/marble_run/src/scenes/HomeScene.test.ts` or nearest existing home test file.
**Approach:** Port v1 `App.showMenuDecor()`/`tickMenuDecor` into the v2 home path: decor `BoardEngine(LEVELS[2])` + `BoardScene` on a stage framed at `w*1.42, d*1.42`, view offset ratio 0.11, non-interactive. Decide where the stage lives: if gameplay's three canvas/Stage is reusable while HomeScene is active, reuse it; otherwise HomeScene owns a decor Stage on the shared canvas. Dispose decor board on home exit (no leak into gameplay). For layout: verify DOM order in `homeMenu.ts` (header = pills row, then banner) and center the saga chain line under the nodes; adjust CSS only where the ref disagrees with current render.
**Test scenarios:**
- Home mount creates a decor board for the expected decor level and disposes it on gameplay entry (spy/DOM-level, no WebGL assertions).
- Header DOM order: pills container precedes banner element.
**Verification:** typecheck/unit/eslint green; dev-server sanity render (worker-only; device parity is conductor-judged).

### U2. State→level map + progress seeding (v1 parity)

**Goal:** Pixelsmith gameplay states drive the same boards as v1 with the same save preconditions; opener no longer shows the tutorial hand; teach does.
**Dependencies:** none.
**Files:** `games/marble_run/src/testing/pixelsmithStates.ts`, `games/marble_run/src/testing/TestHarness.ts`; tests: `games/marble_run/src/testing/pixelsmithStates.test.ts` (extend/create).
**Approach:** Set `PIXELSMITH_STATE_LEVELS` to `{opener: 1, plugs: 8, voids: 6, teach: 1}` and update the stale stub-era comment to v1's rationale (plugs = first 'X' board, voids = first '#' board, teach = level 1 pristine). In `driveToPixelsmithState`: for opener/plugs/voids seed full progress (all levels won) before `startLevel`; for teach `resetSave()` first. Confirm the tutorial-hand trigger in v2 matches v1's gate (fires only on level 1 from pristine save) — if v2's trigger differs, align the seeding so opener suppresses and teach shows the hand.
**Test scenarios:**
- Map equals v1 values exactly (1/8/6/1) — literal assertion against the four keys.
- Level 8 contains a plug cell and level 6 a void cell in the generated level data (guards against the map silently pointing at the wrong boards if levels regenerate).
- Drive seeding: opener/plugs/voids path calls full-progress seeding before start; teach path resets save (harness-level test with stubbed deps if a cheap seam exists).
**Verification:** typecheck/unit/eslint green.

### U3. Truthful win/pause/settings predicates (UI-truth)

**Goal:** `tourstate:win|pause|settings` can only publish when the actual UI is mounted and visible.
**Dependencies:** none (U4 depends on this).
**Files:** `games/marble_run/src/testing/drivePredicates.ts`, `games/marble_run/src/testing/TestHarness.ts` (snapshot fields), `games/marble_run/src/testing/pixelsmithStates.ts`; tests: `games/marble_run/src/testing/drivePredicates.test.ts` (extend/create).
**Approach:** Extend `harnessSnapshot()`/`driveSnapshot()` with UI-truth fields distinguishing modal variants and visibility (element in DOM AND visually shown — check computed/display or `offsetParent`, since a merely-mounted hidden node must not pass): e.g. `settingsVariant: 'menu' | 'ingame' | null` derived from the modal's action rows (`settings-close` vs `settings-restart`/`settings-home`) or a root variant class, and visibility-qualified `levelCompleteOverlayVisible` (currently mere `getElementById !== null`). Rewrite predicates: `win` requires visible `#level-complete-overlay` with the result card mounted; `pause` requires GameScene + visible in-game-variant settings modal (remove `lifecycleSuspended`/`status === 'paused'` as sufficient); Pixelsmith `settings` requires home shell + visible menu-variant (Close) modal; keep shop/home/level-map as-is.
**Test scenarios:**
- win: snapshot with `levelComplete: true` but no visible overlay → false; visible overlay → true.
- pause: `lifecycleSuspended: true` alone → false; GameScene + in-game variant visible → true; menu variant visible during GameScene → false.
- settings: in-game variant open → false; home shell + Close variant open → true; nothing open → false.
- Regression: gameplay predicates still reject win/pause/settings surfaces.
**Verification:** typecheck/unit/eslint green; new predicate tests pass.

### U4. Fix win/pause/settings drives (real UI paths) + modal marker hosting

**Goal:** Drives genuinely produce the states the predicates now demand; settings marker publishes from inside the modal.
**Dependencies:** U2 (seeding helpers), U3 (predicates define the target).
**Files:** `games/marble_run/src/testing/TestHarness.ts`, `games/marble_run/src/menu/settings.ts` and/or the settings modal mount (aria-modal), `games/marble_run/src/ui/LevelCompleteOverlay.ts` (aria-modal if missing); tests: harness-level drive tests where a cheap seam exists, else covered by U3 predicate tests + device run.
**Approach:** Win: seed full progress, start level 1, `setAnimationSpeed(6)` via GameplayController, loop tapping `engine.movableMarbles()[0]` (~140ms cadence, bounded iterations, mirroring v1 `driveTo('win')`) until the level truly completes and the overlay mounts; settle on the U3 predicate. Pause: after settling gameplay, open the in-game settings modal through the HUD settings/pause control (drive the real button; keep `setLifecycleForTest` out of the pause drive). Settings: `gotoHome()` first, then open menu settings via the home gear only (drop `#settings-btn` from the trigger for this path); settle on the U3 menu-variant predicate. Marker: confirm both settings variants and the win overlay set `aria-modal="true"` on the dialog root so testkit's `ensureHostedMarker` re-parents `#__tourstate__` inside; add the attribute where missing.
**Test scenarios:**
- Settings modal roots (both variants) and level-complete overlay carry `aria-modal="true"` when open (DOM test).
- Pause drive does not call lifecycle suspension (if seam-testable cheaply); settings drive goes home before opening.
**Verification:** typecheck/unit/eslint green; note in handoff that the 25s marker deadline with the real win drive (spawn stagger + taps at 6x) is device-verified by the conductor only.

### U5. Win result card art parity

**Goal:** Win overlay visually matches `refs/win.png`: green "LEVEL 1 COMPLETED" ribbon, pale-blue reward card with crown + REWARD + coin `+25`, green Next button.
**Dependencies:** U3/U4 (a truthful win capture is the judge input).
**Files:** `games/marble_run/src/ui/LevelCompleteOverlay.ts`, `games/marble_run/src/ui/styles.css`, `games/marble_run/public/v1/ui/*` (read-only comparison).
**Approach:** Compare the mounted overlay (dev-server + existing assets `ribbonCompleted`, `crown`, `rewardText`) against `refs/win.png`; align colors/sizes/layout tokens and the reward value (+25 for level 1) where they diverge. Check reveal timing vs capture: `LEVEL_COMPLETE_REWARD_REVEAL_DELAY_MS = 4200` — the Pixelsmith settle must only pass once the reward card is revealed, or the delay must be tour-safe; pick the smaller change (predicate includes reward-card visibility, per U3).
**Test scenarios:**
- Overlay mount renders ribbon, crown, reward row with expected coin value, and a Next action (DOM assertions).
**Verification:** typecheck/unit/eslint green; art identity remains conductor-judged on device.

---

## Verification Contract

- `npm run typecheck`, unit tests, `npx eslint .` (marble_run scope) green.
- New unit tests: corrected predicates (UI-truth assertions) and state→level mapping — the card's explicit bar.
- **Device captures remain conductor-judged**; the handoff must state that on-device marker publication (esp. win within the 25s deadline, and settings marker inside the modal) is unverified until the conductor's device run.

## Scope Boundaries

- In: `games/marble_run/**` only.
- Out: `packages/ui`, `packages/testkit` (markerHost already does aria-modal hosting — consume, don't edit), any PRs.
- Deferred: shop-state parity (v1 has no shop; skip stays), any further art tuning after the next judge pass.

## Risks

- **Win drive vs 25s marker deadline**: real completion at 6x speed (spawn stagger + tap cadence) may run long on device. v1 proves the same mechanism fits; if v2 is slower, the bounded tap loop cadence is the tuning knob. Only the conductor's device run proves it.
- **Home decor stage/canvas ownership**: v2's three Stage was ported for GameScene; sharing it with HomeScene may fight scene lifecycle. If reuse is messy, a home-owned stage on the same canvas is acceptable — but no second WebGL context leak.
- **Reward reveal delay (4.2s)** interacts with the tour's stability re-check; if the capture fires between ribbon and reward reveal, v2 diverges from ref. U3's predicate including reward-card visibility closes this deterministically.

## Definition of Done

All five units landed on branch `trello-xHpTSmuI-mrv2-8-device-parity-wave-2-home-board-p`; typecheck/unit/eslint green including the new predicate + mapping tests; handoff states device parity and marker timing are unverified pending the conductor's device capture run.
