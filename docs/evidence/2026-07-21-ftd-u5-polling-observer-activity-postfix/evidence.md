# Evidence: FTD U5 post-fix — Polling observer, Activity recovery (review findings F1-F7 closed)

- Date: 2026-07-21
- Card: Q83flyGY ([FTD U5] Polling observer and Activity recovery)
- Commit under test: 56ab90ab (branch trello-Q83flyGY-ftd-u5-polling-observer-and-activity-rec)
- Contract: **headless-logic** (no pixels render — Activity.tsx unmounted until U6/U7)
- Status: **passed** (conductor-run verification; deferrals under Gaps)

## Verdict

The full U5 verification suite passes on 56ab90ab, the revision that closes
review findings F1-F7 (stop() race, poll single-flight, fetch timeout via
AbortController, discovery backoff, adapter dedupe onto shared startDurable,
transport and adapter-kind tests). This supersedes the pre-fix evidence at
36a6891e in `../2026-07-21-ftd-u5-polling-observer-activity/evidence.md`.

## Evidence (all run by the conductor in this worktree at 56ab90ab)

```
$ uv run --project tools/ftd-level-editor pytest tools/ftd-level-editor/tests/integration/test_observer_contract.py -q
7 passed, 1 warning in 0.22s

$ uv run --project tools/ftd-level-editor pytest tools/ftd-level-editor/tests -q
211 passed, 1 warning in 2.38s

$ npm run test:unit -w @fabrikav2/ftd-level-editor
tests 48 / pass 48 / fail 0

$ npm run typecheck -w @fabrikav2/ftd-level-editor   # clean, exit 0
$ npm run build -w @fabrikav2/ftd-level-editor       # built in 331ms
$ npm run editor:contracts:check -w @fabrikav2/ftd-level-editor  # byte-identical, exit 0
$ git diff --check                                   # clean
```

The 48 UI tests include the provider-free injected API stop/restart journey,
reload/cleared-storage rediscovery by requestId/session, disconnect/reconnect
convergence with exactly-once event delivery, the 11-state job-state/action
matrix, and the new transport + adapter action-kind coverage added for F1-F7.

Independent legacy-path scan (conductor, excluding tests):
`grep -rEn 'EventSource|_active_generations|shadow|sse_starlette|localStorage|sessionStorage'`
over backend `src` and `ui/src` → no code hits (one explanatory comment in
`durableStarts.ts`; the only `setTimeout` is the F-finding fetch-timeout abort
in `http.ts`). The committed source-scan test corroborates.

## Gaps (unchanged from pre-fix evidence)

- No real-browser (Playwright) journey: focus/aria-live behavior of
  Activity.tsx unverified until U6/U7 mount it in a feature UI.
- Named action kinds fail closed until U6 ports paid handlers.
- Retained-artifact apply endpoint lands with its owning feature.
