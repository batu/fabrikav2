---
status: passed
subject: Analytics ingest credential scoping
created: 2026-07-10
mode: pipeline
---

# Evidence: Analytics ingest credential scoping

## Verdict

Focused and repository-wide evidence confirms that scoped credentials fail
closed, authorize the canonical SDK batch before downstream ingest gates, and
preserve valid owned-analytics ingestion without a runtime flat-key fallback.

## What Changed

- Added the owned credential parser, bearer authentication, and canonical batch
  authorization contract in `analytics-worker/auth.ts`.
- Added deterministic scope denial before duplicate, rate, clock-skew, replay,
  or storage work, with one public response and sanitized internal counters.
- Added config-state, duplicate-poisoning, per-credential environment isolation,
  denial-precedence, and overlap/revoke/rollback tests.
- Documented mandatory per-environment secret migration and mobile-safe
  rotation; no secret was minted or changed and no worker was deployed.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| focused test | `npm run test:unit --workspace=@fabrikav2/services -- src/analytics-worker/auth.test.ts src/analytics-worker/ingest.test.ts src/analytics-worker/query.test.ts` | passed: 49 tests |
| service test | `npm run test:unit --workspace=@fabrikav2/services` | passed: 70 tests |
| repository test | `npm run test:unit` | passed: every workspace suite |
| typecheck | `npm run typecheck` | passed: every workspace |
| lint | `npm run lint` | passed: 0 errors; 3 unrelated pre-existing warnings |
| audit | `npm run audit` | passed with existing repository warnings |
| runtime fallback audit | `rg -n "ANALYTICS_PUBLIC_CLIENT_KEYS\|anyGame\|legacy" packages/services/src/analytics-worker/auth.ts packages/services/src/analytics-worker/ingest.ts` | passed: no matches |
| contract ownership audit | `rg -n "game_id\|env" packages/services/src/analytics-worker/auth.ts` | passed: authorization reads the imported canonical batch directly |
| diff integrity | `git diff --cached --check` | passed |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| plan-aware code review | passed | correctness, security, reliability, adversarial, maintainability, and project standards found no residual defects |
| independent finding validator | passed | confirmed the missing split-credential fetch matrix; coverage was added and re-verified |
| independent API finding validator | passed | rejected retaining `publicClientKeys`; it had no consumer and contradicted the canonical scoped-only contract |

## Gaps

- No deployed-worker or live-secret evidence was captured because deployment and
  credential rotation are explicitly outside this card and remain human release
  work.
- Device and visual evidence do not apply to this headless service/auth change.

## Next Action

None.
