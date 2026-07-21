# Handoff: FTD level-editor migration after U4

Date: 2026-07-21  
Repository: `/Users/base/dev/appletolye/fabrikav2`  
Integration worktree: `/Users/base/dev/appletolye/.twf-worktrees/twf-ftd-level-editor-migration`  
Integration branch: `twf-ftd-level-editor-migration`  
TWF board: `scratch-2`  
Role from `/Users/base/dev/appletolye/fabrikav2`: `CONDUCTOR`

## Mission

Continue the dependency-ordered FTD level-editor reliability migration with U5, **Polling observer and Activity recovery** (`Q83flyGY`). Use Claude Fable for TWF workers and prioritize speed, while preserving the board/branch merge gates. When U5 is genuinely finished and landed on the integration branch, notify the user and stop; do not begin U6.

## Read first

1. `AGENTS.md`
2. `docs/plans/2026-07-21-001-refactor-ftd-level-editor-reliability-migration-plan.md`
3. This handoff
4. U4 evidence: `docs/evidence/2026-07-21-ftd-u4-durable-jobs-postfix/evidence.md`

The unified migration plan is the source of truth. U5 is specified under `### U5. Replace SSE state machines with one job-and-event observer`.

## Live state

- U4 card `e1tkuJVt` is in `merged`.
- U5 card `Q83flyGY` is in `planned` and depends on U4.
- The integration worktree was clean when this handoff was written.
- Integration HEAD is `65cdef9a`:
  - `65cdef9a fix(ftd-editor): close re-review findings G1-G4 (fencing, resume-not-retry, sweep CAS, cancel-wins)`
  - `3c9f2c46 docs(evidence): FTD U4 post-fix headless-logic evidence — all checks passed`
  - `193431d6 fix(ftd-editor): close U4 review findings F1-F13`
  - `b49323d0 docs(evidence): FTD U4 headless-logic evidence — all checks passed`
  - `caa03f13 feat(ftd-editor): durable jobs, approvals, and opaque artifacts (U4)`
- `git merge-base --is-ancestor 65cdef9a HEAD` succeeded in the integration worktree.
- The U4 card branch and integration branch currently point to the same `65cdef9a` commit.
- `main` remains unchanged at `ae9acbe3`; do not merge or push the initiative to `main` without explicit approval.

## What U4 delivered

U4 established durable, append-only job attempts, immutable execution specs/input hashes, request identity, restart recovery, cancellation/retry/force-new behavior, approval grants, opaque artifacts, generated OpenAPI/TypeScript contracts, and named FTD job actions.

Two Fable review/fix loops closed:

- F1-F13: ambiguous retry/duplicate-spend windows, non-atomic reuse, approval labeling, cancellation races, owner fencing, missing wire contracts, unredacted durable errors, recovery ordering, request-ID collisions, artifact TOCTOU, typing, and missing branch tests.
- G1-G4: unfenced heartbeat/stage writes, retry after a recorded provider ID, non-conditional sweep takeover/per-job containment, and cancellation being overwritten by error/conflict finishes.

Final verification reported by the reviewed-stage Fable worker at `65cdef9a`:

- `uv run pytest tests -q` from `tools/ftd-level-editor`: **204 passed**.
- Restart/hardening lane repeated five times: **200 passed**.
- OpenAPI and generated TypeScript regeneration: byte-identical.
- UI TypeScript, ESLint, and 9 unit tests: clean.
- Zero live provider calls.

## Evidence nuance

The durable evidence file `docs/evidence/2026-07-21-ftd-u4-durable-jobs-postfix/evidence.md` is pinned to `193431d6` and records 199/175 passes. The subsequent reviewed-stage handoff records the final `65cdef9a` verification at 204/200 passes, but no second durable evidence file was committed after G1-G4. Do not misrepresent the older file as revision-specific proof for `65cdef9a`. Refresh durable evidence before the initiative/final gate, or sooner if U5's workflow requires current accumulated evidence.

## Known landing-gate issue

`twf land e1tkuJVt --to-branch twf-ftd-level-editor-migration --evidence docs/evidence/2026-07-21-ftd-u4-durable-jobs-postfix/evidence.md` fast-forwarded the integration branch to `65cdef9a`, then returned nonzero in the repository-wide `npm run land-gate`.

The failing gate was **not U4 code**. `verify-merge-gate` demanded device evidence or UNVERIFIED ledger entries for inherited Find the Dog achievement files already present in the integration lineage:

- `games/find_the_dog/src/achievements/*`
- `games/find_the_dog/src/analytics/*`
- `games/find_the_dog/src/core/GameState.ts`
- `games/find_the_dog/src/scenes/GameScene.ts`
- `games/find_the_dog/src/sdk/SdkContext.ts`

During that landing attempt, repository typechecks, unit suites, audit, and Claude-mirror checks passed; the native iOS test also reported an XCTest failure while exporting attachments. Do not manufacture device evidence, silently add ledger exemptions, rerun a duplicate merge, or modify those unrelated achievement files as part of U5. Resolve the inherited gate through its owning card/evidence workflow or report it as an external integration blocker. Always re-check live state before acting.

## U5 scope

Goal: make dropped connections and reloads ordinary observer events while migrating already-durable starts.

