# Find the Dog Level Editor

Factory2 owns this FTD-specific authoring and publishing tool. It is one FastAPI
process, one React UI, one revisioned filesystem session authority, one SQLite job
ledger, and one validated public package/manifest authority. Importing the package
creates no app, worker, provider, store, or filesystem root.

The Fabrika editor is read-only prior art. This workspace never imports it at
runtime, shares its roots, copies its data, or changes live authority.

## Publishing contract

- `publishing/level_schema.py` is the public `level.json` source of truth. It
  deterministically generates `games/find_the_dog/src/data/generated/levelFile.ts`.
- Geometry validation rejects out-of-bounds hitboxes, broken cleanup regions,
  non-contiguous sections, and inconsistent native-to-baked extension transforms.
- `publishing/export.py` validates complete assets before installing an immutable
  content-addressed package through same-directory atomic staging.
- Catalog validation keeps package identity, listability, tombstones, cohorts,
  bundled starters, active versions, and rollback retention explicit.
- A publication preview binds actor, changelog, ordered level IDs, catalog/base
  revisions, and digest. Publish and rollback consume a fresh single-use Approval
  Grant bound to that exact digest and revision. The generic agent approval route
  cannot mint publication grants; the human publishing surface requires a distinct
  operator-supplied credential that is never returned by bootstrap, plus explicit
  digest confirmation.
- Remote publication is fail-closed unless composition explicitly supplies an
  authenticated publisher. Tests use only `ScriptedPublisher`; the default app
  cannot contact a provider.
- Ambiguous remote outcomes stay `reconciling`. Restart reconciliation performs
  exact readback and never calls publish again. Local selection changes only after
  the exact remote digest is confirmed. A persisted Request ID makes response-loss
  replay return the existing saga instead of submitting again.
- Rollback selects a retained immutable candidate without rewriting package bytes.
- `levels-index.json` intentionally remains while `tools/create-game` still emits
  it; deletion requires all runtime, scaffold, evidence, and publishing gates.

## Agent and human surface

OpenAPI is the discoverability authority for session edits, revision-bound image
capture, export dry-run, publishing preview, activation, rollback, and reconciliation.
Generated editor wire types drift-check against the pinned OpenAPI document.

The React publishing desk exposes changelog and digest review, exact Approval Grant
text, pending/reconciling/remote-confirmed/finalizing/succeeded/failed states,
readback recovery, current selection, retained versions, and rollback. Status is
announced in words through a polite live region and async results receive keyboard
focus. The fixture is exact and provider-free; unmatched protected calls throw.

## Verification

From the repository root:

```sh
npm run editor:verify
```

The aggregate runs pinned OpenAPI/type drift, pure FTD fixtures, generated public
schema drift, public corpus geometry/catalog asset hash checks, the safe provider-free backend
suite, UI typecheck/unit/lint/build, and no remote publication. Useful focused lanes:

```sh
npm run editor:publishing:test -w @fabrikav2/ftd-level-editor
npm run editor:schema:check -w @fabrikav2/ftd-level-editor
npm run editor:contracts:check -w @fabrikav2/ftd-level-editor
```

Schema/OpenAPI rewrites are explicit review operations:

```sh
npm run editor:schema:write -w @fabrikav2/ftd-level-editor
npm run editor:contracts:write -w @fabrikav2/ftd-level-editor
```

No command above uses live credentials, provider spend, remote publication,
production roots, or the legacy corpus.
