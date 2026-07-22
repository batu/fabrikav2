---
title: "fix: MRV2-12 pause drive — in-game settings modal never opens (driveTo routing sends 'pause' to the lifecycle-suspend lane)"
date: 2026-07-22
type: fix
origin: trello-card-o0iAlRte (card description; no brainstorm doc)
trello: https://trello.com/c/o0iAlRte
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-12 pause drive — in-game settings modal never opens

## Summary — root cause PROVEN during planning (headless repro + stack trace)

The in-game open path itself is **healthy**. The HUD gear (`[data-a="settings"]`, `gameplay/hud.ts:33`) is mounted, visible, and wins the hit-test at its centre; its click chain (`GameHud.onSettings` → `GameplayHooks.openSettings` → `GameScene.openInGameSettings` → `mountSettings({ inGame:true })`, `GameScene.ts:275,286-307`) mounts the Restart/Home card into `#modal-root` when invoked. None of the card's candidate suspects (missing gear, unmounted controller, hidden tap target) is the defect.

The defect is a **drive-routing bug in `TestHarness.ts`**. `harness.driveTo` (line ~755) routes to the pixelsmith drive only when `isPixelsmithState(state) && !isDriveState(state)`. But `'pause'` (also `'win'`, `'settings'`) is in BOTH vocabularies (`DRIVE_STATES`, `packages/testkit/src/testing/driveTo.ts:1`; `PIXELSMITH_TOUR_STATES`, `pixelsmithStates.ts:12`), so the guard is false and `'pause'` falls into the **generic testkit `driveTo` lane**, whose `pause` dep is `pauseGame()` = `setLifecycleForTest('inactive')` = lifecycle suspend (`TestHarness.ts:554-561, 612`). That suspends the rAF loop and pauses the controller, but never taps the gear — so `#modal-root` stays empty, and the UI-truth pause predicate (`GameScene` + `settingsVariant === 'ingame'`, `drivePredicates.ts:76-80`) can never pass. Result: `driveTo(pause) timed out after 20000ms`, `state=pause-FAILED scene=GameScene`, exactly the card's symptom. `drivePauseViaUi` (the correct UI drive, `TestHarness.ts:476-506`) was **dead code for the tour** — `driveToPixelsmithState`'s `'pause'`/`'win'`/`'settings'` branches are only reachable for states that are NOT DriveStates, i.e. never for these three.

