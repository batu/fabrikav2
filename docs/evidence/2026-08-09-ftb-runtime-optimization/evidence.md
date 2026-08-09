---
status: partial
subject: Find the Bird runtime optimization and completion-effect performance
created: 2026-08-09
mode: pipeline
---

# Evidence: Find the Bird runtime optimization

## Verdict

The retained runtime is measurably faster, passes browser correctness gates and the physical iPhone acceptance tour, and preserves the expected visual states; evidence remains partial because direct physical pickup motion and the reduced completion animation were not recorded as device video.

## What Changed

- Moved noncritical home art outside the play-entry critical path and prewarmed the current level in the first cancellable idle window.
- Reduced the ready-board cover choreography, retained safe bundled level data, and shared concurrent level-index resolution.
- Hardened visibility scheduling, resource ownership, manifest retry behavior, and fail-soft narrow level persistence.
- Removed a per-frame camera object allocation and reduced completion confetti from 1,080 to 360 pieces after a three-candidate benchmark.
- Corrected the canonical iOS verifier to use native build mode, initialize an absent ignored iOS shell, and exercise deterministic win and fail states.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| benchmark | `.context/compound-engineering/ce-optimize/ftb-game-runtime/experiment-log.yaml` | Five-run median composite improved from 5,897.42 ms to 3,865.57 ms (-34.45%); all correctness gates passed. |
| completion benchmark | `post_plateau_completion_experiments` in the experiment log | 360 pieces held 16.8 ms p95 and 50 ms maximum frame gaps in all three runs; denser 480- and 600-piece candidates had worse maximums. |
| browser recording | `assets/browser-play-pickup.webm` | Play entry, board readiness, pickup feedback, and counter advancement captured. |
| browser recording | `assets/confetti-360.webm` | Reduced celebration remained dense; 111 consecutive sampled frames had no gap above the recording's 40 ms cadence. |
| browser screenshots | `assets/browser-contact-sheet.jpg`, `assets/browser-transition-sheet.png`, `assets/confetti-360.png` | Home, transition, board, pickup, and completion states inspected. |
| source checks | typecheck, lint, focused harness/completion tests | Passed; 22 focused tests passed after the completion change. |
| broad tests | unit suite excluding known stale catalog-byte assertion | 315 tests passed across 54 files. |
| code review | `/tmp/compound-engineering/ce-code-review/20260809-023232-d67faea5/report.md` | No open actionable findings after review fixes. |
| iPhone build and tour | `DEVELOPMENT_TEAM=42L77JAX72 npm run verify-device -- --game find_the_bird --platform ios --device 00008101-000410EC3EF9001E --out /tmp/ftb-runtime-device-verify-360 --date 2026-08-09 --skip-panel` | Build, install, and XCUITest passed 1/1 on iPhone 12 / iOS 26.5.2 at commit `3042d5cf4`. |
| physical captures | `assets/device/menu.png`, `level.png`, `settings.png`, `pause.png`, `win.png`, `fail.png` | All six marker-gated states captured and visually inspected; Classic is the default pickup style. |
| physical summary | `assets/device/summary.json` | Correct 390x844 CSS viewport, 3x backing canvas, and safe-area metrics recorded for every captured state. |
| final launch | `xcrun devicectl device process launch --device 00008101-000410EC3EF9001E --terminate-existing com.basegamelab.findthebird` | Final installed app relaunched successfully. |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| game-feel review | partial | Browser pickup increments immediately and physical play entry, settings, and completion states read correctly; direct physical pickup input, audio, and haptic timing were not recorded. |
| motion/visual review | partial | The earlier completion-stall finding is closed in the 360-piece browser recording; a physical-device recording of that exact animation remains absent. |

## Analysis

The primary Chromium profile is deterministic and fixture-locked (`89cc40611e2e209c743fc49b1c1e02a9f61c06ce5bf88c164d41699a2b3a3ab0`). It measures home readiness, first-level readiness, three cached scene cycles, pickup postconditions, request failures, page errors, texture ownership, heap growth, and bundle size. The final five-run median reduced first-level readiness by 37.9%, cached-cycle median by 38.2%, network requests by 16.3%, transferred bytes by 12.7%, and heap growth by 48.1%, while JavaScript grew only 549 bytes.

The physical tour proves that the exact retained commit builds, installs, launches, handles lifecycle suspension, and renders menu, gameplay, settings, win, and fail states on the connected phone. Its phash verdict is exploratory because no trusted visual references are configured; therefore it is not claimed as automated visual-fidelity proof. The screenshots were inspected manually and found coherent.

The full unit command still encounters one pre-existing assertion in `five-square-campaign.test.ts`: expected bundled `level.json` byte size 9,629, actual 9,628. The same mismatch exists on the base commit, so shipped content was not rewritten to satisfy a stale size assertion.

## Gaps

- No physical-device video proves the exact pickup animation, haptic timing, or 360-piece completion motion.
- The device verifier has no trusted phash reference set, so its six successful captures are exploratory rather than automated visual-diff passes.
- Live CDN behavior is covered by ownership tests and successful device loading, but provider/network failure modes were not induced on the phone.

## Next Action

Record one short physical-device sequence containing a bird pickup and level completion, then review consecutive frames and promote this artifact to `passed` if motion and feedback remain correct.
