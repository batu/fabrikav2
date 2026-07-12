---
status: passed
subject: U1 renderer-neutral seven-surface baseline
created: 2026-07-12
mode: pipeline
---

# Evidence: U1 renderer-neutral seven-surface baseline

## Verdict

U1 passes its renderer-neutral contract, twin-seed, evidence-probe, and build gates at `0810246ca74c4abc295b6f2144293abe8a778a5e` without claiming physical-device coverage.

## What Changed

- Preserved the v1 shell-presentation bytes and added input-selected v1/v2 registry dispatch, renderer-profile validation, and a fail-closed v1-to-v2 migration.
- Added two seven-surface proof games with identical frozen behavior, including distinct Settings and Pause semantics, Shop, optional second currency, a fake SDK, and deterministic navigation.
- Froze the dual-frontend protocol, file fences, dependency baseline, device facts, task classes, implementation-ledger schema, and a renderer-neutral host evidence probe.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| full gate | `npm run project-gate` | passed: all workspace typechecks, unit suites, audit, and agent-mirror check |
| contract tests | kernel suite inside project gate | 9 files and 116 tests passed |
| twin behavior tests | each proof-game suite inside project gate | 9 files and 77 tests passed per lane |
| host verification tests | verify-device suite inside project gate | 25 files and 296 tests passed |
| probe regression | `npm run test:unit --workspace @fabrikav2/verify-device -- test/evidenceProbe.test.mjs` | 4 tests passed; source is plain UTF-8 with zero NUL bytes |
| lint | `npm run lint` | passed with zero errors; three unrelated inherited warnings remain |
| production build | `npm run build --workspace @fabrikav2/shell_proof_grapes` | passed, 112 modules transformed |
| production build | `npm run build --workspace @fabrikav2/shell_proof_phaser` | passed, 112 modules transformed |
| scope fence | `git diff --name-only 0a6f7c39..0810246c -- games/_template tools/create-game` | empty; both explicit non-targets remained untouched |
| mobile browser capture | `games/shell_proof_grapes/evidence/2026-07-12-shop-final-p1-remediation/` | Menu, Shop, Settings, and Pause captured at 390x844 with browser-only labeling |
| touch geometry | `games/shell_proof_grapes/evidence/2026-07-12-shop-final-p1-remediation/shop-control-measurements.json` | every measured Shop action is exactly 48 CSS px high |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| Fable formal engineering review | passed | no P0, P1, or P2 findings across the complete U1 diff; four P3 follow-ups only |
| Fable measured aesthetics review | passed | zero P1 findings after the final two-column Shop and 48px control-floor remediation |

The formal review result is preserved in `assets/fable-review.json`.

## Gaps

- None within U1 scope. Physical Android evidence is deliberately owned by U10; these captures are browser evidence and are not represented as device proof.
- The review's P3 hardening ideas remain non-blocking: cross-check sentinel/revision values in the host parser, make the duplicated renderer-profile vocabulary easier to reconcile, tighten post-paint readiness downstream, and replace generic proof-game contributor boilerplate.

## Next Action

None.
