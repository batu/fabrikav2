# Ads, achievements, HUD, audio execution evidence

Base: `d99607643`. Branch: `fix/ftb-ads-achievements-hud-audio`.
Brief: original checkout `docs/handoffs/2026-09-14-ftb-ads-achievements-hud-audio.md`.

## Checklist

- [ ] First-session automatic ads: fresh launch, resume, subsequent launch; preserve rewarded policy.
- [ ] Banner observations: levels 34, 42, 43 individually assessed against current policy and device.
- [ ] Streak indicator: reproduce inherited minimum width and correct only the indicator.
- [ ] Achievements: profile opening/claiming, consecutive unlocks, navigation; preserve rewards and saves.
- [ ] Audio: shuffled bag, boundary repeat avoidance, independent 0.8–1.2 rates, load failures, mute/ad resume; audible device evidence.
- [ ] Review, targeted checks, installed-build identity, remaining uncertainty.

## Baseline

79 tests passed in the original checkout across session ads, between-level analytics,
achievement claiming/persistence, toast, and daily streak suites. No device claim.
The physical iPhone was initially leased by `ftb-onboarding-layer`. After that
holder exited, this session acquired the lease and collected baseline evidence.
Further phone testing is now paused at the user's request; local work continues.

## Workspace preparation

User approved disk reclamation after the worktree minimum-space refusal. `df -h /`
rose from 19 GiB to 32 GiB before creation. Removed inactive generated data only:

- `~/Library/Developer/Xcode/iOS DeviceSupport/iPhone13,2 26.6 (23G71)` (phone is now 26.6.1/23G83).
- `~/Library/Developer/XcodeBuildMCP/workspaces/appletolye-03c1495e5719/DerivedData`.
- `~/Library/Developer/Xcode/DerivedData`, `~/Library/Caches/org.swift.swiftpm`.
- `~/Library/Caches/UnityHub`, `~/Library/Caches/unityhub-updater`, `~/Library/Caches/phaser-editor-desktop-updates`.
- `~/.npm/_npx`.

Each path's inode and open files were rechecked immediately before removal.
Active uv cache and Unity updater, Agency build outputs, worktrees, source, and
existing evidence were retained. Used Agency `bird` profile for this checkout.

## Audio regression evidence

`tests/unit/pickup-audio.test.ts` exercises the exported `playFind`/preload path
with stubbed Web Audio and fetch, rather than a separate shuffle implementation.
Before implementation: 5 failures, 1 pass. Constant RNG selected only one sample
per ten plays; subsequent preloads did not yield unique samples; rate/selection
draws remained coupled per pickup; one missing asset rejected the whole preload.
After implementation: all 6 tests pass. Three full bags have no repeats within a
bag or across boundaries; per-play rates cover 0.8 and just below 1.2 and allow
equal independent draws. Zero/one-sample and retry paths pass. Mute and nested ad
master-gain routing are preserved. These are code-level results, not audible proof.

Full suite after audio change: 79 files, 500 passed, 3 skipped. Typecheck and lint
passed after materializing the existing `games/shared` dependency omitted by the
Agency bird profile. No shared renderer changes.

## Streak indicator

The count-label selector `#home-shell .home-balance-pill span` imposes
`min-width: 2ch` on the absolutely positioned claim dot as well. Its own `width:
14px` does not override that minimum. The scoped dot now sets `min-width: 0`.
Physical before/after measurements and captures are still pending. The initial
native build was started before this CSS correction, so it retains the baseline.

## Achievement presentation

Added two regressions to the existing collection UI suite and observed both fail
before changing behavior (9 existing passed). A settled first-tier claim did not
expose the second earned tier until reopening. A 120px downward gesture inside
the scrollable body triggered the page dismissal handler; Shop already guarded
this interaction. The fix refreshes only the claimed ladder using the same row
renderer, preserves the body and its scroll, and does not allocate page-view
events on refresh. The existing reward settlement, retry, persistence, and
idempotency implementation is unchanged. Achievement body scroll now receives
the same dismissal guard as Shop; the header can still dismiss the page.

