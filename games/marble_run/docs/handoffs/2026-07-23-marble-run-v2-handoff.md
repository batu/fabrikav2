# Marble Run v2 — Handoff (2026-07-23, rev 2)

For the incoming agent. The previous session (mine) fixed many things but repeatedly made one structural mistake you must not repeat. Read this whole doc before touching code.

## The one lesson that governs everything

**Every major failure of the previous session came from building parallel bespoke systems beside existing correct ones.** The shell transition was rewritten three times instead of asking why shell_template's works; kit theming was bypassed with piles of game-local CSS; the repo's `verify-device` lane was ignored in favor of hand-rolled capture scripts that produced false evidence (stale builds were judged and reported as fixed).

Your operating rule: **if a working implementation exists in the repo (shell_template, find_the_dog, the ui kit, verify-device), you either use it unchanged or fix it upstream. A marble_run-local parallel version is a defect.** Prefer deleting code over adding it.

## Your mission (in order)

### 1. Fix the menu→game transition by SUBTRACTION (P0, open)
- Symptom today (Batu, on device): during the fade "the saga moves up". Earlier variants: board vanishing, elements snapping, empty cover on iOS. Three bespoke mechanisms were tried (commits `d65270b7`, `080f8ab9`, `503c6108`) — all wrong approach.
- **The correct approach: `games/shell_template` (and find_the_dog) run this exact transition correctly with the STOCK mechanism.** Do not modify the transition again. Instead:
  1. Diff marble_run's home structure/CSS against shell_template's (`src/scenes/HomeScene.ts`, `src/menu/HomeBoardPreview.ts`, `src/ui/SceneTransitionCover.ts`, transition/home sections of `src/ui/styles.css`, `design/theme.ts` vs the template's equivalents).
  2. **Delete marble_run's transition-specific code and CSS** (the play-entry customizations, preserved-canvas plumbing, lift/fade special cases) so the stock shell flow runs unmodified.
  3. Make the home STRUCTURE conform to the template's layout contract: the WebGL board preview must live inside the shell's layout system (not a full-viewport sibling that reflows siblings when it mounts/unmounts), saga on stock SagaMap geometry. Reskin only through kit theme tokens/props.
- Definition of fixed: menu fades as one static composition (board included), nothing moves/scales/vanishes, on BOTH Android WebView and WKWebView (previous fix worked on Android only — engines differ; verify both).

### 2. Reduce the game-local override pile (P1, prevents regressions)
`games/marble_run/src/ui/styles.css` + `design/theme.ts` accumulated overrides across six parity cards (win/modal/settings/z-index/width pins). These collide — the win screen regressed repeatedly because of it. For each override: map it to a kit theme token (keep as a token value), or move the capability upstream into `packages/ui` (separate card — kit changes affect all games), or delete it. Shrinking these files is success; growing them is failure.

### 3. Win screen (P0 report, unreproduced)
Batu says the win layout regressed; headless captures match v1 geometry. Reproduce ON THE PIXEL first (v1-vs-v2 same-device comparison; see evidence lanes below). If it doesn't reproduce, get his exact complaint/photo before changing anything. Suspect the override pile from item 2.

## Devices & verification (use existing lanes — do not hand-roll)

- **Primary device: Pixel 6a, serial `27091JEGR22183`.** Build/verify there first. iPhone 12 (`2D894791-A5A3-58BE-9C88-AE0AF08B8C09`) is the confirmation surface — WKWebView must pass too.
- **Use `npm run verify-device -- --game marble_run`** for device visual verification. It is the FTD-proven marker-gated lane. Do NOT write custom adb/CDP/screenshot loops — the previous session's hand-rolled loops produced false evidence (silent gradle failures + stale APKs judged as current).
- If you must capture manually, first ASSERT BUILD IDENTITY: the `index-*.js` hash in `dist/index.html` must match what the device serves (previous session lost hours to judging stale builds).
- v1/v2 share the bundle id with DIFFERENT debug signatures — uninstall before switching. `adb shell cmd statusbar collapse` before captures.
- Tour states for driving screens: `VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=<state> npm run build` (states: home-fresh, level-map, gameplay-{opener,plugs,voids,teach}, win, pause, settings). Production builds strip the harness without the flag.
- iOS: signing works WITHOUT an Apple account via the cached wildcard team profile — do NOT pass `-allowProvisioningUpdates`. StoreKit.framework and three orphan native plugins (AppLovinMax/AppsFlyer/MetaEvents) were stripped from the generated ios project; `npx cap sync ios` or regenerating `ios/` can resurrect build breakage. Icon overlay: `node tools/marble-run/sync-native-resources.mjs <ios|android>` (arg required).
- iPhone screenshots: `sudo /Users/base/.local/bin/pymobiledevice3 remote tunneld` once, then `pymobiledevice3 developer dvt screenshot out.png` (~1s each — too slow for transitions; use recordings or Batu's eyes for motion).

## Evaluation contract (how "done" is judged)

- **Static states**: capture v1 and v2 on the SAME Pixel (marker-gated) for home, gameplay-opener, win, fail, settings; run `pixelsmith judge --capture <v2> --reference <v1>` per pair (pixelsmith CLI: `cd /Users/base/dev/appletolye/pixelsmith && uv run pixelsmith ...`). Gate: zero blocker-severity findings per pair.
- **Motion (the transition)**: Pixelsmith judges stills only — motion needs recordings. `adb shell screenrecord` menu→game on v1 and v2, extract 8fps frames; (a) judge time-matched midpoint frame pairs, (b) pixel-diff v2's last pre-fade frame vs fade-midpoint frame: zero element displacement. Repeat on iPhone (recording or hand-test). **A stills-only pass does NOT count for anything animated** — this exact mistake caused most of the previous session's false "done"s.
- **Terminal gate**: fresh install on the Pixel; Batu plays menu→level→win→fail→settings. His sign-off closes the work. Never self-declare done — the only status vocabulary is "landed, awaiting device proof" and "device-proven".

## Verified-good state (do not re-break; re-verify after your changes)

110-level set (no orphan gates, bimodal symmetry, teach spotlights); FredokaOne font everywhere; banner title size+shadow; turning board behind banner; centered saga, gold sun node, inset LEVEL button, confetti; app icon on both platforms; tutorial = light spotlight + ring + 👆 emoji hand + solid route line (v1 uses the emoji — there is no hand raster); fail screen = single FAILED ribbon + LEVEL eyebrow + WATCH AD/RETRY stacked, no coin-spend button; win = centered card, compact Next at v1 geometry, coin-fly with +25→0 countdown; settings/pause = purple scrim, CLOSE inside card, square X, caps RESTART/HOME, cream knobs; NO consent dialog, NO notifications prompt, NO shop/IAP surfaces anywhere.

## References & evidence
- Canonical v1: `fabrika/games/marble_run/sugar3d` (menu camera yaw 90; `ui/dom.ts` tutorial/coin-fly; `ui/style.css`).
- Delta map + image pairs: `games/marble_run/docs/evidence/2026-07-23-delta-map/index.html`.
- Same-device v1 Pixel references: session scratchpad `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/pixelcmp/v1/` (regenerable via the tour builds if the scratchpad is gone).
- Harness global: `__FIND_DOG_HARNESS__` (`startLevel/failLevel/winLevel/driveTo/snapshot`) — rename to `__MARBLE_RUN_HARNESS__` was carded but verify what shipped.

## Pipeline notes
- twf board `scratch-2` (fabrikav2); MRV2-1..31 merged. Bounded style: conductor spawns, one stage per worker, no `TWF_AGENT` (config routes codex/sol@low), sparse worktrees, `--fix-dirty` for lockfile-dirty landings.
- Shared main checkout: other sessions grab branches / drop untracked files; hold strays aside when landing, restore after.
- sol@low plan-stage workers often exit without committing the plan file — commit it for them before respawning, or the next spawn refuses the dirty worktree.
- Worker sandboxes have no browser/xcodebuild/device access — the conductor owns those proofs post-land; say so on every card so workers don't park.
- Generated `android/`/`ios/` exist only in the main checkout, not card worktrees.

## Untouched debts (not yours unless asked)
Monetization config dead by design (FTD AppLovin IDs are placeholders; Marble Run Keymaster row needed before ad builds); legal/store URLs unverified; debug-signed builds only; win reward pinned to 25 via config.
