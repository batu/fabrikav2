# Find the Dog Level Editor

This workspace is the Factory2 home for the Find the Dog authoring tool. U1
established its hermetic composition and local-request boundary. U2 adds approved
operational roots, small durable atomic writers, recoverable raw bundles, and one
same-dog reservation boundary. It does **not** make Factory2 a writable authoring
authority yet.

The legacy editor under the Fabrika checkout is read-only prior art and fixture
input. Target runtime code never imports it, locates it, or shares its roots or
ledger.

## Current boundary

- `backend/ftd_editor/` is an installable Hatch package. Importing it creates no
  app, worker, provider, store, mount, or filesystem root.
- `create_app(settings, components)` is the only FastAPI composition seam.
- Test and development settings put every mutable root below one disposable root.
- Production roots are explicit siblings below one stable data root, are rechecked
  for symlink drift and Git checkout/worktree overlap, and are accepted only after
  live locking, same-filesystem replace, file-fsync, and directory-fsync probes.
- JSON, bytes, and image writers use a same-filesystem temporary sibling, fsync it,
  atomically replace the destination, and fsync every created or changed directory
  entry needed to reach it.
- Complete session-edit, dog-variant, public-package, and manifest-set membership is
  staged into immutable directories. A recovery record and atomic selector ensure
  startup keeps the prior committed revision after any interrupted phase.
- `SessionStore` holds one process/file reservation from same-dog variant allocation
  through selector commit, yielding distinct complete bundles or an explicit reject.
  It approves the filesystem before recovery; publication holds a shared store
  lifecycle lock while startup recovery takes the exclusive side.
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
  tools/ftd-level-editor/tests/contracts/test_pure_ftd_parity.py \
  tools/ftd-level-editor/tests/contracts/test_workspace_paths.py \
  tools/ftd-level-editor/tests/contracts/test_atomic_publication.py \
  tools/ftd-level-editor/tests/contracts/test_bundle_recovery.py \
  tools/ftd-level-editor/tests/contracts/test_variant_reservation.py

UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache \
  uv run --project tools/ftd-level-editor pytest \
  tools/ftd-level-editor/tests -m stress --count=20

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
