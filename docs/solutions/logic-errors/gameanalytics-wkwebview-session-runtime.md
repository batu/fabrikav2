# GameAnalytics WKWebView session runtime reliability

## Scope

Find the Dog and Find the Bird use the same GameAnalytics JavaScript runtime contract in a WKWebView. This change keeps game identities, canonical event names, provenance fields, ad/resource/progression mappings, and provider ownership unchanged. No production keys are reproduced here.

## SDK source decision

The npm registry metadata inspected on 2026-09-03 reports `gameanalytics@4.4.7` published 2023-11-06 and `5.0.0` published 2026-06-26. Tarballs were inspected directly (`4.4.7` SHA-1 `f619861acb499a61beea4c65bc650db1246ebe5d`; `5.0.0` SHA-1 `192b29936982f4e20b8df1d8277fb5d3b263443e`).

Both versions expose the manual-session APIs needed here: `setEnabledManualSessionHandling`, `startSession`, `endSession`, `onStop`, and `onResume`. However, both versions have the same persistence defect in `GAEvents.processEvents`:

1. events are persisted to localStorage when inserted;
2. a successful upload calls `GAStore["delete"](EGAStore.Events, requestIdWhereArgs)`;
3. that success branch does not call `GAStore.save(...)`;
4. a short relaunch can therefore reload the previously persisted event UUIDs and submit them again.

The 5.0.0 package notes describe TypeScript/build and refactoring work, not this queue-deletion persistence defect. Upgrading would add unrelated change without fixing replay. The smallest safe strategy is therefore to retain the existing exact 4.4.7 runtime and apply one version- and source-shape-pinned installer patch to its Node/main entry: save the store immediately after successful deletion. The package has no browser override, so this is also the entry Vite resolves for the games. The installer refuses an unexpected package version or source shape instead of silently altering unknown code. `games/*/tests/unit/gameanalytics-persistence.test.ts` pins the exact success-branch behavior and fails against the unpatched package.

## Runtime behavior

- `AnalyticsService.init()` now shares one promise. Sequential and concurrent calls emit one initial canonical `session_start` and register one lifecycle hook. A real inactive-to-active transition still emits exactly one next canonical session.
- The GameAnalytics sink enables manual session handling before `initialize`. Canonical `session_start`/`session_end` envelopes call the matching native GA methods while still retaining their separate canonical design-event mappings.
- A readiness timeout retains the queue, reports `SdkReadyTimeout`, waits for a bounded cooldown, and retries only when another event or explicit flush supplies a new trigger. It reuses the initialized SDK candidate rather than initializing it twice. There is no autonomous retry loop.
- Dynamic-loader failures are treated as transient and recover on a later trigger. A malformed/incomplete SDK surface is a hard `SdkShapeError`, disables the sink, and accounts queued/future events as dropped.
- `flush()` remains truthful: it awaits local initialization/readiness work, increments the existing diagnostic attempt where supported, and never claims backend acknowledgement. `lastSuccessfulFlushAt` remains `null` because the SDK exposes no delivery receipt.

## RED to GREEN evidence

Focused failures observed before production changes:

- Lifecycle idempotency: expected one `sessionStart`, received three on concurrent plus repeated init.
- Manual lifecycle: `setEnabledManualSessionHandling(true)` had zero calls.
- Readiness recovery: after timeout, expected one queued/zero dropped; received zero queued/one dropped with a generic `Error`.
- Loader recovery: after a rejected loader, expected one queued/zero dropped; received zero queued/one dropped.
- Replay persistence: the installed success branch contained deletion and logging but no `GAStore.save(GAState.getGameKey())`.

The corresponding focused suites passed after each vertical slice. Full verification commands and any environment-limited checks are recorded in the change handoff rather than being misrepresented as provider/backend proof.
