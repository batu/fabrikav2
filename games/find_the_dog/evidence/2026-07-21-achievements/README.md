# ACH-2 physical-device evidence — 2026-07-21

Genuine on-device proof of the Find the Dog achievement system (TWF card
`gdUIHVjO`), captured on a physical iPhone 12.

## Provenance

- Branch: `trello-gdUIHVjO-ftd-ach-2-achievement-collection-unlock` (evidence
  captured at the commit that introduces the unlock toast + device-input
  harness fixes; base implementation `9380f7bd`).
- Device: physical iPhone 12, iOS 18.7.8, UDID `00008101-000410EC3EF9001E`.
- Bundle id: `com.baseardahan.hiddenobj`, signing team `42L77JAX72`, Debug
  configuration, `vite build --mode ios`.
- Raw result bundles (not committed; large): `games/find_the_dog/.work/collectRun/`
  `proof15.xcresult`, `proof16.xcresult`, `proof17.xcresult`, `persist1.xcresult`.

## What each capture shows

1. `01-home-achievements-entry.png` — Home with the Achievements entry
   (one-line label fix visible).
2. `02-collection-states.png` — achievements collection on device with the
   deterministic seeded set (11 cards): Completed / In progress / Locked plus
   reward states (`Reward collected`, `Reward in progress`, `Reward locked`).
   Confirmed by harness marker `proof1: ok=true achOpen=true cards=11`.
3. `03-unlock-callout-and-toast.png` — the REAL unlock moment: level 1 won
   through the genuine completion path (all 26 dogs found via dispatched
   touch input), showing simultaneously the in-app unlock toast (top) and the
   completion-card callout ("Achievement unlocked — First Find and 1 more").
   Confirmed by `proof2: ok=true callout=true toast=true found=26/26
   complete=true` — the callout/toast come from the real achievement reducer
   (`AchievementSystem.apply` → `CommittedAchievementDelta.newlyUnlocked`),
   not a mocked overlay.
4. `04-unlock-callout-settled.png` — the same callout after confetti settles,
   fully readable.
5. `05-relaunch-home-no-replay.png` — a clean production build (no test
   harness, no tour/proof scripting in `index.html`) installed OVER the proof
   build without uninstalling, relaunched: Home shows, and the XCUITest
   asserted no "Achievement unlocked" callout/toast replays.
6. `06-persisted-collection-after-clean-update.png` — the collection opened
   through the real Home button on that clean build: `First Find — Completed,
   Reward collected` persisted, with real progress (Getting Warmer 2/10,
   Seasoned Seeker 2/25) from the actual wins. Persistence lives in the
   `ftd_achievements` localStorage journal; `processedOccurrenceIds` dedupe
   prevents replay.
- `proof-markers.txt` — the raw gated markers extracted from the xcresults.

## How it was captured

Screenshots were taken by a temporary XCUITest in the committed
`tools/verify-device/runner` project, gated on accessibility markers that the
in-page proof script published only after the harness snapshot confirmed each
state (`achievementsOpen`/`achievementCardCount`, then
`achievementCalloutVisible` after `driveTo('win-achievement')` — seed empty
journal, real `startLevel(1)`, real dog taps, real completion commit). The
proof script lived only in the generated `dist/index.html` (never in tracked
source) and the temporary Swift tests were removed before the final commit.

Build commands (proof build):

```sh
VITE_ENABLE_TEST_HARNESS=true npx vite build --mode ios   # + proof script injected into generated dist/index.html
npx cap sync ios && node ../../tools/native-shell/apply.mjs --game find_the_dog
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination id=00008101-000410EC3EF9001E -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=42L77JAX72 build
xcrun devicectl device install app --device <udid> <App.app>
# temporary ProofTests XCUITest run from tools/verify-device/runner
```

The clean persistence build was identical but WITHOUT
`VITE_ENABLE_TEST_HARNESS` and without any injected script. For proof builds,
generated `dist/levels` was pruned to the first three bundled levels (the full
set is ~5 GB); `public/levels` was never touched.

## Known limitation: the generic in-situ tour

The standard `verify-device` allstates tour is NOT reliable for these custom
achievement states on device: the Swift runner's canonical state list plus
marker-propagation latency and per-state timeouts caused missed/late captures
even after the underlying input bugs were fixed. The dedicated gated proof
flow above is the reliable lane. (Root causes fixed along the way, now on this
branch: `VITE_INSITU_TOUR` was never in the game's vite `envPrefix` allowlist
so the tour flag could not reach a device bundle; synthetic taps dispatched
only pointer events which Phaser never listens to — the testkit input driver
now dispatches touch/mouse pairs with full page coordinates; single-shot
clicks raced the scene-transition cover — the harness now hit-test-polls
before clicking; and the first-run tutorial gate swallowed harness taps —
tour drives now disable it like the browser flows do.)
