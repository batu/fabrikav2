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

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| focused U3 contracts | `UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache PYTHONDONTWRITEBYTECODE=1 uv run --project tools/ftd-level-editor pytest -q tools/ftd-level-editor/tests/contracts/test_session_roundtrip.py tools/ftd-level-editor/tests/contracts/test_session_revision.py tools/ftd-level-editor/tests/contracts/test_session_drift.py tools/ftd-level-editor/tests/contracts/test_session_actions.py` | passed: 14 tests in 0.17s |
| safe backend regression lane | `UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache PYTHONDONTWRITEBYTECODE=1 uv run --project tools/ftd-level-editor pytest -q tools/ftd-level-editor/tests -m 'not paid'` | passed: 80 tests in 0.81s; no paid marker ran |
| read-only census fixtures | `UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache PYTHONDONTWRITEBYTECODE=1 uv run --project tools/ftd-level-editor pytest -q tools/ftd-level-editor/tests -m legacy_census` | passed: 2 tests, 78 deselected; stable/rebindable/ambiguous/unsupported and unsafe-artifact cases classified with zero unexplained issues |
| repeated race/crash lane | `UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache PYTHONDONTWRITEBYTECODE=1 uv run --project tools/ftd-level-editor pytest -q tools/ftd-level-editor/tests -m stress --count=20` | passed: 40 tests, 1560 deselected, in 2.84s |
| live v1 current-session census | `census_legacy_sessions(Path('/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/levels'))` under the target U3 package | passed: source `sha256:c4650e7275eb0a101f416eddaf430818708158cde552cc39488197a79f78ec3d`; report `sha256:fd453dbb461dea050f6821021257a597ca6f8a5cc4cec63eadf22c3c07de026d`; 0 current sessions; 0 unexplained |
| live source no-write snapshot | full path metadata plus file-byte digest before/after the census | passed: 2 entries and identical `sha256:d61f43dc7472ee4d129cb34a25c6a14aab489809fc7dadbbf8a8efefa70bbb8d` snapshots |
| UI conflict contract | `npm --workspace tools/ftd-level-editor run test:unit -- --test-name-pattern='revision conflict'` | passed: 9 tests; pending intent was not automatically resubmitted, reapply used the current revision, and discard refreshed without mutation |
| generated editor contract | `npm --workspace tools/ftd-level-editor run editor:contracts:check` | passed |
| UI static checks | `npm --workspace tools/ftd-level-editor run typecheck` and `npm --workspace tools/ftd-level-editor run build` | passed; fixture build transformed 31 modules |
| backend syntax and patch hygiene | `uv run --project tools/ftd-level-editor python -m compileall -q tools/ftd-level-editor/backend/ftd_editor` and `git diff --check 654966ff..HEAD` | passed |

The focused contracts directly exercised AE9 through byte-identical old/unknown/sentinel round trips, AE10 through stale and concurrent writers, and AE11 through retained paid-artifact bytes with withheld stale application. They also proved destination-absence creation, same-value no-op revision stability, missing-to-null mutation semantics, current typed snapshots in HTTP 409 responses, stable-ID action routes, and the absence of raw patch/import/repair/archive-resurrection routes.

The explicit v1 current root contained one non-session file (`japanese_village_ids.json`) and no `session.json` files at capture time. Reading the complete configured current root still produced stable before/after metadata-plus-byte snapshots and deterministic source/report checksums. Nonempty historical sessions remain under archive roots and were intentionally excluded because archive/public resurrection and import are outside U3.

The only emitted test warning was the existing FastAPI `StarletteDeprecationWarning` for the `httpx` TestClient adapter. It did not affect the assertions.

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| none selected | not applicable | This is a headless session/revision/census contract. The conflict panel is intentionally unmounted, so no rendered interaction, visual, motion, or gameplay artifact changed. |

## Gaps

- None within U3. The nonempty full-corpus cutover rehearsal remains the explicit U9 gate; U3 proves the classification/no-write mechanism with deterministic fixtures and the complete currently configured v1 current-session root.

## Next Action

None.
