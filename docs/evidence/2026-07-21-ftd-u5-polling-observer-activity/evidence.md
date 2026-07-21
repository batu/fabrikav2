# Evidence: FTD U5 — Polling observer, Activity recovery, state-action matrix

- Date: 2026-07-21
- Card: Q83flyGY ([FTD U5] Polling observer and Activity recovery)
- Commit under test: 36a6891e (branch trello-Q83flyGY-ftd-u5-polling-observer-and-activity-rec)
- Contract: **headless-logic** (no pixels render — Activity.tsx exists but is unmounted until U6/U7 mount feature UI)
- Status: **passed** (with explicit, plan-consistent deferrals listed under Gaps)

## Verdict

Backend integration fixtures, UI headless-logic tests, typecheck, lint, and the
committed SSE-absence scan all pass on commit 36a6891e, confirming AE4/AE5a–AE7/AE20
behavior at the headless-logic contract: connection state never changes Job state,
reload rediscovers jobs by requestId/session, each durable state exposes only valid
actions, orphaned_unknown cannot retry, and no EventSource/SSE/shadow-storage path
exists in backend or ui/src.

## Evidence

### 1. Backend suite (integration fixtures + observer contract)

```
$ cd tools/ftd-level-editor && uv run pytest -q
211 passed, 1 warning in 2.22s

$ uv run pytest -q tests/integration/test_observer_contract.py
7 passed, 1 warning in 0.20s
```

The observer-contract tests cover AE4 (repeat lost start → same job), AE5a
(rediscovery by requestId and by session), AE6 (side-effect-free reads,
exactly-once ordered events-after-cursor replay, concurrent observers), AE7
(job completion with zero observers), UI/HTTP wire-contract equivalence, and a
source-scan test proving no EventSource / sse_starlette / _active_generations /
generation-status / localStorage / sessionStorage path exists in backend or ui/src.

### 2. UI headless-logic tests (node --test, repo convention)

```
$ cd tools/ftd-level-editor/ui && npm run test:unit
tests 33 / pass 33 / fail 0
```

Includes: observeJob.test.mjs — the provider-free injected API stop/restart
journey (scripted transport goes down mid-job → observer reports
connection=reconnecting while the durable snapshot is preserved → transport
restarts → observer converges to succeeded with each event delivered exactly
once); jobStateActions.test.mjs — matrix invariants for all 11 view states
(orphaned_unknown has no retry grant; succeeded_unapplied exposes explicit
inspect_and_apply; unknown statuses lock controls; reconnecting is a
presentation-only overlay); activity.test.mjs — session recovery, dedupe,
active-first ordering, separate durable vs connection labels, announcements.

### 3. Code health

```
$ npm run typecheck   # tsc -p ui/tsconfig.json → clean, exit 0
$ npx eslint .        # exit 0
```

### 4. Independent SSE-absence spot check

`grep -rEn 'EventSource|sse_starlette|localStorage|sessionStorage' backend ui/src`
(excluding tests) → no hits, corroborating the committed scan test.

## Gaps (explicit deferrals, consistent with U1–U4 evidence)

- No real-browser (Playwright) journey ran: the API stop/restart journey is
  headless-logic against a scripted transport implementing the wire contract.
  On-page focus restoration and aria-live announcement behavior of Activity.tsx
  are unverified until a feature UI mounts it (U6/U7).
- Named action kinds (crop_inpaint, retry_failed_dogs, band_generate,
  sequence_workflow, multi_scene_generate) have fail-closed providers until U6
  ports the paid handlers.
- Retained-artifact apply endpoint lands with the feature that owns it.

Next action for these gaps: U6/U7 mount Activity and feature screens; their
evidence passes must include the real-browser focus/aria-live journey.
