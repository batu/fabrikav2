---
status: partial
subject: Marble Run difficulty editor v0
created: 2026-08-11
mode: pipeline
---

# Evidence: Marble Run difficulty editor v0

## Verdict

The Fabrikav2 editor candidate passes its deterministic generation, browser lifecycle, visual, export, and build gates; Portal integration passes locally but live authenticated activation remains consent-gated and unverified.

## What Changed

- Added the versioned Difficulty Draft and Export Candidate contracts, deterministic 110-level bake, validation, and explicit JSON review/download boundary.
- Added a game-owned React/Vite editor for Journey, Ranges, all 110 Boards, focused Level overrides, help, and isolated playable draft preview.
- Connected authored mappings, role rules, mechanic debuts, and advanced overrides to the production generator through a cancellable module worker.
- Added a Portal gateway for a pinned, digest-verified artifact in an opaque sandbox without Portal cookie authority.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| browser | `npm run test:browser -w @fabrikav2/marble-run-difficulty-editor` | passed: 110/110 accepted in ascending order, exact shipped bytes, worker 30,361.3 ms, main-thread long task 0 ms, input-to-paint p95 9.1 ms, stale results 0 |
| browser soak | same executable Chromium gate | passed: 30 cycles across levels 1, 46, and 90; peak one canvas/context/rAF; zero retained preview contexts, listeners, or frames |
| unit and static | editor unit, typecheck, lint | passed: 36 tests, typecheck, and lint |
| game oracle | focused Marble Run bake/contract/expand/validation suite | passed: 35 tests including exact 110-board reproduction |
| deterministic build | two consecutive production builds and `cmp` | passed: byte-identical manifest, content hash `8f0dc47d510754b4e3ee829eac8ddf20d6265c3f836f2dcb7bc125c9d50c7841` |
| Portal | `uv run pytest -q` in the isolated Portal worktree | passed: 458 tests; no live activation performed |
| screenshot | [Journey](assets/journey.png), [Ranges](assets/ranges.png), [Boards](assets/boards.png), [Play preview](assets/play-preview.png), [Export review](assets/export-review.png) | inspected: one visual hierarchy, 110-board overview, playable injected board, and explicit blocked-review state |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| correctness | passed | moved mechanic debuts, authored generation inputs, fresh workspace, and range selection have no remaining P0-P2 finding |
| testing | passed | production worker, browser gates, and complete colored gate overrides are exercised |
| security and reliability | passed | regeneration invalidates export eligibility; Portal sandbox/capability/cache boundaries have no remaining P0-P2 finding |

## Analysis

The implementation gates are green and the built artifact is deterministic. This evidence remains partial because Portal production configuration and deployment are external state changes requiring explicit authorization. Candidate export also intentionally does not migrate generated levels into the shipped game; source migration and physical-iPhone acceptance are a later workflow by product contract.

## Gaps

- Live authenticated Portal route has not been activated or inspected.
- Export Candidate migration, physical-iPhone verification, and game release are explicitly deferred.

## Next Action

Authorize Portal deployment and activation of the final pinned editor artifact, then inspect the authenticated live route.
