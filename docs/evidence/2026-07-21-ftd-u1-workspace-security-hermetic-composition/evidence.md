---
status: passed
subject: FTD U1 workspace, security, and hermetic composition
created: 2026-07-21
mode: pipeline
---

# Evidence: FTD U1 workspace, security, and hermetic composition

## Verdict

Passed: focused installed-package, isolation, request-guard, redaction, contract, and fail-closed UI evidence confirms the U1 workspace and hermetic composition boundary without activating providers or writable authoring authority.

## Contract Classification

`headless-logic` — U1 establishes package, composition, filesystem-isolation, request-security, and secret-redaction contracts. Its fixture-only UI shell has no migrated authoring workflow; the separate aesthetics review found no blocking visual issues.

## What Changed

- Registered `tools/ftd-level-editor` as an npm workspace and an installable Hatch-mapped `backend/ftd_editor` Python distribution.
- Added immutable injected settings and app composition with disposable roots, empty stores, a manually stepped worker, and fail-closed providers.
- Added per-composition launch credentials with exact Host, Origin, preflight, and protected-route enforcement, plus central recursive secret redaction.
- Froze pure FTD prompt, geometry, model-option, route, and OpenAPI fixtures and added a fixture-only React shell that rejects ambient backend fallthrough.
- Kept feature handlers, persistent stores, automatic workers, provider implementations, static mounting, publication, and authority activation out of U1.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| backend contracts | `UV_CACHE_DIR=/private/tmp/ftd-u1-evidence-uv-cache uv run --locked --project tools/ftd-level-editor pytest tools/ftd-level-editor/tests/contracts/test_app_isolation.py tools/ftd-level-editor/tests/contracts/test_local_request_guard.py tools/ftd-level-editor/tests/contracts/test_secret_redaction.py tools/ftd-level-editor/tests/contracts/test_pure_ftd_parity.py` | passed: 25 tests; queued legacy-shaped SQLite sentinel stayed untouched, imports created no app/thread/ledger, providers failed closed, hostile Host/Origin/preflight/credential cases failed closed, and canary-secret API/log/persistence/evidence surfaces were clean |
| clean installed package | Built a wheel with `uv build --project tools/ftd-level-editor --wheel`, installed it with `pip --no-deps` into a fresh virtual environment, then imported `ftd_editor` and `ftd_editor.prompts/catalog.json` from an empty directory via `env -u PYTHONPATH` | passed: install and imports succeeded; the empty directory still contained no files, ledger, or database |
| generated contracts | `npm run editor:contracts:check -w @fabrikav2/ftd-level-editor` | passed: committed route, OpenAPI, prompt, geometry, and model fixtures match generated output |
| browser fixture unit tests | `npm run test:unit -w @fabrikav2/ftd-level-editor` | passed: 6 tests; exact scripted paths worked and unmatched API/assets/downloads plus cross-origin requests failed closed |
| UI static checks | `npm run typecheck -w @fabrikav2/ftd-level-editor` and `npm run lint -w @fabrikav2/ftd-level-editor` | passed |
| UI fixture build | `npm run build -w @fabrikav2/ftd-level-editor` | passed: Vite fixture build completed with 31 modules transformed |
| dependency audit | `npm audit --omit=dev` | passed: 0 production vulnerabilities |
| diff integrity | `git diff --check acc63eae..94d6cd16` and `git diff --check` | passed |
| scope isolation | `git diff --name-only 94d6cd16..HEAD -- tools/ftd-level-editor package.json package-lock.json` | passed: no later commit changed the U1 workspace or root manifests before this evidence artifact |

## Reviewer Assessments

No additional runtime reviewer was selected for this headless-logic evidence run. The existing independent image-only aesthetics review covered the fixture shell and reported no P1/P2 issues.

## Gaps

- None within U1. Live providers, persistent stores/workers, authoring handlers, publication, and authority activation are explicitly deferred and prohibited in this unit.

## Next Action

None.
