# Overnight run report — 2026-08-12/13 (canonical-first foundations)

Worktree: `.claude/worktrees/overnight-canonical` · base `7eea4adf6` → HEAD (see git log; count includes report/audit commits) `37383b524`
Dirty at end (pre-report-commit measurement): 1 files (none — all committed).
Verification: `uv run pytest` → **455 passed, 1 failed (named baseline: test_golden_cutout_dataset,
pre-existing baseline red — manifests as approved-sprite hash mismatch in the main checkout and missing color.png in this sparse worktree; both are the same golden-dataset-vs-churned-corpus drift, declared at run start), 2 xfailed (P2c job-store, correctly deferred)**;
`ui npm run build` green; game `tsc` green; O1 vitest 4/4.
Paid spend: **$0.00** (merceka ledger read: no entries after 17:02 UTC — all pre-run).
Protected levels: **4/4 bit-for-bit MATCH** (baseline vs final, same hash method;
note: the hash pipeline embeds relative paths — run it from repo root).

## Executive table

| Item | Status | Evidence |
|---|---|---|
| 1. FF-5 strict loaders + FF-1 asset CAS | **PASS** | db3f60b87, d21c9630d; corpus pre-verified (64 pointers, 1,842 revisions digest-clean); tests |
| 2. A2 resolver + A3 lane selector | **PASS** | d39c7d351; tamper/escape/CAS-only tests |
| 3. Hydrate overlay + DAG + read surfaces | **PASS** | 6433558f5, 09b515c99, 562d97d65, b3c4e1513; live-proven in shakedown |
| 4. P1.8 read-back + provenance strip | **AUTOMATED ONLY** | eeb6afd71; contract tests green; the live rejected-save UI flow was NOT observed (no browser in the rig) |
| 5. P1.6 geometry service + census | **PARTIAL** | 6e8ce19b2 + CR-1 batch; live rig observed only identical-move/no-op; add/delete/CL-4/census are AUTOMATED ONLY. Both xfails flipped — note: the auto-place test now accepts the REFUSAL branch (422 identity_refused on sprited sessions), which is the intended CR-1 semantics, not the original update-behavior claim |
| 6. O1 freshness guard + O2 budget | **AUTOMATED ONLY** | f8bd9631f, 9ca7f1b05; unit-tested; NOT observed on-device (device mutations prohibited tonight) |
| 7. Recipe schema slice | **AUTOMATED ONLY** | bce8d48cf; parity test compares API vs backend resolve (both call the one resolver); no UI consumer exercised live |
| 8. Shakedown | **PARTIAL** | Free lane **PASS live** (24-bird alpine: import→migrate→VALID_CURRENT→CAS→no-op→readiness→hydrate, isolated rig); paid regen **PARKED** (see below) |
| 9. 50-run | **NOT STARTED** | Gate (paid-shakedown PASS + immutable manifest + CR-3) never opened; no preflight attempted, $0, nothing to restore; smallest next action = clear item-8 blockers |

## Codex checkpoints
- Per-item reviews: cr-item1 (9 findings, all P0/P1 fixed same night), cr-item3
  (5 P0s, all fixed). CR-1 adversarial: **FIX-FIRST, 10 findings — ALL FIXED**
  (id-aware replace_set, retired slots, sprite-less lanes, readiness gate,
  single-read responses, detail-envelope unwrap, manifest-only budgeting).
  CR-2 pre-paid: **NO-GO-UNTIL** — honored, $0 spent. CR-4: see cr4-verification-audit.md.

## PARKED: paid uk_cotswolds_3a43 regen — blockers
1. **Package worse than recorded:** `dogs/dog_01/` absent while level.json
   references it (+ 25 birds/20 unique sprites). Exact error:
   `PublicImportError: bird dog_01 is missing sprite artifacts` (import fails
   closed BEFORE any mutation — no restore needed, the rig copy is disposable;
   worktree SHA at park time: see git log around the shakedown-result commit).
   Repair = choosing which sprite to duplicate = data invention → operator
   decision. Smallest next action: pick donor sprite for dog_01 (or delete the
   bird) in the editor, then re-run the import in the rig.
2. **CR-2 NO-GO list** (cr2-prepaid-audit.md, committed on this branch):
   runtime attempts=1 enforcement, immutable pre-call manifest, code-level
   staging mode, executable abort rules — P2b/P2c engineering, not paperwork.
   Smallest next action: implement the attempts=1 runtime clamp (single
   config/guard in the retry-inpaint job start), it unblocks the rest.
   No spend, no mutation, nothing to restore.

## Defects FOUND & FIXED tonight (beyond plan items)
- Promote scene lane committed descriptors before bytes landed (FF-1 caught it;
  digest-addressed staging fallback added).
- Resurrection import couldn't read canonically-exported packages (sidecars
  required but not shipped) — sidecars now optional, geometry from level.json.
- FastAPI detail-envelope mismatch would have silently disabled the UI 409
  reconciliation (CR-1 #7).

## Explicitly unverified
- On-device behavior of O1 (needs a phone build — prohibited tonight).
- Editor UI flows beyond build/typecheck (no browser harness in the rig).
- The magenta/crop job writers now route through the chokepoint by
  construction, but no live paid job exercised them tonight.
- five-square-campaign game test remains baseline-red (bundling policy
  decision pending — morning queue).

## Rollback
Every change is on branch `overnight-canonical` (not merged). Rollback =
don't merge. Data: isolated rig only; production workspace untouched
(protected hashes + $0 ledger prove it).

## Morning queue (decisions, prepared not executed)
1. uk_cotswolds dog_01 sprite decision → unblocks paid shakedown.
2. CR-2 NO-GO engineering (attempts=1, staging mode) → schedule into P2b/P2c.
3. R11 measurement proposal + radius-bake authorization (untouched tonight, as ordered).
4. Reclamation test on the 4 protected levels (add/remove/save via new CL-3
   lanes — needs your eyes).
5. 200MB native cap decision; five-square-campaign baseline reconciliation.
6. Merge review of overnight-canonical (14 commits) → main branch.
