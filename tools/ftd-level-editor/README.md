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

## Real-data rehearsal

Build the live UI and start a separate v2 workspace from a one-time snapshot
of the current v1 authoring root:

```sh
npm run build:live -w @fabrikav2/ftd-level-editor
uv run --project tools/ftd-level-editor python \
  tools/ftd-level-editor/scripts/run_rehearsal.py \
  --source-authoring /absolute/path/to/v1/levels \
  --root /absolute/path/outside/git/ftd-editor-rehearsal \
  --env-file /absolute/path/to/operator.env \
  --port 5192
```

The explicit environment file must contain `OPENROUTER_API_KEY`. The launcher
copies v1 authoring once, excludes runnable v1 ledgers, refuses roots inside a
Git checkout, keeps v1 in `forbidden_roots`, starts one durable worker, and
does not compose publishing. Point Portal's optional `ftd_editor.backend_url`
at this loopback service and `ftd_editor.ui_root` at this package's `dist/`.

For the Mac mini production rehearsal, install or refresh the launchd service:

```sh
tools/ftd-level-editor/deploy/install-rehearsal.sh
```

The service listens only on loopback port `5192`, stores cloned v2 rehearsal
data under `~/.ftd-editor-rehearsal`, and leaves the v1 authoring root unchanged.

## Cutover

The migration is complete and merged; the frozen activation candidate is commit
`63b5af67` (recorded in the U9 evidence under
`docs/evidence/2026-07-22-ftd-u9-*`). The v1 Fabrika editor remains the sole
writable authority until the activation gate below is executed. The full
procedure with all preconditions is `docs/runbooks/ftd-editor-cutover.md`; this
section is the operator summary.

### 1. Rehearse (safe, repeatable, no authority change)

From the repository root, on a clean checkout of the exact candidate:

```sh
uv run --project tools/ftd-level-editor python tools/ftd-level-editor/scripts/rehearse_cutover.py \
  --source-authoring <live v1 authoring root, read-only> \
  --source-public    <v1 public corpus> \
  --target-public    games/find_the_dog/public/levels \
  --legacy-archive   <exported terminal-rows archive JSON (schema: tools/ftd-level-editor/cutover/legacy-archive.schema.json)> \
  --candidate-commit 63b5af67 \
  --output-root      <fresh disposable dir — the command refuses an existing one> \
  --evidence         <evidence dir>
```

The rehearsal clones authoring state, proves the clone is read-only, probes the
filesystem lock/rename/fsync contract, copies without any `jobs.sqlite*`, imports
only inert identity rows (replay lookups block duplicate paid work but can never
schedule it), enforces one worker owner, and drives two real loopback API
processes through lost-response persistence, induced outage, worker restart,
Request-ID rediscovery, export dry-run, and package validation. Review
`rehearsal.json` and `frozen-candidate.json`: zero unexplained census failures,
and `activation_allowed` must still read `false` — the rehearsal never grants
authority.

### 2. Activate (human-gated, one way past the first write)

Requires fresh explicit human approval; no card, hook, or agent may infer it.
In order, per the runbook: accept the cloned-session human journey; run the
approved minimum-cost check for every provider adapter plus the authenticated
non-mutating publisher readback; stop all v1 processes and make the v1 root
read-only, proving a mutation fails; drain to zero active/ambiguous jobs; copy
once to the approved target roots; start Factory2 read-only and repeat the
census, hash, and restart checks; then mint authority for exactly one writer.

Cutback is only possible **before** the first target authoring write (restore v1,
leave the target copy inert). After the first write, v1 is never restored as an
authority — keep target data and roll back Factory2 code only.
