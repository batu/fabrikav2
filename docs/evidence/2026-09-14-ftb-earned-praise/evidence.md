---
status: passed
subject: Find the Bird earned praise and screen anchoring
created: 2026-09-15
mode: pipeline
---

# Earned pickup praise

## Verdict

Physical iPhone captures confirm ordinary-find silence, hard-find praise, three-find combos, a single combined celebration, and screen anchoring during an actual drag.

## Behavior

- Reviewed difficulty at least 3.5/5, capped at the hardest fifth of a scene, earns `Good!`. Exact loaded JSON/artwork hashes must match the review. Two birds in the current waterfall qualify; unreviewed scenes receive no hard-find praise.
- Three unassisted finds, each within four seconds of the previous, earn `Combo!`. A hard third find earns one `Incredible!` instead. Each celebration closes its three-find group.
- Tutorial finds, hinted targets, valid misses, and background suspension break the chain. Hinted identities remain ineligible after circle dismissal until the next attempt.
- The existing fixed-position 1.3-second overlay remains outside the camera. Chirps, reveal effects, wallet, scoring, and progression behavior are unchanged.

## Direct evidence

Physical iPhone 12, iOS 26.6.1; dedicated `com.basegamelab.findthebird.onboardingfresh` QA app. Existing native shell reused with rebuilt web resources and verified signing. Ordinary player identity was kept separate from all QA finds and hint spending.

Evidence root: `/Users/base/store-review/find-games/ftb-earned-praise-20260915/`.

- `events-verified.json` and `frames-verified/`: ordinary pickup has no praise; hard pickup shows Good; left `229.53869px` and top `228.169643px` stay fixed while camera scroll changes 681→881. Three later ordinary finds produce one Combo, then cleanup. Frames 005, 009–011, 024–026 inspected. DVT capture is approximately 2.5 fps, used for layout/anchor proof, not a frame-rate claim.
- `hint-events.json`: real hint selected hard `dog_11`. Another find dismissed its circle; finding `dog_11` remained quiet. Two later ordinary finds remained quiet; the third produced Combo. Wallet hint count changed once, 1→0, for the hint request.
- `physical-input.xcresult`: `testEarnedPraiseWithPhysicalInput` passes. Three actual taps on two ordinary birds and the hard rock-hidden bird reach 3/19; an actual drag follows.
- `native-captures/8D79AE5A-A484-4EBC-B48C-C4E4EC794BA6.mp4`: continuous 5.342-second native recording, 1170×2532, approximately 29.58 fps. Consecutive samples 025–036 show one Incredible, world movement beneath it, and cleanup. The share copy is `praise.mp4`, 720px wide, same source timing, no audio.
- `start.json`: current served waterfall JSON/artwork identities match the reviewed ledger.
- Ordinary `com.basegamelab.findthebird` app rebuilt without the test harness/relay, signature verified, installed at `4490963E-C942-4638-AB3B-567AFD229B0D/App.app`, launched, and its home screen inspected (`ordinary-installed.png`). Existing native shell reused because all production changes are web resources. `save-comparison.json` preserves all 35 keys: progress/wallet unchanged; only three analytics entries, notification launch count, and the midnight hint-date marker changed.
- Hosted native recording: https://portal.basegamelab.com/media/p_c7cebc/01_recording.html . No App Store/TestFlight submission or Android install was performed.
- Hosted video readback/playback verified: 810,731 bytes, SHA-256 `7153aeb8669085dcc0fb30ad8b310252f2cd145f660c2ee28154cb12e47bb2ec`, 720px wide, 5.338667 seconds. Hosted report inspected at playback 3.01 seconds.

## Checks and review

- Bird unit suite: **597 passed, 3 skipped** across 90 files. Includes combo boundary/exclusions/reset, hard threshold/cap/hash mismatch, loader provenance, and harness coordinate/HUD-spend regressions.
- Typecheck and scoped ESLint pass. Existing difficulty scorer's **40 focused tests pass**, covering Bird selection and legacy Dog/cache/cost compatibility.
- Local root audit reports only three pre-existing ignored `.env*` files as structure errors. No secrets are staged. CI audit runs against tracked source.
- Independent correctness review: no actionable findings. Native motion and gameplay evidence reviewers: passed, no findings. Review artifacts: `/private/tmp/compound-engineering/ce-code-review/ftb-earned-praise-20260915/`, `/private/tmp/ftb-earned-praise-motion-review.json`, `/private/tmp/ftb-earned-praise-gameplay-review.json`.
- PR #92 delivery checkpoint: hosted CI is queued on `ubuntu-latest`, as are older repository runs. GitHub reports no required checks and main has no branch protection. Local and physical results above are the acceptance evidence; hosted CI is not claimed green.

## Coverage limits

This is a four-scene pilot, including three currently bundled scenes and one older export, not a full Bird catalog ranking. Scores are known-location visual judgments, not blind detections or measured player difficulty. The Gemini batch stopped on its first HTTP 400 without usage metadata; cost remains unconfirmed and replay stays blocked. No catalog order or published level asset changed.

Android was not exercised in this iPhone-focused acceptance. Background reset is covered by policy tests and reviewed lifecycle wiring; no physical background/resume recording was made. Audio/haptic quality and 60 fps performance are not claimed by the silent native recording.

## Next action

None for the verified iPhone praise behavior. Expansion of the rating ledger and player calibration remain future scope.
