---
status: passed
subject: U6 Phaser shell exact-source Android observation
created: 2026-07-14
mode: pipeline
---

# Evidence: U6 Phaser shell exact-source Android observation

## Verdict

Passed: the exact current Phaser shell sources were built, installed, launched, and captured through all seven gated states on the physical Pixel 6a, and the landing gate accepts the resulting source-bound observation.

## What Changed

- Rebuilt the Phaser shell after the final font-authority repair.
- Installed the fresh debug APK on Android device `27091JEGR22183`.
- Captured the protocol states `menu`, `level`, `shop`, `settings`, `pause`, `win`, and `fail` only after each state published its exact tour marker.
- Bound the observation to the canonical current inputs under the Phaser game, its references, and `packages/ui`.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| physical-device run | `node tools/verify-device/cli.mjs --game shell_proof_phaser --platform android --device 27091JEGR22183 --android-sdk /home/batu/android-sdk --content-inset-top 72 --content-inset-bottom 96 --skip-panel --out games/shell_proof_phaser/evidence/2026-07-14-u6-final-device-gate` | exited 0; seven of seven states gated and captured |
| source-bound observation | `observation.json` | accepted by `readObservationEvidence`; canonical input SHA-256 `e2d2742f1394aa4779b703040202774164710a310a8737dd59b4d9c9fcae69eb` |
| capture integrity | `raw-captures/` and per-capture hashes in `observation.json` | seven files present; no capture failure; empty hard-integrity findings |
| device report | `grid.html` and `summary.json` | `NO-APPLICABLE-EVIDENCE`; all seven states intentionally have no trusted reference |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| TWF aesthetics reviewer | passed | Final device sequence was reviewed clean before this source-bound recapture; this run confirms the same shell on the post-repair source. |

## Gaps

- No trusted per-state visual reference exists for either experimental editor lane, so this run proves live-device observation and integrity, not a numerical fidelity score. That limitation is explicit in `summary.json` and is the intended `no-applicable-evidence` contract.

## Next Action

None.
