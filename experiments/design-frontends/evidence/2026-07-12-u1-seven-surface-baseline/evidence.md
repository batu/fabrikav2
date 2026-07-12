---
status: passed
subject: U1 renderer-neutral seven-surface baseline
created: 2026-07-12
mode: pipeline
---

# Evidence: U1 renderer-neutral seven-surface baseline

## Verdict

U1 passes its renderer-neutral contract, twin-seed, build, and live Android
observation gates at implementation commit
`90c8fd5b0d75646518a9e129be5669c3e800d438`. Both proof games were observed
through all seven frozen surfaces on the Ubuntu-connected Pixel 6a.

## What Changed

- Preserved the v1 shell-presentation bytes and added input-selected v1/v2 registry dispatch, renderer-profile validation, and a fail-closed v1-to-v2 migration.
- Added two seven-surface proof games with identical frozen behavior, including distinct Settings and Pause semantics, Shop, optional second currency, a fake SDK, and deterministic navigation.
- Froze the dual-frontend protocol, file fences, dependency baseline, device facts, task classes, implementation-ledger schema, and a renderer-neutral host evidence probe.
- Added a vendor-neutral `observation.json` contract for no-reference games. It
  binds evidence to the exact ordered protocol states, current source/design/refs/UI
  bytes, and committed raw-capture bytes; browser, detached, stale, truncated,
  corrupt, or hard-integrity-failing evidence is rejected.
- Grounded the mobile layout from the first Pixel run: one semantic safe-top token
  now feeds Menu/Level, the kit Settings page, and the custom Shop page; Shop is
  exactly two columns at the Pixel width.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| full gate | `npm run project-gate` | passed: all workspace typechecks, unit suites, audit, and agent-mirror check |
| contract tests | kernel suite inside project gate | 9 files and 116 tests passed |
| twin behavior tests | each proof-game suite inside project gate | 11 files and 85 tests passed per lane |
| host verification tests | verify-device suite inside project gate | 26 files and 338 tests passed |
| landing-gate tests | verify-gate suite inside project gate | 13 files and 150 tests passed |
| probe regression | `npm run test:unit --workspace @fabrikav2/verify-device -- test/evidenceProbe.test.mjs` | 4 tests passed; source is plain UTF-8 with zero NUL bytes |
| lint | `npm run lint` | passed with zero errors; three unrelated inherited warnings remain |
| production build | Grapes proof-game `npm run build` | passed, 113 modules transformed |
| production build | Phaser proof-game `npm run build` | passed, 113 modules transformed |
| scope fence | `git diff --name-only 0a6f7c39..0810246c -- games/_template tools/create-game` | empty; both explicit non-targets remained untouched |
| mobile browser capture | `games/shell_proof_grapes/evidence/2026-07-12-shop-final-p1-remediation/` | Menu, Shop, Settings, and Pause captured at 390x844 with browser-only labeling |
| touch geometry | `games/shell_proof_grapes/evidence/2026-07-12-shop-final-p1-remediation/shop-control-measurements.json` | every measured Shop action is exactly 48 CSS px high |
| live Android observation | `games/shell_proof_grapes/evidence/2026-07-12-u1-android-observation-90c8fd5b/` | seven of seven protocol states marker-gated; no capture failure; empty hard-integrity list; observation accepted against current checkout |
| live Android observation | `games/shell_proof_phaser/evidence/2026-07-12-u1-android-observation-90c8fd5b/` | seven of seven protocol states marker-gated; no capture failure; empty hard-integrity list; observation accepted against current checkout |
| visual inspection | raw Pixel Menu, Shop, Settings, and Pause in both lanes | safe-top clears system status bar; Shop is two columns; `UNAVAILABLE` is not clipped; Settings and Pause remain structurally distinct |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| Fable formal engineering review | passed | no P0, P1, or P2 findings across the complete U1 diff; four P3 follow-ups only |
| Fable measured aesthetics review | passed | zero P1 findings after the final two-column Shop and 48px control-floor remediation |
| Opus adversarial gate review | passed after repair | found unguarded observation production; producer failure now yields no landing evidence without replacing the truthful capture-run verdict |
| independent protocol-authority review | passed after repair | found a self-declared-state bypass; acceptance now requires lane membership and an exact ordered match to `protocol.json` `contract.states` |

The formal review result is preserved in `assets/fable-review.json`.

## Gaps

- The neutral seed has no trusted visual references. Its typed result is therefore
  `no-applicable-evidence`, not a fidelity pass; the observation proves real-device
  coverage only. A later scored experiment must supply independent references.
- Android is the current primary in-situ lane because the iPhone disconnected.
  This evidence does not claim iOS safe-area or native-shell coverage.
- The review's P3 hardening ideas remain non-blocking: cross-check sentinel/revision values in the host parser, make the duplicated renderer-profile vocabulary easier to reconcile, tighten post-paint readiness downstream, and replace generic proof-game contributor boilerplate.

## Next Action

Land U1 into `experiment/dual-design-frontends`, then continue with U3's
constrained editor and immutable publisher.
