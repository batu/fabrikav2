# Evidence: FTD U7 — Shared actions and dependency cleanup

- **Date:** 2026-07-22
- **Card:** QHlpqoFF ([FTD U7] Shared actions and dependency cleanup)
- **Branch:** trello-QHlpqoFF-ftd-u7-shared-actions-and-dependency-cle (reviewed from 8d63a9d2)
- **Contract:** headless-logic (server-owned prompt intents, OpenAPI action discovery, import-boundary/dead-code cleanup — no visual runtime)
- **Status:** verification passed; acceptance blocked in review

## Verdict

The full safe backend/UI suite, contract-drift check, and targeted AE12/AE14 contract tests pass after review fixes. The pinned `x-ftd-actions` OpenAPI extension is present (10 actions on `startFtdDurableAction`), LevelStore is absent from the backend, and the sessions barrel re-exports nothing.

Review did not certify the U7 acceptance claim: the test named as a fresh-client edit-and-capture journey only calls `getCurrentSession`. It observes edited session metadata, not a revision-bound image capture. Implementing that missing operation requires an explicit public contract decision, so the card must return to planning rather than treating the passing test as capture evidence.

## Evidence

All commands ran from this worktree on 2026-07-22; workspace-scoped commands target `tools/ftd-level-editor/`.

| Check | Command | Result |
|---|---|---|
| Backend suite (safe markers) | `uv run --project tools/ftd-level-editor pytest tools/ftd-level-editor/tests -m 'not legacy_census and not paid and not stress' -q` | **331 passed**, 20 deselected, exit 0 |
| AE12/AE14 contract coverage | included in the safe backend suite | action discovery, stable-ID reorder, import boundaries, route inventory, and structured intents pass; the purported capture assertion is not capture proof |
| OpenAPI/type drift | `npm run editor:contracts:check` | no drift, exit 0 |
| UI unit tests (incl. wire-shape adapter parity) | `npm run test:unit -w @fabrikav2/ftd-level-editor` | **55 pass, 0 fail** |
| Typecheck | `npm run typecheck` | clean |
| Lint | `npm run lint` (eslint ui) | clean |
| Build | `npm run build -w @fabrikav2/ftd-level-editor` | clean fixture build |
| Repository-wide lint | `npm run lint` | **not clean due to unrelated pre-existing errors** in `games/find_the_dog` and a missing root config imported by `tools/native-shell`; the editor workspace itself is clean |
| Pinned action catalog | inspect `openapi.json` | `x-ftd-actions` on `startFtdDurableAction` → 10 actions (single catalog per test_route_inventory) |
| LevelStore absent | `grep -rn LevelStore backend --include='*.py'` (non-test) | zero hits |
| No compatibility barrel | `backend/ftd_editor/sessions/__init__.py` | docstring only, re-exports nothing |

## Review fixes

- Closed scene and dog intents over the frozen catalogs so unknown values cannot fall through as provider prompt text.
- Replaced caller-owned band `sceneMeta` with a catalog-owned `sceneIntent`; multi-scene and sequence workflows now reject client prompt keys and resolve every prompt before the first provider submission.
- Corrected the UI durable-start adapter payloads to match the backend contract.
- Reused the bounded, credentialed HTTP transport for gallery mutations and covered stalled-request abort behavior.

## Blocking acceptance gap

- `tests/contracts/test_action_parity.py` labels `getCurrentSession` as capture. No revision-bound image-capture operation is discovered or exercised, so the required unpaid UI/direct-client parity journey remains unproved.

## Gaps / carry-forwards (tracked on card)

- Real-browser Activity focus/aria-live journey: no feature UI mount exists yet to host it (U5-gap backstop; owed when a mount exists).
- `sprite_animate` still accepts `customPrompt` free text (animation scope, not scene/dog inpaint) — U8 candidate.
- Legacy full-corpus census (`legacy_census` marker) deferred to U9 rehearsal (needs external corpus).
- `levels-index.json` deletion still gated on U7/U8 consumer proof (plan F-line 334).

## Next action

Return to planning to define the revision-bound image-capture operation and its UI/direct-client parity journey without inventing a shadow catalog or widening U7 implicitly.
