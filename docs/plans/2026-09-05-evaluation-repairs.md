# Fabrikav2 evaluation repairs

Status: implementation and local verification complete. The user subsequently authorized merge and cleanup on 2026-09-05; publication follows local and hosted checks. Device/provider acceptance remains outside scope. See docs/reports/2026-09-05-evaluation-repairs.md.
Base revision: `06cfd286d58ff6b51e7fd61bad51b697ab23517f` (remote main verified 2026-09-05).
Branch/worktree: `fix/evaluation-repairs`, `.worktrees/evaluation-repairs`.
Original evaluation: `/tmp/fabrikav2-evaluation/20260905-PmGfML/report.md`.
Execution logs: `/tmp/fabrikav2-implementation/20260905-evaluation-repairs/`.

## Scope and boundaries

Implement the five prioritized evaluated defects. Preserve game presentation, catalog/grant semantics, reviewed assets and unrelated work. No shell consolidation or wholesale rewrites. Work directly, without skill workflows. Implementation originally excluded publication and cleanup; the subsequent explicit merge/cleanup request authorizes those for this task's branch and worktree. Deployment, service restart, paid provider and physical-device operations remain excluded. Automated/source evidence must remain distinct from native/live-provider acceptance.

Existing implementations searched: SDK ad terminal/lifecycle waiters and purchase/restore locking, game IAP wrappers and fulfillment ledgers, dependency patch script, editor backend/browser aggregates, scaffold and native manifest validators. Extend these authorities rather than create parallel systems.

## Implementation and acceptance

1. [x] **U1: Rewarded terminal settlement.** Repair the shared AdMob provider so dismissal/failure settles the operation even when the native show promise stays pending. Reward only earned rewards; UI resumes after dismissal. Preserve listener cleanup, concurrent fullscreen ownership and disposal. Regression cases: early dismissal, failed show, reward-before-dismissal, native rejection, disposal, next ad.
2. [x] **U2: Late purchase delivery.** Add game-independent durable pending fulfillment plus an explicit acknowledgment/late-delivery seam to the existing shared IAP service. Wire affected native-game callers into existing verified grant logic, independent of the original UI promise. Preserve same-SKU no-double-charge recovery, no-ads restore filtering and transaction identity. Regression cases: timeout then late success without another tap, persistence/reconstruction, delivery retry, duplicate callback, storage failure and ordinary purchase/restore. Local persistence can recover verified results received by the app; store completion after termination before any result arrives requires provider/server reconciliation and must not be claimed as solved by local storage.
3. [x] **U3: iOS paid-impression units.** Correct the pinned AdMob iOS decimal-to-micros boundary using a version/hash-checked, idempotent dependency correction patterned after the existing GameAnalytics patch. Cover all affected formats and leave Android units unchanged. Verify fractional values, already-correct source, version/source drift and postinstall integration.
4. [x] **U4: Editor verification coverage.** Wire existing generic-editor Python and browser smoke suites into an explicit provider-free CI gate. Make dependency resolution reproducible and isolate tests from ambient credentials/live services. Verify the same gate locally; document any deliberate exclusions. Do not alter production provider behavior for test convenience.
5. [x] **U5: Scaffold identity.** Stamp native manifest identifiers, game-selecting package scripts and reference identity with the new game's Capacitor identity. Validate using actual template identity inputs and the existing native-shell validator, without running native tooling. Cover default/full-shell paths, slug normalization, archive/existing-name refusal and template preservation.

## Verification and completion

Run targeted regressions red before repairs where applicable, then neighboring behavior and relevant workspace typecheck/lint. Run the existing broader unit/audit gates once integration is stable, preserving fixture-only mutations. Review the final diff for correctness and scope, validate all five acceptance units, and record exact outcomes in a repo-backed implementation report. Do not label physical device or provider behavior verified. Leave source changes reviewable locally; no publication or implementation of the architectural observations.

## Work allocation

Reuse the same three bounded agents: runtime owns U1/U3, architecture owns U5, verification owns U4. The primary agent owns U2, plan, integration and final evidence. No recursive delegation. All agents preserve concurrent changes and edit only assigned files.