Primary files from the plan:

- `tools/ftd-level-editor/ui/src/api/http.ts`
- `tools/ftd-level-editor/ui/src/api/generated.ts`
- `tools/ftd-level-editor/ui/src/jobs/observeJob.ts`
- `tools/ftd-level-editor/ui/src/jobs/observeJob.test.ts`
- `tools/ftd-level-editor/ui/src/jobs/Activity.tsx`
- `tools/ftd-level-editor/ui/src/jobs/jobStateActions.ts`
- `tools/ftd-level-editor/ui/src/features/wizard/`
- `tools/ftd-level-editor/ui/src/features/lineup/`
- Named backend actions for background, crop/retry, band, and sequence
- `tools/ftd-level-editor/tests/integration/test_observer_contract.py`
- Delete migrated SSE/shadow-state modules after their final caller moves.

Required behavior:

- One polling observer stores pending Request ID, Job ID, last snapshot, event high-water cursor, and connection state.
- Reload recovery queries durable server state by Request ID/session before trusting browser state.
- Activity exposes recovered jobs/artifacts and routes back to the originating feature.
- Cover the complete job-state/action matrix, including reconnecting, cancellation, retryable/terminal/orphaned states, and succeeded-with-unapplied-artifact.
- Port background, crop/retry, band, sequence, and multi-scene starts to durable POST actions.
- Poll with bounded backoff and no arbitrary terminal timeout.
- Delete old EventSource, timer, and shadow-storage paths immediately after the last caller migrates; do not preserve dual transport.
- No live provider calls or spend.

## Hard constraints

- Use Fable for TWF worker stages: `--agent claude/fable`.
- Work card-by-card through TWF; workers advance one stage and post structured handoffs.
- Run conductor commands from `/Users/base/dev/appletolye/fabrikav2` and landing commands from the clean integration worktree.
- Use isolated card worktrees with `--worktree --sync-main --to-branch twf-ftd-level-editor-migration`.
- Do not hand-merge or reconstruct a truncated card-branch name; use `twf` commands.
- Do not touch unrelated dirty state or other active worktrees.
- Do not merge to `main`, activate editor authority, shut down v1, spend against real providers, publish publicly, add dependencies, or make destructive legacy changes without explicit approval.
- U5 ends this continuation: notify the user and stop after U5 is landed and ancestry/evidence are verified.

## First action

From the conductor checkout, verify live authority and branch state:

```bash
cd /Users/base/dev/appletolye/fabrikav2
twf orient
twf status --card Q83flyGY
git -C /Users/base/dev/appletolye/.twf-worktrees/twf-ftd-level-editor-migration status --short
git -C /Users/base/dev/appletolye/.twf-worktrees/twf-ftd-level-editor-migration log -5 --oneline
```

If those facts still match this handoff, launch Fable on U5:

```bash
twf run-card Q83flyGY --through merged --agent claude/fable --worktree --sync-main --to-branch twf-ftd-level-editor-migration
```

Inspect the card after every bounded run. Trello calls have repeatedly taken 60-120 seconds; never duplicate `twf next`, `twf back`, comments, or handoffs merely because output is quiet. If `--through` stops at a gate, resume from the confirmed live column with `--stage <column>`.

## Verification commands

Run the narrow U5 checks from the card worktree first, then the accumulated integration checks required by the plan:

```bash
uv run --project tools/ftd-level-editor pytest tools/ftd-level-editor/tests/integration/test_observer_contract.py
npm run typecheck -w @fabrikav2/ftd-level-editor
npm run test:unit -w @fabrikav2/ftd-level-editor
npm run build -w @fabrikav2/ftd-level-editor
npm run editor:contracts:check -w @fabrikav2/ftd-level-editor
git diff --check
```

Also perform the provider-free browser journey specified by U5: inject API stop/restart, disconnect/reconnect, reload with cleared browser storage, and prove the same durable jobs/events/artifacts are rediscovered without another provider submission. Source-search for and prove removal of migrated `EventSource`, start-on-GET, timers, and shadow-state paths.

Before accepting a worker stage, verify all three:

1. The card advanced exactly one intended column.
2. A real structured `twf handoff` exists.
3. The claimed commits/diff exist on the card branch.

Before declaring U5 done:

1. Land from `/Users/base/dev/appletolye/.twf-worktrees/twf-ftd-level-editor-migration` using the exact U5 evidence artifact.
2. Prove the U5 final commit is an ancestor of integration HEAD.
3. Confirm the integration worktree is clean.
4. Confirm U5 is in its correct terminal board state.
5. Report any inherited repository-wide gate failure as a blocker distinct from U5 correctness.
6. Notify the user with the final commit, verification counts, evidence path, and any unresolved gate issue, then stop without starting U6.

## Definition of done

U5 is complete only when its observer/Activity migration is implemented, old migrated SSE/shadow transports are removed, targeted and browser fault-path verification passes without live provider calls, Fable review findings are closed, durable evidence exists for the final reviewed revision, the final U5 commit is proven on `twf-ftd-level-editor-migration`, the worktree is clean, and board/code state agree. A repository-wide inherited device-evidence failure must be reported as a blocker; it must not be disguised as success or “fixed” by unrelated U5 changes.
