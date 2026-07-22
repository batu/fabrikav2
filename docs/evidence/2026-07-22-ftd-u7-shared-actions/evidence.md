---
status: passed
subject: FTD U7 shared actions, dependency cleanup, and revision-bound capture
created: 2026-07-22
mode: pipeline
---

# Evidence: FTD U7 shared actions, dependency cleanup, and revision-bound capture

## Verdict

Fresh headless-logic evidence confirms the reviewed U7 capture repair: a client using the pinned OpenAPI contract can make a stable-ID edit and receive the exact current-session PNG at the edited revision, while the typed gallery feature adapter exposes the same binary/revision/source/checksum facts and the full safe editor suite remains green.

## What Changed

- Added `POST /api/sessions/{session_id}/capture` (`captureCurrentSessionImage`) with a required Session Revision and six named FTD capture variants.
- Ported the v1 gallery-preview source precedence into `SessionStore` while keeping capture read-only, root-confined, no-follow, and protected by before/after revision checks.
- Pinned the binary response and cost, side-effect, revision, artifact, and authorization extensions in `openapi.json`, then regenerated TypeScript wire types.
- Pinned the ordinary missing-image `404`, generated the binary response headers/media type into TypeScript, and rejected malformed or over-limit capture candidates before returning bytes.
- Added a UI gallery adapter over the shared credentialed, bounded HTTP transport.
- Replaced the false fresh-client capture alias with observed image bytes plus revision, source, and SHA-256 response proof.

## Evidence Captured

| Type | Artifact / Command | Result |
|---|---|---|
| full safe backend suite | `UV_CACHE_DIR=/private/tmp/ftd-u7-review-uv uv run --project tools/ftd-level-editor pytest tools/ftd-level-editor/tests -m 'not legacy_census and not paid and not stress' -q` | passed: **344 passed**, 20 deselected; no provider call or spend |
| focused capture/parity/boundary contracts | `uv run --project tools/ftd-level-editor pytest` over `test_session_capture.py`, `test_action_parity.py`, `test_route_inventory.py`, and `test_import_boundaries.py` | passed: **25 passed**; exact PNG bytes and revision/source/SHA-256 headers observed; stale revision returns current snapshot; symlink/malformed/over-limit sources rejected or safely fall back; no derivative or lock write |
| UI adapter parity | `npm run test:unit -w @fabrikav2/ftd-level-editor` | passed: **57/57**; gallery capture uses generated binary response facts, rejects media-type drift, and shares the bounded transport |
| OpenAPI/type drift | `npm run editor:contracts:check -w @fabrikav2/ftd-level-editor` | passed: pinned fixture has no drift |
| TypeScript | `npm run typecheck -w @fabrikav2/ftd-level-editor` | passed |
| Editor lint | `npm run lint -w @fabrikav2/ftd-level-editor` | passed |
| Fixture build | `npm run build -w @fabrikav2/ftd-level-editor` | passed: Vite fixture build completed |
| pinned capture discovery | inspected `openapi.json` operation `captureCurrentSessionImage` | passed: `image/png` binary response plus typed `404`; generated response headers/media type; `x-ftd-cost=none`, `x-ftd-side-effects=none`, `x-ftd-revision=bound`, `x-ftd-artifacts=inline-image`, `x-ftd-authorization=launch-credential` |
| direct dependency boundaries | focused `test_import_boundaries.py`, `rg -n "LevelStore"` in backend/UI, and inspection of `sessions/__init__.py` | passed: forbidden imports rejected, no `LevelStore` hit, and the sessions package re-exports nothing |
| dead-code inventory | `npx knip --workspace tools/ftd-level-editor` | known non-capture inventory remains (`Activity.tsx`, `revisionConflict.tsx`, observer exports, generated wire types, and the package's `uv` binary); no capture file/export is reported |
| patch hygiene | `git diff --check` | passed |

## Runtime Contract Observed

The focused API tests start the injected FastAPI app against disposable roots and exercise the public operation. The successful response contains the exact source PNG bytes and pins these facts in response headers:

- session identity
- exact captured Session Revision
- v1-compatible session-relative source filename
- SHA-256 digest of returned bytes

The tests also observe a typed `409` with the current snapshot for a stale revision; a pinned `404` for missing, symlink-only, or over-limit sources; all six v1 source precedence mappings; malformed-primary fallback; and no `.gallery_previews` or lock write. This is the real API boundary for the changed behavior; no mobile-game or rendered UI surface changed, so device/ADB evidence is not applicable.

## Reviewer Assessments

No visual, interaction, motion, or gameplay reviewer applies to this headless HTTP/client-contract delta. The next TWF stage owns code review of the binary contract, revision/TOCTOU behavior, pinned discovery, and UI/direct-client parity.

## Gaps

- None in the revision-bound capture repair or its U7 headless-logic contract.

Tracked later-unit and mount-dependent deferrals remain unchanged: the Activity focus/aria-live browser journey awaits a real feature mount; `sprite_animate.customPrompt` is a U8 policy decision; full-corpus `legacy_census` belongs to U9 rehearsal; and `levels-index.json` deletion remains behind the U7/U8 consumer gate.

## Next Action

None for evidence. Advance to code review of commit `09eb8d7b` and this updated artifact.
