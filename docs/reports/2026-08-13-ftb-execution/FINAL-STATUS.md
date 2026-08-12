# FTB full-plan execution — FINAL per-item status (2026-08-13)

Branch `ftb-execution-t1` (31 commits off main 56142f675, unmerged — merge is
gate ①). Suite: **485 passed, 0 xfails**, named baselines only (golden-cutout;
five-square-campaign game-side). merceka-core companion commit on
`feat/transparent-image-generation` (attribution contextvar, 421 tests green).
Statuses: PASS = behavior directly observed (test/live-rig/screenshot) ·
AUTOMATED ONLY = tests green, live surface not observed · DECISION-PENDING =
built to the gate, operator request OPEN on /s/ftb-execution.

## Amended-order steps 5–10
| Item | Status | Evidence |
|---|---|---|
| P2 lane boundary / P2.1-2.3 | PASS | chokepoint fail-closed (select_lane), canonical-required job start, tests |
| P2c.1 attempt-generations | AUTOMATED ONLY | transition guards + requeue refusal tests |
| P2c.2 requeue retains paid children | PASS | xfail flipped hard |
| P2c.3 requeue refuses running | PASS | xfail flipped hard + recovery-override branch |
| P2c.4 crash recovery | PASS | kill-9 drill test (paid→orphaned, pre→requeue, results intact) |
| P2c.5 magenta durable | PASS | SSE lane books durable job, provider-state metadata, attributed spend |
| A6 one-active-paid guard | PASS | 409 bird_job_active test |
| P2b.1 revision-bound catalog | PASS | catalog_revision_stale blocks Start (test) |
| P2b.2 transactional Start | PASS | projection never runs on failed activation (test) |
| P2b.3 no blind approval retry | PASS | modal demands fresh click; landed overnight |
| P2b.4 lifecycle | PASS (slice) | derived state + violations + archive-unlineup; full flag-replacement migration rides O-step cutover |
| Step 7 shakedown → P1.4 demotion | DECISION-PENDING | gate ③ dog_01; free-lane shakedown PASSED live overnight |
| P2d.1 recipe | PASS | canonical-magenta-v1, parity, dry-run diff |
| P2d.2 experiment manifest | AUTOMATED ONLY | record/read + endpoint; adopt-winner waits for real paid variants (gate: paid runs) |
| P2d.3 measured cost | PASS | attribution context proven end-to-end in a unit run |
| P2e.4 golden pairs | PASS | human-corrects-machine recording test |
| P2e.5 evidence sheets | PASS | contact-sheet endpoint, load-asserted |
| P2e.6 R11 enforcement | DECISION-PENDING | gate ② — measured packet (101 levels/1,913 birds) filed |
| Phase 4 deploy surface | DECISION-PENDING | gate ⑤ cutover consent |
| Phase 3 deletion | DECISION-PENDING | gate ④ backfill disposition |
| Phase 5 pruning | PASS (safe extent) | dead-by-design exports removed; endpoint-coupled prunes ride O9/O10 |
| P5.1 verbiage tier 1 | PASS | screenshot shows entity labels; backend errors neutral |

## Phase 6
| Item | Status | Evidence |
|---|---|---|
| O1 freshness guard | AUTOMATED ONLY | 4 unit cases; on-device observation device-gated |
| O2 budget fix | PASS | junk-PNG regression fixture |
| O3 release transaction | PASS (core) | ReleaseService: ordering/readback-abort/monotonicity tests; live R2 wiring rides O5 |
| O4 ManifestV2 | PASS (schema) | version 2 + releaseRevision + artifactDigest, byte-identical local/remote |
| O5 single publisher cutover | DECISION-PENDING | gates ①+⑤ |
| O6/O7 runtime=manifest, packer copy | DECISION-PENDING | RC deletion is gate ⑥ (O8); game-side ships via gated builds |
| O8 RC removal | DECISION-PENDING | gate ⑥ filed |
| O9/O10 deletions | DECISION-PENDING | follow O5-O8 |
| O11 enforcement | PASS (core) | break-glass journal open/refuse/reconcile tests; server-authority routes consolidate at O5 |

## CL list
CL-1 ✔ CL-2 ✔ (buttons; round-trip drift test) · CL-3 ✔ CL-4 ✔ (overnight+CR fixes)
· CL-5..9 → vNEXT: derivation core PASS, bake+dissolve DECISION-PENDING (gate ②)
· CL-10 ✔ · CL-11 ✔ · CL-12 ✔ · CL-13 ✔ · CL-14 ✔ · CL-15 ✔ · CL-16 ✔
(screenshot: no Confirm button) · CL-17 ✔ · CL-18 ✔ (verified preserved).
UI evidence: evidence-cutout-panel.png (live render, smoke-driven).

## Failure-class ledger (plan updated in-place)
1 stale-UI: DECISION-PENDING (Phase 4) · 2 legacy writers: CLOSED · 3 phantom
saves: closed except P1.4 clause (DECISION-PENDING chain) · 4 poisoned modal:
CLOSED · 5 eaten reviews: CLOSED · 6 job-store money: CLOSED · 7 webp deletion:
structurally closed by O3/O4 design; final proof rides the O5 cutover.

## Open operator gates (all on /s/ftb-execution)
① merge branch · ② R11 numbers + bake · ③ dog_01 donor sprite ·
④ backfill disposition · ⑤ Phase-4 cutover · ⑥ O8 RC removal ·
(⑦ implicit: paid-run authorization for the 50-round + experiment variants)

Zero agent-executable work remains that is not behind one of these gates.
