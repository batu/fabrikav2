# Find the Dog Level Editor

This workspace is the Factory2 home for the Find the Dog authoring tool. U1
establishes its installable backend, hermetic composition boundary, local-request
guard, frozen pure-FTD contracts, and provider-free UI shell. It does **not** make
Factory2 a writable authoring authority yet.

The legacy editor under the Fabrika checkout is read-only prior art and fixture
input. Target runtime code never imports it, locates it, or shares its roots or
ledger.

## Current boundary

- `backend/ftd_editor/` is an installable Hatch package. Importing it creates no
  app, worker, provider, store, mount, or filesystem root.
- `create_app(settings, components)` is the only FastAPI composition seam.
- Test and development settings put every mutable root below one disposable root.
- Providers fail closed unless composition installs a scripted adapter. The U1
  worker advances only when a test or caller invokes `step()`.
- `/bootstrap` delivers one per-app launch credential after exact Host/Origin
  checks. `/api`, `/assets`, and `/downloads` require that credential in the
  `X-FTD-Launch-Credential` header. Query credentials are unsupported.
- `ui/` builds against an exact fail-closed fixture. Unmatched protected requests
  throw instead of proxying to localhost.

Feature handlers, persistent stores, static mounting, and writable authoring
operations intentionally arrive in later migration units.

## Checks

From the repository root:

```sh
UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache \
  uv run --project tools/ftd-level-editor pytest \
  tools/ftd-level-editor/tests/contracts/test_app_isolation.py \
  tools/ftd-level-editor/tests/contracts/test_local_request_guard.py \
  tools/ftd-level-editor/tests/contracts/test_secret_redaction.py \
  tools/ftd-level-editor/tests/contracts/test_pure_ftd_parity.py

npm run editor:contracts:check -w @fabrikav2/ftd-level-editor
npm run test:unit -w @fabrikav2/ftd-level-editor
npm run typecheck -w @fabrikav2/ftd-level-editor
npm run build -w @fabrikav2/ftd-level-editor
git diff --check
```

The fixture build is deliberately provider-free. It renders the composition status
only and cannot fall through to a developer backend.

## Frozen v1 inputs

`prompts/catalog.json` is generated from the pure literal catalog in the read-only
v1 prompt module. `tests/fixtures/pure-ftd-parity.json` records the source hash,
prompt/geometry/model snapshots, route inventory, and OpenAPI hash. Regeneration
requires an explicit legacy source path; the normal check uses only committed target
artifacts:

```sh
UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache \
  uv run --project tools/ftd-level-editor python \
  tools/ftd-level-editor/tests/fixtures/extract_prompt_catalog.py \
  --source /explicit/read-only/v1/dog_pipeline/utils/prompts.py \
  --output tools/ftd-level-editor/backend/ftd_editor/prompts/catalog.json
```

Do not run that regeneration casually: a v1 source change is a contract review, not
a routine formatting step.
