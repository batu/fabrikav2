---
status: partial
subject: Merged PR review fixes
created: 2026-09-14
mode: pipeline
---

# Merged PR review fixes

## Changes

Bird's Got it alternative now advances both pan lessons while preserving the
remaining bird and hint lessons. Touch-based pan progression is unchanged.

Bird and Dog lifecycle hooks now have an explicit suspend phase. Observation
hooks are invoked first, then analytics closes and flushes the session. The
contract is synchronous observation emission; returned asynchronous work still
joins the existing suspend promise, and resume behavior is unchanged. The
GameAnalytics sink retains its buffering for late StoreKit results.

## Verification

- The button-driven onboarding regression failed before the fix because the
  alternative was hidden at pan-left; it passes afterward.
- The actual AnalyticsService, lifecycle registry and GameAnalytics sink
  integration regression failed before the fix because abandonment remained
  queued. Both games now dispatch abandonment and completion-screen background
  actions before native endSession, with no resume and no queued remainder.
- Full suites under Node 22: Bird 544 passed, 3 skipped; Dog 479 passed, 2 skipped.
- Both game typechecks and lint passed. Diff whitespace check passed.
- Independent onboarding and lifecycle reviewers found no remaining defect.

An initial Dog run under Node 26 failed 52 existing tests at localStorage.clear;
the Node 22 run passed the full suite. No unrelated source change was needed.

## Remaining acceptance

Physical testing remains deferred under the user's merge-first direction.
This follow-up does not claim a new native build/install, backend event receipt,
or full gesture acceptance. Original private save restoration remains pending
from the earlier diagnostic session. No production configuration or store action.
