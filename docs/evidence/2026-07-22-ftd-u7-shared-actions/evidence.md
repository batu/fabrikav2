# Evidence: FTD U7 — Shared actions and dependency cleanup

- **Date:** 2026-07-22
- **Card:** QHlpqoFF ([FTD U7] Shared actions and dependency cleanup)
- **Branch:** trello-QHlpqoFF-ftd-u7-shared-actions-and-dependency-cle @ d0dedb28
- **Contract:** headless-logic (server-owned prompt intents, OpenAPI action discovery, import-boundary/dead-code cleanup — no visual runtime)
- **Status:** passed

## Verdict

Full safe backend/UI suite, contract-drift check, and targeted AE12/AE14 acceptance tests all pass on the U7 commit; the pinned `x-ftd-actions` OpenAPI extension is present (10 actions on `startFtdDurableAction`), LevelStore is absent from the backend, and the sessions barrel re-exports nothing.

## Evidence

All commands run in `tools/ftd-level-editor/` on this worktree, 2026-07-22.

| Check | Command | Result |
|---|---|---|
| Backend suite (safe markers) | `uv run pytest -m 'not legacy_census and not paid and not stress' -q` | **313 passed**, 20 deselected, exit 0 |
| AE12/AE14 targeted contracts | `uv run pytest tests/contracts/test_action_parity.py test_import_boundaries.py test_route_inventory.py test_structured_inpaint_intent.py -q` | **24 passed** (action parity incl. fresh-client discovery + stable-ID reorder; import boundaries; route inventory; structured intents fail-closed) |
| OpenAPI/type drift | `npm run editor:contracts:check` | no drift, exit 0 |
| UI unit tests (incl. wire-shape adapter parity) | `npm run test:unit` | **54 pass, 0 fail** |
| Typecheck | `npm run typecheck` | clean |
| Lint | `npm run lint` (eslint ui) | clean |
| Build | `npm run build` | built in 343ms |
| Pinned action catalog | inspect `openapi.json` | `x-ftd-actions` on `startFtdDurableAction` → 10 actions (single catalog per test_route_inventory) |
| LevelStore absent | `grep -rn LevelStore backend --include='*.py'` (non-test) | zero hits |
| No compatibility barrel | `backend/ftd_editor/sessions/__init__.py` | docstring only, re-exports nothing |

## Gaps / carry-forwards (out of U7 evidence scope, tracked on card)

- Real-browser Activity focus/aria-live journey: no feature UI mount exists yet to host it (U5-gap backstop; owed when a mount exists).
- `sprite_animate` still accepts `customPrompt` free text (animation scope, not scene/dog inpaint) — U8 candidate.
- Legacy full-corpus census (`legacy_census` marker) deferred to U9 rehearsal (needs external corpus).
- `levels-index.json` deletion still gated on U7/U8 consumer proof (plan F-line 334).

## Next action

None for this stage — proceed to review/merge.
