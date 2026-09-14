---
status: partial
subject: Find the Dog between-level event parity
created: 2026-09-14
mode: pipeline
---

# Evidence: Find the Dog between-level event parity

## Verdict

Local tests verify the six canonical events, retained GameAnalytics fields, numeric values, overlay action tracker, next-level timing state, and existing AdMob composition. Mainline merge and device delivery are not established by this evidence.

## What Changed

- Ported `level_complete_shown`, `level_complete_action`, `interstitial_gate`, `next_level_ready`, and `level_abandoned` through the existing analytics service and scene/overlay callers.
- Extended Dog's existing `ad_lifecycle` composition with level index and fixed its GameAnalytics reverse mapping and field allowlist. Existing banner callbacks, load correlation, revenue forwarding, and resume registration remain intact.
- Preserved Dog's ad policy: no Bird-only first-session suppression was introduced.

## Evidence Captured

- Before implementation: the new parity test failed to import the absent `BetweenLevelFlow` module.
- Focused parity suite: 30 tests passed.
- Full Dog suite: 55 test files passed; 467 tests passed, 2 existing tests skipped. See `assets/unit.log`.
- Dog typecheck and workspace lint passed using `/opt/homebrew/opt/node@22/bin` on PATH, matching CI's Node 22 major version.
- Existing canonical contract superset, AdMob composition, GameAnalytics sink, experiment telemetry, and lifecycle tests ran in the full suite.
- `git diff --check` passed.

## Reviewer Assessments

- Reuse reviewer: no actionable findings; direct game-to-game imports would be inappropriate, and no shared equivalent exists.
- Quality reviewer: task-history comments removed. Suggested consolidation of the runtime gate was not applied: this instrumentation port preserves existing execution policy, and Dog's entitlement setter/load path disables ads.
- Efficiency reviewer: no findings; one-shot render listener, filtered/disconnected observer, and bounded pending state.
- Inline correctness, testing, and adversarial review: traced canonical mappings, action deduplication, completion attribution captured before level advancement, shutdown guards, and post-dismissal restart ordering. No blocking code defects found. Runtime scene/overlay emission on a physical Dog build remains unverified; helper/sink tests do not claim device proof.

## Environment Notes

The configured sparse profile omitted `games/shared`; that tracked dependency was added to this new checkout's sparse selection only. The host default Node runtime caused localStorage failures in existing experiment tests; rerunning under installed Node 22 passed. Root `npx eslint .` had no root config; the owning workspace's `npm run lint` passed. No repository configuration was changed for these environment issues.

## Gaps

- This branch starts at `d99607643` on the still-open Bird PR #79. Dog needs its own reviewed PR and green required CI before merge; it must not be merged into the shared Bird feature branch as a substitute for mainline delivery.
- No Dog native build or provider-arrival claim is made.
- No store, TestFlight, App Store Connect, or Firebase Remote Config mutation occurred. The phone and its save were not touched. No paid provider API calls were made.

## Next Action

Check the stacked Dog PR's required CI and PR #79's merge state; once the parent lands, retarget Dog to main and merge only after its checks pass and the diff contains only Dog follow-up work.

## Ordered Mission Checklist

1. §2.1: changed locally and verified by the tests above; own-PR mainline merge remains pending.
2. §2.2: not started; preserve the requested ordering behind §2.1.
3. §2.3: not started; no new close-tap or screenshot proof.
4. §2.4: not started; reconstructed archive commands remain unverified by this run.
5. §2.5: blocked by design until a store build carrying the events has 24 hours of users. No funnel conclusions or experiment-arm decision can be supported yet.
