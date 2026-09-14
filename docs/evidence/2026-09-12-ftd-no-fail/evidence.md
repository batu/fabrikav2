---
status: passed
subject: Find the Dog no-failure gameplay
created: 2026-09-12
mode: pipeline
---

# Evidence: Find the Dog no-failure gameplay

## Verdict

The production archive's gameplay payload preserves play after twenty empty taps, hides hearts, and still accepts a correct dog find on a physical iPhone 12.

## What Changed

- `gameplay_mistakes_enabled` defaults to false and governs wrong-tap effects, life deductions, and failure.
- The HUD hides hearts when mistakes are disabled.
- The Firebase schema, value/source mapping, and template group include the boolean.

## Evidence Captured

- Source: `2e63afa5f50ae0c8e89a95b30cf07f60df3624c1`.
- Native identity: `com.baseardahan.hiddenobj`, 1.0.10 build 40; iPhone 12, device `2D894791-A5A3-58BE-9C88-AE0AF08B8C09`.
- XCUITest: twenty empty taps preserve `0/31`; hearts stay absent; a correct tap reaches `1/31`; Settings opens. Initial harness and production archive replays both pass.
- Additional production check: returning from Settings preserves `1/31`, and a second valid dog tap reaches `2/31` (`settings-return.log`, `settings-return-captures/`).
- The development export of the production archive and the App Store archive have identical web payloads: 317 files. The installed-app query confirms 1.0.10 (40).
- All 442 FTD unit tests pass under Node 22 with canonical dependency patches. Typecheck and game ESLint pass. Added tests exercise default no-penalty behavior, HUD visibility, and re-enabled penalties.
- Firebase project `find-the-dog-basegamelab`, template version 3: live `gameplay_mistakes_enabled=false`; structural comparison proves every other parameter/group remained unchanged. The false local default also covers unavailable configuration.

Private release evidence root: `/Users/base/store-review/find-games/ftd-no-fail-20260912/`.

Relevant files: `release-no-fail.log`, `release-no-fail.xcresult`, `release-captures/manifest.json`, `release-installed-apps.json`, `dog/payload-parity.json`, `unit-final.log`, `remote-before.json`, and `remote-after.json`.

## Reviewer Assessments

- Code reuse: replaced hard-coded test life counts with `GAMEPLAY.LIVES_PER_LEVEL`.
- Code quality: added the missing template group entry.
- Efficiency: no change applied; rebuilding three hidden pips is existing bounded work, and changing it was unnecessary for this behavior.
- Gameplay and static visual reviewers: passed initial device evidence without findings.
- UI interaction reviewer: no defects; initially partial pending archive proof. The parent inspected the successful archive replay and matching build identity, resolving that gap. Opening Settings is verified; no animation timing claim is made.
- Inline correctness/testing/standards review of the final five-file source diff found no blocking defects.

## Gaps

- Android device behavior and full-level completion were not exercised on-device in this focused iOS release check.
- The repository-wide audit fails on baseline `games/shared` structure/harness handling, also reproduced against the existing main checkout. The sparse checkout additionally reports omitted Bird sources and generated protected environment materialization. These are not introduced source regressions; audit success is not claimed.
- The original Node 26/shared-dependency test run failed on storage setup and an absent dependency patch. Isolated dependencies, the canonical patches, and the CI-pinned Node 22 resolved those failures.

## Next Action

App Store submission completed at 2026-09-12 11:08 UTC. Version 1.0.10 (40), build ID `85ef90c0-2e24-45dc-8e51-52181d93e75b`, and submission `4c2312e8-7ccc-4ada-a600-de40c2c6f559` read back as `WAITING_FOR_REVIEW`. Release type remains `AFTER_APPROVAL`. Provider receipts are `dog/submission-final-readback.json` and `dog/version-final-readback.json` under the private evidence root.

Source PR: https://github.com/batu/fabrikav2/pull/75. Merge remains subject to repository checks; no audit bypass is authorized or applied.
