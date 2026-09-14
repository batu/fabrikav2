# Find the Bird onboarding merge checkpoint

The human selected Compact pulse for pinch/zoom, option 2 (drag and hold) for pan, and a fixed hand pose animated as a rigid body for taps. The hand reflects horizontally and stays upright. Instruction text paints above the hand and reserves its canvas. The approved personalized-ad illustration remains unchanged.

The revised tour adds left then right panning after zoom. Pan entry waits for pinch release, ensures at least 1.6 zoom, and centers the bounded camera so a small qualifying pinch or boundary position cannot trap the player behind the 48px travel requirement.

Selection previews: [Compact pulse, option 2](https://portal.basegamelab.com/r/req_7ac886), [pan, option 2](https://portal.basegamelab.com/r/req_5240f2), [rigid tap](https://portal.basegamelab.com/r/req_4511ee). These are inspected asset/CSS previews, not current physical-device evidence.

The initial implementation passed two physical iPhone journeys covering guided finds, pinch, hints, handoff, returning-player skip, ordinary gameplay and native ATT. The selected gesture/pan revisions have not been physically verified: another task holds the exclusive phone lease. The user explicitly requested merging after this gap was disclosed. No new installation, store upload, production deployment or live configuration change is included in the merge.

Selected pinch source and Layer request/result/video are retained in assets/. `install-selected-pinch.py` reproduces the transparent runtime assets and reversed return leg. The actual provider meter is 8.448 CU for this selected job; all twelve generation attempts across the task total 101.376 CU. No account-balance claim is made.

Local revision checks: 532 tests passed, 3 skipped; TypeScript and ESLint passed. Full repository landing gate is recorded separately in the PR merge validation. Physical verification remains a follow-up, not a claimed pass.
