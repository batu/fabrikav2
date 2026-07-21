# Evidence: FTD U4 — Durable jobs, approvals, and opaque artifacts

- Date: 2026-07-21
- Card: e1tkuJVt ([FTD U4] Durable jobs, approvals, and artifacts)
- Branch: trello-e1tkuJVt-ftd-u4-durable-jobs-approvals-and-artifa @ caa03f13
- Contract: headless-logic (backend job lifecycle + contracts; no visual runtime surface)
- Mode: pipeline

## Verdict

**passed** — the full backend contract suite, repeated restart-recovery lane,
OpenAPI/generated-TypeScript drift check, and UI typecheck/lint/unit all pass
against the committed U4 code, with zero live provider calls (fail-closed
scripted providers only, no network imports in the new job/approval/artifact
modules).

## Evidence

All commands run in `tools/ftd-level-editor/` on this worktree.

| Check | Command | Result |
|-------|---------|--------|
| Full backend suite (incl. 7 new U4 contract files: job contract, request identity, cancellation, recovery, execution spec, approval grants, job artifacts; plus AE21 secret canary in test_secret_redaction.py) | `uv run pytest tests -q` | **187 passed** in 1.78s |
| Repeated restart lane (AE18/R18 recovery + input-hash determinism, 5 repetitions) | `uv run pytest tests/contracts/test_job_recovery.py tests/contracts/test_execution_spec.py -q --count 5` | **115 passed** |
| OpenAPI + generated-TS drift | `uv run python scripts/generate_contracts.py` then `git status --porcelain` | regenerated `openapi.json` and `ui/src/api/generated.ts` byte-identical to committed files (git clean) |
| UI typecheck (incl. generated.ts) | `npm run typecheck` | clean |
| UI lint | `npm run lint` | clean |
| UI unit tests | `npm run test:unit` | 9 pass, 0 fail |
| No live provider calls | grep for network imports (`requests/httpx/urllib/socket`) in `backend/jobs`, `backend/approvals.py`, `backend/artifacts.py` | no hits; providers are scripted/fail-closed in tests |

## Acceptance mapping

- AE4-AE5a, AE7-AE8a, AE11, AE18-AE19, AE21 exercised by the contract suites
  above (job identity/replay, linked attempts via retry/force-new, one-use
  approval grants for ambiguous resubmission, conflict-as-success application,
  restart recovery matrix, opaque root-confined artifact downloads, secret
  canary absent from API payloads, sqlite/WAL bytes, and artifact tree).

## Gaps

None for this unit. Known, by-design deferrals (owned by later units, not
evidence gaps): U5 consumes these routes and owns the HTTP client;
per-kind resume handlers land with U6 (until then checkpointed provider jobs
recover to `orphaned_unknown` by design); late-output-on-cancel policy is
always-withhold.