Evidence captured during planning (headless, per the card's repro at 390×844):

- Failing run: `window.__mrLastDriveClick` shows the ONLY drive click ever made was `startLevel`'s level-map tap — the gear was never tapped; snapshot at failure: `lifecycleSuspended: true, status: 'paused', settingsVariant: null`.
- Stack trace (wrapping `game.loop.sleep`): suspend originates from `Object.pause` (TestHarness `pauseGame`) called by the **testkit generic `driveTo`** — proof of the routing.
- One-line spike (`isPixelsmithState(state) && !isDriveState(state)` → `isPixelsmithState(state)`) rebuilt and re-run: gear tap lands (`landed: true, hitTarget: …[data-a=settings]`), `#modal-root` contains the `fab-modal-card marble-settings-card` dialog, tour logs `state=pause` → `state=pause-DONE scene=GameScene`. The spike was reverted; the branch carries only this plan.

Scope fence: `games/marble_run/**` only, no `packages/ui` edits, no PRs.

## Key Technical Decisions

- **KTD1: Fix the routing, not the drive.** In `harness.driveTo` (`TestHarness.ts:756`), drop the `&& !isDriveState(state)` clause so every pixelsmith-vocabulary state routes to `driveToPixelsmithState`. This is the smallest source-level fix and it aligns predicate with drive for all three overlapping states: the UI-truth predicates (`pause` needs the in-game modal, `settings` needs home + menu modal, `win` needs the settled overlay) are only satisfiable by the pixelsmith drives, never by the generic lane's lifecycle-suspend/`winLevel()` shortcuts.
- **KTD2: Kill the recursion trap in `driveToPixelsmithState`'s fallback.** Line ~433 `return harness.driveTo(state)` was the old escape for overlapping states; after KTD1 it would be infinite mutual recursion if ever reached. The switch explicitly handles all ten pixelsmith states, so replace the fallback with the direct generic call (`driveTo(driveDeps(), state as DriveState, …)`) or an explicit `return false` — do not leave a `harness.driveTo(state)` self-call.
- **KTD3: Behavior change for `'win'`/`'settings'` routing is intended, but must be re-verified.** After KTD1, `VITE_INSITU_TOUR=win` uses `driveWinViaPlay` (real 6x play, no `scene.winLevel()` shortcut) and `VITE_INSITU_TOUR=settings` uses `driveMenuSettingsViaUi` — the drives the wave-3/4 comments already claim are in use. Verify both headlessly (same repro recipe, ~25s budget vs the 20s tour drive timeout; if `driveWinViaPlay` cannot finish level 1 at 6x within 20s headlessly, flag it — do NOT silently re-shortcut).
- **KTD4: Default six-state tour keeps working.** The no-`VITE_INSITU_TOUR` walk drives `menu/level/settings/pause/win/fail` via the same `harness.driveTo`, so `settings`/`pause`/`win` also reroute there. Its per-state matcher is `snapshotMatchesMarbleRunDriveState`, whose `pause`/`settings` predicates equally require the mounted modal — the reroute is a fix for that lane too, not a regression. Sanity-check via unit tests, not a full headless walk.

## Implementation Steps

1. `games/marble_run/src/testing/TestHarness.ts` — apply KTD1 (guard) + KTD2 (fallback). Remove the now-unused `isDriveState` import only if nothing else uses it (`gotoState` at ~701 still does — keep it).
2. Unit tests (extend `games/marble_run/tests/unit/` — `drive-to.test.ts` / `pixelsmith-tour.test.ts` neighborhood, jsdom like existing harness tests):
   - Routing test: `harness.driveTo('pause')` must invoke the UI drive, not lifecycle suspend — assert `isGameSuspended()` stays false during the drive attempt and/or that a mounted gear receives the click (existing tests show how the harness is stood up against a stub DOM).
   - In-game open path test (card acceptance): drive/click the HUD gear (or call the settings-open seam) and assert `#modal-root` contains the settings card with the Restart (`[data-fab-action="settings-restart"]`) and Home (`[data-fab-action="settings-home"]`) rows, and `detectSettingsVariant()`/snapshot `settingsVariant` reads `'ingame'`.
3. Verification (all runnable by the worker, no device needed):
   - Card repro: `cd games/marble_run && VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=pause npm run build`, serve **that** `dist`, playwright chromium 390×844 — expect the `tourstate:pause` marker and `#modal-root` containing the Restart/Home settings card. (Note: after the dwell the marker advances to `tourstate:done`; assert `pause` was published — poll for it or check at ~22s as the card says, don't assert the final value only.)
   - Same recipe for `VITE_INSITU_TOUR=win` and `=settings` (KTD3).
   - `npm run typecheck`, unit suite, `npx eslint .` (marble_run scope) — green.

## Risks / Notes

- **Stale-server trap (cost ~30 min during planning):** a leftover `python3 -m http.server 8902` from the sibling `fabrikav2` checkout was serving a different `dist`; every rebuild looked like a no-op. Kill port 8902 / verify the served asset hashes match the freshly built `dist/index.html` before trusting a headless run.
- Root `npm ci` must run at the **workspace root** (worktree fresh-clone quirk); `npm run build` inside `games/marble_run` fails with `vite: command not found` otherwise.
- Device capture remains the conductor's lane; this card's acceptance is explicitly headless. The fix removes a false-negative in the drive tooling — on-device pause capture still needs the usual verify-device pass at conductor level.