After correction: 48 targeted collection/claim/persistence tests passed;
typecheck and lint passed. Simplification reviews: reuse had no findings;
quality and efficiency identified the same full-page refresh design concern.
One shared category renderer addressed both without changing page-open analytics.
The 17 pickup/collection tests, typecheck, and lint passed after that change.
This establishes concrete presentation defects, not the cause of reported lag.

## Native baseline build

Canonical native-shell build succeeded using team `42L77JAX72` and the isolated
checkout's generated project. App output:
`~/.local/share/agency/build-outputs/2071f226751e2447/find_the_bird-ios-debug-q4psu_pu/DerivedData/Build/Products/Debug-iphoneos/App.app`.
This bundle has the audio correction and baseline UI. Build env explicitly sets
`VITE_ENABLE_TEST_HARNESS=true`, `VITE_ADMOB_IOS_TEST_MODE=true`, and a test-device
identifier. The installed native AdMob adapter's `getAdId` substitutes Google's
test IDs when `isTesting` is true. The baseline was installed and launched;
the diagnostic build marker was read back through the existing native relay.
No production mutation, deployment, upload, PR, or merge has occurred.

## Partial physical audio evidence

On the physical iPhone 12 (iOS 26.6.1), the existing gameplay harness completed
19 actual pickup paths in Hawaii. A diagnostic observer in the local signed
bundle recorded the selected decoded sample and source playback rate without
drawing additional random values. The first ten samples were
`7, 5, 8, 2, 9, 10, 3, 1, 6, 4`; the next sample was `7`, so the observed bag
boundary did not repeat. All 19 rates were within 0.8–1.2 (observed
0.802050–1.188259). The audio context remained running and master gain was 1.

- [Per-play observations](assets/pickup-audio-metadata.json).
- [Physical Web Audio master output](assets/pickup-master-output.m4a): 14.49 seconds,
  stereo AAC at 48 kHz, captured from the game's master output on the device.

This recording is not a microphone recording of the phone speaker. It has been
checked for valid audio encoding; listening acceptance remains pending. Native
screenshots were captured during pickups, and a frame showing 10/19 was inspected.
The screenshot cadence is insufficient to establish smooth animation. Cross-level
bag continuity, device mute/ad resume, and the remaining UI/ad acceptance are open.

Before testing, the original app Library and all 34 localStorage keys were backed
up privately. Test save changes are currently active. Restore and verify the
original save before handing the device back as complete; never commit raw saves.

## Final local checks

After all code changes, the full unit suite passed: **502 passed, 3 skipped**
across 79 files. Typecheck, lint, and `git diff --check` passed. The final iOS web
bundle, native synchronization, and final native compilation passed. Final app:
`~/.local/share/agency/build-outputs/2071f226751e2447/find_the_bird-ios-debug-g1x5vgov/DerivedData/Build/Products/Debug-iphoneos/App.app`.
This candidate includes all four source fixes. It has not been installed;
phone work remains paused. The earlier diagnostic baseline remains installed.

## Correctness review

Independent correctness/adversarial review found no concrete code defects in
the six changed code/test files. Its verdict is **not ready** because native
ad, streak geometry, achievement motion, and audible playback acceptance are
pending. Review artifact: `/tmp/compound-engineering/ce-code-review/ftb-correctness-20260914/review.json`.
Follow-up review closed the asynchronous coverage gap with deferred animation
promises: two category claims settle out of order, both with the page open and
after closing/reopening. Repeated taps grant only once, the unrelated ladder
retains its DOM while its animation is pending, and old-page completion does not
replace the reopened page. All 13 collection UI tests pass; typecheck and lint
pass. This follow-up changed tests only, so the final native build remains current.
Partial sample-load success intentionally retains the surviving sounds
for this launch; an entirely failed load retries on a later pickup/preload.
