---
status: passed
subject: Marble Run difficulty editor v0
created: 2026-08-11
mode: pipeline
---

# Evidence: Marble Run difficulty editor v0

## Verdict

The Fabrikav2 editor candidate passes its deterministic generation, browser lifecycle, visual, export, and build gates. Portal integration is merged, activated, and verified through the live authenticated route against the exact pinned artifact hash.

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
| unit and static | editor unit, typecheck, lint | passed: 38 tests, typecheck, and lint |
| game oracle | focused Marble Run bake/contract/expand/validation suite | passed: 35 tests including exact 110-board reproduction |
| deterministic build | two consecutive production builds and `cmp` | passed: byte-identical manifest; deployed plain-language artifact content hash `00f1500bfc5326cd26e7d3ee37976c34a8e9525e8f85b8f50991d83c1317c615` |
| Portal | `uv run --with pytest --with httpx2 pytest -q` in the merged Portal worktree | passed: 458 tests; Portal `main` pushed at `edee626b774cc6fbc2c871d643a3c97e17910d8c` |
| Portal browser | local authenticated gateway serving the final retained archive | passed: shell 200, exact hash-namespaced iframe, level 46 selected and playable with one canvas, all seven HUD images loaded, no page errors; [capture](assets/portal-local-level-46.png) |
| Portal live browser | `https://portal.basegamelab.com/tools/marble-run-difficulty/` with authenticated operator session | passed: shell 200 and iframe URL pinned to content hash `e6a20c180c661c54555afabc8c6bedba377ffeb7e5d1d7e16a715787aaae64bc`; desktop vertical rail moved the editor `0 -> 579`; narrow Ranges moved `0 -> 402`; narrow Boards moved `0 -> 376`; 110 boards rendered; zero page errors |
| Portal live Pattern | same authenticated route, content hash `00f1500bfc5326cd26e7d3ee37976c34a8e9525e8f85b8f50991d83c1317c615` | passed: no visible generator jargon; all 11 teaching levels and 19 repeating steps visible; Level 8 and Step 5 selection updated their focused editors; zero page errors; [capture](plain-language-review/pattern-live-1440.png) |
| candidate download | production build review, confirmation, and browser download | passed: 91,090 bytes, 110 boards, 110 evidence rows, no validation issues; filename and file SHA-256 both `d6ef426b3b1e4fccd22816cdae3d90edb953cba7c9745ee70722f42d40d4fc3b` |
| generation recovery | invalid gate 19 on level 1, then Return to Journey inheritance | passed: [Needs attention](assets/generation-failure.png) appeared while the last valid board remained visible; [recovered](assets/generation-recovered.png) removed the exception after regeneration |
| screenshot | [Journey](assets/journey.png), [Ranges](assets/ranges.png), [Boards](assets/boards.png), [Play preview](assets/play-preview.png), [ready export](assets/export-ready.png) | inspected: one visual hierarchy, 110-board overview, playable injected board, and complete 110/110 export review |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| correctness | passed | moved mechanic debuts, authored generation inputs, fresh workspace, and range selection have no remaining P0-P2 finding |
| testing | passed | production worker, browser gates, and complete colored gate overrides are exercised |
| security and reliability | passed | regeneration invalidates export eligibility; Portal sandbox/capability/cache boundaries have no remaining P0-P2 finding |

## Analysis

The implementation gates are green, the built artifact is deterministic, and the exact retained archive is active behind Portal's authenticated production route. Candidate export intentionally does not migrate generated levels into the shipped game; source migration and physical-iPhone acceptance remain a later workflow by product contract.

## Gaps

- Export Candidate migration, physical-iPhone verification, and game release are explicitly deferred.

## Completion State

Editor candidate and Portal integration are complete. Runtime migration, physical-device acceptance, and game release remain explicitly outside this plan.
