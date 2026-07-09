# @fabrikav2/testkit

Shared testing infrastructure: Playwright page objects, the test harness, and the
debug/tuning panel. Games and packages import from here instead of re-authoring their own
QA plumbing, so a new game gets the proven testing surface for free. Mostly carried from
v1's runtime/playwright/debug/testing modules (see the migration order in
`docs/architecture/v2-architecture.md`). Extend the shared Playwright base from
`configs/playwright.base.ts` here. Source-shipped, no build step.

## Subpath exports

- `@fabrikav2/testkit/playwright` — canvas fraction helpers, the `window`-harness
  bridge (`waitForHarness` / `readHarness` / `callHarness` / `pollHarness`), page-object
  navigation (`gotoAndWaitForHarness`, `waitForSceneActive`), and Playwright video capture.
- `@fabrikav2/testkit/debug` — the fixed debug panel shell (`mountDebugPanel`) and the
  immutable-defaults `createTuningStore`.
- `@fabrikav2/testkit/testing` — `assignWindowBindings`, default-state `driveTo`
  navigation, the `maybeRunInsituTour` device-capture tour, off-screen tour and
  viewport-metrics markers, and restore-on-cleanup helpers. State vocabularies
  are per-game data ratified in `refs/manifest.yaml` `states:`; `DRIVE_STATES`
  is only the legacy default list for existing harnesses. A game with custom
  states can pass `DriveToDeps.states` plus `gotoState(state)` and confirming
  predicates so `driveTo` uses that per-game list instead.

Ported as-is from v1 `packages/core/src/{playwright,debug,testing}` (research 06 §5: carry the
genuinely multi-game-adopted utilities). Dependency-light: only `@playwright/test` types and
vitest, both pinned at the root. No build step — source-shipped `.ts`.
