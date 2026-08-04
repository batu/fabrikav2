---
status: partial
subject: Find the Bird achievement reward flights
created: 2026-08-04
mode: pipeline
---

# Evidence: Find the Bird achievement reward flights

## Verdict

Browser gameplay evidence confirms coin and hint rewards fly from icon-bearing claim buttons into the visible Achievements counters and settle into the claimed state; physical-device animation evidence is unavailable because no device is currently connected.

## What Changed

- Added live coin and hint balances to the Achievements header.
- Added matching reward icons to achievement claim buttons.
- Reused the established curved economy-transfer animation for coin and hint claims.
- Preserved scroll position by updating only the claimed card after settlement.
- Added retry-safe UI handling for recovered and persistently failed settlements.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| video | `assets/coin-claim.mp4` | passed: 25 coins fly into the visible coin counter, which reaches 25 |
| video | `assets/hint-claim.mp4` | passed: 60 coins and 2 hints split toward their visible counters, reaching 60 and 5 |
| test | `npm run test:unit` | passed: 42 files, 277 tests |
| typecheck | `npm run typecheck` | passed |
| build | `npm run build` | passed with existing chunk-size/import warnings |
| lint | changed-file `npx eslint ...` | passed |
| device | `adb devices -l`; `xcrun devicectl list devices` | blocked: no Android device and listed iPhone unavailable |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| correctness | passed after fix | checkpoint recovery now updates the card and counters |
| reliability | passed after fix | explicit visible targets and bounded persistence retry |
| adversarial | passed after fix | rapid taps, page close, reduced motion, and simultaneous rewards covered |

## Analysis

The current browser-harness build was recorded at 390 × 844 with normal motion. Contact sheets were inspected at four frames per second, including the transient flight and settled state. The first capture was superseded after review found global target lookup could select obscured Home counters; the final videos use explicit Achievements-header targets. Physical-device capture could not run because the local iPhone is unavailable and no Android device is attached.

## Gaps

- Physical iOS or Android timing, compositing, and touch acceptance remain unverified.
- Repository-wide lint remains blocked by 10 pre-existing errors in untouched files; changed-file lint passes.

## Next Action

Connect a physical iPhone or Android device and record both claim flows through the canonical verify-device lane.
