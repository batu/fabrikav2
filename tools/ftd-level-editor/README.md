# Find the Dog Level Editor

This workspace is the Factory2 home for the Find the Dog authoring tool. U1
established its hermetic composition and local-request boundary. U2 added approved
operational roots, durable atomic writers, recoverable raw bundles, and one
same-dog reservation boundary. U3 adds the target's lossless current-session and
optimistic-revision contract. It does **not** activate Factory2 as the live
authoring authority.

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
- `AuthoringSession` preserves unknown fields, missing versus null, and null versus
  variant `0`; an unchanged parse/serialize round trip returns the original bytes.
- `SessionStore` is the only current-session writer. Every existing-session mutation
  requires a collision-framed whole-directory revision that includes empty folders,
  symlinks, and special entries. Descriptor-relative no-follow reads and atomic
  writes prevent session-path swaps from escaping the approved root; direct drift
  and stale writers produce a conflict containing the current typed snapshot.
- New sessions are fully staged before one durable destination-absence rename, and
  startup removes abandoned creation stages. A failure after that rename is exposed
  as an indeterminate commit instead of a false rollback. Dog-bundle builders are
  preflighted against one stable dog and source revision, then the revision is
  checked again under the session lock before work starts and before selection. The
  builder's session payload must preserve the exact source mapping and change only
  the allocated dog's active variant.
- Every supported live writer must use `SessionStore` locks. Raw/manual filesystem
  edits are an offline-only operation: stop the editor first, edit, then restart so
  the next revision is computed from a stable tree. No compare-and-swap protocol can
  make arbitrary non-cooperating filesystem writes atomic.
- A durability failure after any atomic session replacement is returned as an
  indeterminate commit; clients must reload the current snapshot before deciding
  whether to reapply pending intent.
- Current-session routes are named FTD actions. Stable dog IDs, rather than array
  indexes or a generic patch endpoint, address dog mutations. UI conflict state keeps
  the rejected intent inert until the author explicitly reapplies or discards it.
- `sessions/legacy_identity.py` accepts only an explicit corpus root and returns an
  in-memory checksummed stable/rebindable/ambiguous/unsupported census. It records
  live and tombstone dog-folder inventory, active/fallback variant provenance,
  positional permutations, dangling entries, target-ID mismatches, and referenced
  artifacts without following symlinks. It never repairs, imports, quarantines, or
  writes the source corpus.
- Providers fail closed unless composition installs a scripted adapter. The current
  worker advances only when a test or caller invokes `step()`.
- `/bootstrap` delivers one per-app launch credential after exact Host/Origin
  checks. `/api`, `/assets`, and `/downloads` require that credential in the
  `X-FTD-Launch-Credential` header. Query credentials are unsupported.
- `ui/` builds against an exact fail-closed fixture. Unmatched protected requests
  throw instead of proxying to localhost.

Paid feature handlers, the durable job ledger/worker, static mounting, publishing,
and live-authority activation intentionally arrive in later migration units.

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
  tools/ftd-level-editor/tests/contracts/test_session_roundtrip.py \
  tools/ftd-level-editor/tests/contracts/test_session_revision.py \
  tools/ftd-level-editor/tests/contracts/test_session_drift.py \
  tools/ftd-level-editor/tests/contracts/test_session_actions.py

UV_CACHE_DIR=/private/tmp/ftd-editor-uv-cache \
  uv run --project tools/ftd-level-editor pytest \
  tools/ftd-level-editor/tests -m legacy_census

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
