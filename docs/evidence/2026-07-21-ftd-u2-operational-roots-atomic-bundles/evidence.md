---
status: passed
subject: FTD U2 operational roots and recoverable atomic bundles
created: 2026-07-21
mode: pipeline
---

# Evidence: FTD U2 operational roots and recoverable atomic bundles

## Verdict

Passed: focused local-filesystem contracts and repeated stress lanes confirm that U2 confines explicit operational roots, publishes complete legacy-compatible bytes atomically, recovers deterministic interruption phases, and serializes same-dog allocation through publication without mixed bundles.

## What Changed

- Added immutable `WorkspacePaths` roots for authoring, public, state, artifacts, cache, and locks, with production Git-worktree rejection and an approved-filesystem durability probe.
- Added root-confined atomic JSON, bytes, and image writes plus immutable staged-bundle installation, selection, rollback, and startup recovery records.
- Added explicit raw FTD bundle membership and a `SessionStore` reservation boundary spanning same-dog variant allocation through complete bundle publication.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| focused filesystem contracts | `UV_CACHE_DIR=/private/tmp/uv-cache-ftd-u2-evidence uv run --project tools/ftd-level-editor pytest tools/ftd-level-editor/tests/contracts/test_workspace_paths.py tools/ftd-level-editor/tests/contracts/test_atomic_publication.py tools/ftd-level-editor/tests/contracts/test_bundle_recovery.py tools/ftd-level-editor/tests/contracts/test_variant_reservation.py -q` | passed: 21 tests in 0.08s |
| repeated race/crash stress | `UV_CACHE_DIR=/private/tmp/uv-cache-ftd-u2-evidence uv run --project tools/ftd-level-editor pytest tools/ftd-level-editor/tests -m stress --count=20 -q` | passed: 40 tests, 960 deselected, in 0.40s |
| legacy-compatible fixture bytes | `test_atomic_bytes_and_json_replace_complete_files_and_match_legacy_bytes` | passed: canonical JSON SHA-256 remained `2740e7c205ac66ed90c1bde7c6b13d3121d53df67b24aa8f8d45356b8b52f8e7` |
| patch hygiene | `git diff --check` | passed |

The focused contracts exercised all six injected authority roots; traversal, absolute-path, symlink-destination, symlink-escape, cross-filesystem-staging, production-worktree, and unsupported-directory-fsync rejection; complete atomic bytes/JSON/image writes; explicit raw membership; interruption after every staged-bundle phase; corrupt/stale recovery handling; old-selection retention; and both allowed AE3 outcomes under concurrent same-dog work.

The only emitted warning was the pre-existing Starlette deprecation warning for FastAPI `TestClient` importing the legacy `httpx` adapter. It did not affect these filesystem results.

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| none selected | not applicable | Backend/filesystem-only behavior has no visual, interaction, motion, or gameplay artifact requiring a specialized reviewer. |

## Gaps

- None for the U2 headless-logic contract. No provider, publication, production-root, UI, or device action was in scope or performed.

## Next Action

None.
