# @fabrikav2/testkit

Shared testing infrastructure: Playwright page objects, the test harness, and the
debug/tuning panel. Games and packages import from here instead of re-authoring their own
QA plumbing, so a new game gets the proven testing surface for free. Mostly carried from
v1's runtime/playwright/debug/testing modules (see the migration order in
`docs/architecture/v2-architecture.md`). Extend the shared Playwright base from
`configs/playwright.base.ts` here. Source-shipped, no build step.

_Stub — no implementation yet. Ported alongside kernel in an early migration card._
