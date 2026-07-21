---
status: partial
subject: FTD ACH-1 durable achievement domain
created: 2026-07-21
mode: pipeline
contract: headless-logic
trello: https://trello.com/c/Yno5aUqL
---

# Evidence: FTD ACH-1 durable achievement domain

## Verdict

Partial: fresh typecheck and 186-test unit evidence confirms the headless achievement contract and returned ACH-2 read-projection/event-allocation contract, but the mandatory repository-wide audit remains red on an unchanged out-of-scope `shell_template` asset-identity error.

## What Changed

- Added the typed achievement catalog, fact/delta contract, versioned persisted record, conservative migration, durable analytics outbox, and deterministic event mapping.
- Integrated achievement facts and recoverable reward settlement with `GameState`, preserving the existing completion result and allowing the core finale to continue when achievement persistence is unavailable.
- Wired accepted dog finds and completion commits to the domain, and deferred recovered analytics draining until real SDK sinks are composed.
- Added deterministic unit coverage for catalog ordering, progress, dedupe, relaunch, every strict settlement write boundary, migration, fallback identity, wallet reconciliation, analytics field survival/retry, and runtime wiring order.
- Applied review hardening so a failed load cannot overwrite an unread journal, checkpoint 0a cannot strand an ordinary base grant, malformed persisted outbox events fail closed, and ACH-2 has typed discovery/view emitters.
- Added the returned ACH-2 dependency contract: a canonical per-achievement read projection that distinguishes locked, in-progress, live-reward-settled, migration-unlocked/reward-ineligible, and legacy-unknown states; plus durable collision-safe allocation for achievement page/view analytics IDs.
- This card is non-visible: the scene/bootstrap diff adds domain and analytics calls only and does not change rendered objects, layout, styling, textures, overlays, or native configuration.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| typecheck | `npm run typecheck -w @fabrikav2/find_the_dog` | passed, exit 0 |
| unit suite | `npm run test:unit -w @fabrikav2/find_the_dog` | passed: 27 files, 186 tests |
| focused ACH-1/ACH-2 contract tests | `npm run test:unit -w @fabrikav2/find_the_dog -- --run tests/unit/achievement-progress.test.ts tests/unit/achievement-analytics.test.ts tests/unit/achievement-migration.test.ts tests/unit/achievement-persistence.test.ts` | passed: 4 files, 79 tests |
| fault-injection / recovery | Focused test trace | passed: all four completion-progress writes, all three wallet baseline writes, all three settlement wallet writes, checkpoint-1/3 same-process retries, mixed per-key tears, hint-cap application, reconciliation anomaly journaling/drain, and persistence-unavailable finale degradation |
| contract round trip | Focused test trace | passed: catalog order/reward bounds, cumulative progress/mastery reload, conservative migration, canonical reward-status projection, fail-closed GameState projection, sequence-backed domain and UI analytics IDs, durable allocator reservation/reload, typed dispatch/page-view methods, malformed-outbox rejection, and GameAnalytics field survival |
| diff hygiene | `git diff --check` | passed, exit 0 |
| runtime-surface classification | `git diff --unified=4 dbe90c68..HEAD -- games/find_the_dog/src/scenes/GameScene.ts games/find_the_dog/src/sdk/SdkContext.ts` | headless-logic confirmed; only domain recording/outbox draining calls added |
| repository audit | `npm run audit` | failed: unchanged `games/shell_template/design/assets/app-icon.png` source is missing; remaining output is warnings in untouched design/reference/config files |
| optional lint | `npx eslint <review-changed TypeScript files>` | unavailable: repository has no ESLint v9 `eslint.config.*`; required typecheck/unit gates remain green |
| audit scope check | `git diff --name-only dbe90c68..HEAD` compared with audit output | no audit error points to an ACH-1 changed file; the failing `shell_template` asset is outside the card scope fence |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| Runtime visual reviewer | not selected | Headless-logic card with no rendered delta or runtime media artifact; tests and typed contracts carry the verification signal. |

## Analysis

The change-specific gates are green. The full game typecheck passes, the complete 186-test unit suite passes, and the focused 79-test achievement run directly exercises the high-risk behavior: duplicate callbacks, persistence/relaunch, every strict progression/wallet write boundary, same-process retry after record-write failure, hint-cap settlement, conservative migration, fallback-safe mastery identity, canonical reward-status projection, durable collision-safe UI event allocation, malformed/future journal input, and canonical analytics field survival/retry.

The repository audit does not pass. Its only error is an asset-identity source missing under `games/shell_template`; it also reports warnings in pre-existing design tokens, reference manifests, dependencies, and assets. None of those paths are changed by ACH-1, and the card's scope fence prohibits repairing `shell_template`, design assets, refs, or unrelated audit debt here. This prevents a fully `passed` ce-evidence status, but it does not invalidate the focused headless-logic evidence and is acceptable to carry into PR review as an explicit repository release gate.

No device capture was produced because this card renders no achievement UI. Device screenshots or video would not observe the persistence and analytics guarantees under test; ACH-2 owns the later visible consumer.

## Gaps

- `npm run audit` remains red because `games/shell_template/design/assets/app-icon.png` maps to a missing source file outside this card's scope; repository-wide warnings also remain in untouched design/reference/config surfaces.

## Next Action

Route the `shell_template` asset-identity error to its owning card, repair the missing source or mapping there, and rerun `npm run audit` before a repository release; ACH-1 can proceed to PR review with this risk recorded.
