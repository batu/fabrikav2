---
status: passed
subject: U1 seven-state template shell on a physical iPhone
created: 2026-07-13
mode: pipeline
---

# Evidence: U1 seven-state template shell on a physical iPhone

## Verdict

The source-grounded seven-state shell completed its full tour on a signed physical iPhone build, and the Menu, Win, and Fail states contain the required Find the Dog interaction structure.

## What Changed

- The device runner now receives the ordered target states from the verification manifest instead of hard-coding a six-state tour.
- Menu exposes the persistent Shop / Play / Settings lower dock.
- Win exposes the pre-claim reward flow: 5 Coins earned, Claim, and Claim 2x with Watch ad disclosure.
- Fail exposes 25 Coins, Continue for 10 Coins, free Retry, and the distinct $4.99 Rescue bundle whose outcome is Continue this level.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| physical-device tour | `npm run verify-device -- --game shell_proof_phaser --platform ios --device <local-device-id>` | passed; all 7 required states were marker-gated at 390 x 844 CSS pixels with iPhone safe-area metrics |
| screenshots | `assets/menu.png`, `assets/level.png`, `assets/shop.png`, `assets/settings.png`, `assets/pause.png`, `assets/win.png`, `assets/fail.png` | 7 of 7 live-device states captured |
| source comparisons | `assets/menu-vs-ftd.png`, `assets/win-vs-ftd.png`, `assets/fail-vs-ftd.png` | required interaction structure is present; visual skin is intentionally neutral |
| runner regression | `npm run test:unit --workspace @fabrikav2/verify-device` | passed; 340 tests |
| repository gate | `npm run project-gate` | passed; 6 checks |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| Pixelsmith, Menu | passed | 85; persistent lower dock and required Shop / Play / Settings actions are present |
| Pixelsmith, Win | passed | 85; required reward, Claim, and Claim 2x / Watch ad flow is present |
| Pixelsmith, Fail | passed | 94; required balance, paid continue, free retry, bundle price, and bundle outcome are present |

Full structured assessments are preserved as `assets/menu.json`, `assets/win.json`, and `assets/fail.json`.

## Gaps

- None for the U1 claim that the complete source-grounded shell tour runs and captures on a physical iPhone. The generic verifier reported no applicable pixel-reference verdict because these neutral template states deliberately have no trusted one-to-one visual references; the source comparisons above assess structure rather than skin replication.

## Next Action

None.
