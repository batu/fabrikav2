# Evidence: FTD U4 durable jobs, approvals, artifacts — post review-fix (F1–F13)

- Date: 2026-07-21
- Card: e1tkuJVt ([FTD U4] Durable jobs, approvals, and artifacts)
- Revision: 193431d6 (`fix(ftd-editor): close U4 review findings F1-F13`), on top of caa03f13 + b49323d0
- Contract: headless-logic
- Mode: ce-evidence mode:pipeline
- Status: **passed**

## Verdict

The full backend contract suite, repeated-restart lane, wire-contract drift checks, UI typecheck/lint/unit tests, zero-live-provider scan, and secret-canary tests all pass at the post-fix revision 193431d6, confirming the U4 durable-job core with all 13 review findings closed.

## Checks run (worktree `tools/ftd-level-editor`)

| Check | Command | Result |
|---|---|---|
| Full backend suite | `uv run pytest tests -q` | **199 passed** (includes 12 new review-hardening tests) |
| Restart lane ×5 | `uv run pytest tests/contracts/test_job_recovery.py tests/contracts/test_execution_spec.py tests/contracts/test_review_hardening.py --count 5 -q` | **175 passed** |
| Drift/canary subset | `uv run pytest tests -q -k "drift or canary or secret"` | **22 passed** |
| OpenAPI + generated-TS drift | `uv run python scripts/generate_contracts.py` then `git status --short` | Regenerated files **byte-identical** to committed `openapi.json` / `ui/src/api/generated.ts` (clean tree) |
| TypeScript | `npm run typecheck` (tsc incl. generated.ts) | clean |
| Lint | `npm run lint` (eslint ui) | clean |
| UI unit tests | `npm run test:unit` | 9 pass, 0 fail |
| Zero live providers | grep for network imports (`requests/httpx/urllib/aiohttp/socket`) in `backend/ftd_editor/jobs`, `approvals.py`, `artifacts.py` | no hits; FailClosedProviders only |
| AE21 secret canary | included in suite (canary/secret tests) | clean — secret absent from API payloads, sqlite+wal bytes, artifact tree |

## Review-fix coverage

All 13 findings (8 P1, 5 P2) from the reviewed-stage pass are fixed in 193431d6 with per-fix tests in `tests/contracts/test_review_hardening.py` (12 tests), covering: post-intent crash orphaning + retry guard (F1), atomic in-transaction reuse (F2), approval-gate relabel (F3), atomic success-vs-cancel completion (F4), OwnershipLost fencing (F5), declared 409 wire shapes + regenerated contracts (F6/F7), result redaction (F8), cancel-before-resume recovery (F9), force-new 409/replay (F10), verified-bytes artifact serving (F11), JobService typing (F12), and previously-uncovered branches (F13).

## Gaps

None for this contract. Per-finding validator wave and Codex cross-model review pass remain not-run (recorded in the review comment); reviewed-stage worker will confirm closure on 193431d6.
