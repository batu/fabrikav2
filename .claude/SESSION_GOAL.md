# Session Goal: Find games AppsFlyer + Crashlytics

Implement `docs/plans/2026-08-28-001-feat-ftb-appsflyer-crashlytics-plan.md` end-to-end from this isolated worktree.

## Target

Use Find The Bird as the primary physical-device proof for reusable AppsFlyer attribution and Firebase Crashlytics components, then adopt the same components in Find the Dog without game-local provider forks.

## Hard constraints

- AppsFlyer Strict/no-IDFA SDK only; child-directed non-tracking posture remains intact.
- Firebase Crashlytics only; Firebase Analytics and direct Meta App Events stay disabled.
- Credentials remain owner-only and outside Git; validate exact bundle identity before native sync.
- Partner forwarding remains off until event mapping, deduplication, privacy controls, and device/backend evidence pass review.
- No campaign spend, production deployment, App Store submission, or release without separate authorization.
- Physical iPhone proof must include AppsFlyer event receipt and a symbolicated deliberate Crashlytics test crash.

## Completion bar

All plan units that are not externally blocked are implemented and verified; tests and adjacent regressions pass; FTB device/backend evidence is durable; FTD uses the same components and passes parity/device smoke; remaining external gates are named rather than disguised as completion.
