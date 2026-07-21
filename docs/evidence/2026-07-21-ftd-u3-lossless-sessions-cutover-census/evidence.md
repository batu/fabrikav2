---
status: passed
subject: FTD U3 lossless sessions, optimistic revisions, and cutover census
created: 2026-07-21
mode: pipeline
---

# Evidence: FTD U3 lossless sessions, optimistic revisions, and cutover census

## Verdict

Passed: focused backend, UI, repeated race, and read-only live-corpus evidence confirms that U3 preserves session bytes and sentinels, rejects stale writers with the current snapshot, keeps pending UI intent inert until an explicit choice, detects direct filesystem drift, and produces a checksummed no-write legacy census without exposing an import or repair route.

## What Changed

- Added a tolerant `AuthoringSession` boundary that preserves unknown fields, missing versus null, and null versus variant `0`, including byte-identical no-op saves.
- Made `SessionStore` the single revisioned current-session writer, with destination-absence creation, whole-directory revisions, stable-dog/gallery actions, compare-and-swap conflicts, and direct-drift detection.
- Added named current-session HTTP actions and explicit UI conflict state that preserves rejected intent until reapply or discard.
- Added deterministic read-only legacy identity/artifact census classification for stable, rebindable, ambiguous, and unsupported sessions, with source and report checksums and no import/repair surface.
- Review hardening made the census exhaustive over incomplete/symlinked session directories, restored v1's 20-pixel global minimum-cost identity gate, confined current-session directories against symlink escape, typed client failures and 409 OpenAPI recovery, and consolidated composition plus compare-and-swap ownership.
- The second reliability pass added durable staged creation and recovery, framed complete-tree revisions and census checksums, descriptor-pinned no-follow I/O, sparse-shape-aware lossless overlays, in-place mutation detection, typed transient storage failures, exact dog-bundle source preservation with three revision checks, finite-geometry rejection, and complete legacy folder/provenance/permutation/dangling-entry census coverage. Post-rename creation failures now report an explicit indeterminate commit.
- The final adversarial pass froze one builder session snapshot for both validation and publication, made inode churn retry or fail as a typed storage outage, and exposed post-replacement durability failures as indeterminate commits that require a reload before reapply or discard.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| focused U3 contracts | `UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache PYTHONDONTWRITEBYTECODE=1 uv run --project tools/ftd-level-editor pytest -q tools/ftd-level-editor/tests/contracts/test_session_roundtrip.py tools/ftd-level-editor/tests/contracts/test_session_revision.py tools/ftd-level-editor/tests/contracts/test_session_drift.py tools/ftd-level-editor/tests/contracts/test_variant_reservation.py tools/ftd-level-editor/tests/contracts/test_legacy_census.py tools/ftd-level-editor/tests/contracts/test_session_actions.py` | passed: 72 tests in 0.66s |
| safe backend regression lane | `UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache PYTHONDONTWRITEBYTECODE=1 uv run --project tools/ftd-level-editor pytest -q tools/ftd-level-editor/tests -m 'not paid'` | passed: 133 tests in 1.18s; no paid marker ran |
| read-only census fixtures | `UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache PYTHONDONTWRITEBYTECODE=1 uv run --project tools/ftd-level-editor pytest -q tools/ftd-level-editor/tests -m legacy_census` | passed: 17 tests, 116 deselected in 0.08s; exhaustive malformed-corpus, non-finite geometry, framed checksum, inventory/provenance, global assignment, threshold, stable/rebindable/ambiguous/unsupported, dangling-entry, and symlink-race cases classified with zero unexplained issues |
| repeated race/crash lane | `UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache PYTHONDONTWRITEBYTECODE=1 uv run --project tools/ftd-level-editor pytest -q tools/ftd-level-editor/tests -m stress --count=20` | passed: 40 tests, 2620 deselected, in 2.84s |
| assignment oracle | deterministic 1-4 row/column random matrices compared with exhaustive permutation minima | passed: 1,600 property cases |
| live v1 current-session census | `census_legacy_sessions(Path('/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/levels'))` under the target U3 package | passed: source `sha256:de0b77051b02047b705522c3b94968cdb5d1a0515dfc69a84287daa547e1321f`; report `sha256:e9814ac1c4e48318cfc61bcf44ab53f9899276291866a71815bf317271bdb656`; 0 current sessions; 0 unexplained |
| live source no-write snapshot | framed path metadata plus file-byte digest before/after the census | passed: 1 descendant entry and identical `sha256:26b64b7d2fdec5dd99eec4c2ae0147ab7343e8008adf2c1bd48ede9d0cf2d9a0` snapshots |
| UI conflict contract | `npm --workspace tools/ftd-level-editor run test:unit -- --test-name-pattern='revision conflict'` | passed: 9 tests; pending intent was not automatically resubmitted, reapply used the current revision, and discard refreshed without mutation |
| generated editor contract | `npm --workspace tools/ftd-level-editor run editor:contracts:check` | passed |
| UI static checks | `npm --workspace tools/ftd-level-editor run typecheck`, `npm --workspace tools/ftd-level-editor run lint`, and `npm --workspace tools/ftd-level-editor run build` | passed; fixture build transformed 31 modules |
| backend syntax and patch hygiene | `uv run --project tools/ftd-level-editor python -m compileall -q tools/ftd-level-editor/backend/ftd_editor` and `git diff --check` | passed; Ruff is not installed in the exact project dependency set and no dependency was added |

The focused contracts directly exercised AE9 through byte-identical old/unknown/sentinel round trips, AE10 through stale and concurrent writers, and AE11 through retained paid-artifact bytes with withheld stale application. They also proved destination-absence creation, same-value no-op revision stability, missing-to-null mutation semantics, current typed snapshots in HTTP 409 responses, stable-ID action routes, and the absence of raw patch/import/repair/archive-resurrection routes.

The explicit v1 current root contained one non-session file (`japanese_village_ids.json`) and no `session.json` files at capture time. Reading the complete configured current root still produced stable before/after metadata-plus-byte snapshots and deterministic source/report checksums. Nonempty historical sessions remain under archive roots and were intentionally excluded because archive/public resurrection and import are outside U3.

The only emitted test warning was the existing FastAPI `StarletteDeprecationWarning` for the `httpx` TestClient adapter. It did not affect the assertions.

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| full code review | passed after fixes | Correctness, testing, maintainability, project standards, security, performance, API-contract, reliability, agent-native, learnings, and adversarial lenses ran. Every accepted P1/P2 was reproduced, fixed, and regression-tested. External cross-model review was intentionally skipped because this card forbids live provider spend. |
| simplify | passed | Three dedicated reviewers covered reuse, quality, and efficiency. Applied shared stable-dog resolution, scoped monkeypatching, descriptor-safe streaming, linear fallback selection, stronger public-contract tests, exact error assertions, and a closed provenance source type; no safety or contract checks were removed. |
| visual/device | not applicable | This is a headless session/revision/census contract. The conflict panel remains intentionally unmounted, so no rendered interaction, mobile-game, or device artifact changed. |

## Gaps

- None within U3. The nonempty full-corpus cutover rehearsal remains the explicit U9 gate; U3 proves the classification/no-write mechanism with deterministic fixtures and the complete currently configured v1 current-session root.

## Next Action

None.
