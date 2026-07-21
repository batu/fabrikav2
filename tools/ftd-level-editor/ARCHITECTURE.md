# FTD Editor Architecture

## Shape

The editor is one FTD-owned modular monolith: one FastAPI process, one React UI,
one deliberately single-owner in-process worker, one filesystem authoring authority,
and one SQLite job ledger. U3 now installs the lossless, revisioned current-session
boundary; the durable job ledger is still absent.

```text
React feature -> same-origin HTTP action -> thin FastAPI route
                                           |-> SessionStore (typed CAS + raw bundles)
                                           |-> durable jobs (later unit) -> provider adapter
                                           `-> pure FTD domain/prompt code

create_app(settings, components) may compose every layer.
Pure domain/prompts/models import no FastAPI, store, worker, provider, or UI code.
Job infrastructure must never import an FTD feature module.
```

There is no generic service layer, repository base class, dependency-injection
container, command bus, plugin registry, compatibility façade, or multi-game editor
framework.

## Composition and imports

`EditorSettings` and `WorkspacePaths` are frozen values created by the process
entrypoint or test. They contain explicit authoring, public, state, artifact, cache,
and lock roots. No module derives a path from `__file__`, parent depth, the current
working directory, or the legacy checkout.

Startup proves the configured filesystem supports exclusive locks, same-filesystem
replace, file fsync, and directory fsync. Production data is rejected beneath any
Git checkout or worktree. Every operational root remains beneath the stable data
root and is re-resolved before preparation so a late symlink cannot redirect it.
Path resolution is root-confined and rejects traversal or symlink escape.

## Atomic bundle boundary

`fs.py` owns the small durability primitives. Raw FTD bundle membership is staged
and hash-validated on the destination filesystem before an immutable candidate is
installed. Only a complete candidate may be exposed by its atomic selector. The
phase record (`staged`, `candidate_installed`, `selector_swapped`, `committed`) lets
startup roll an uncommitted selector back or retain a committed candidate. Prior
immutable revisions are never deleted by recovery. Directory components are created
and linked durably before a selector can become committed. Publication holds a
shared lifecycle lock; recovery takes the exclusive side so startup never treats an
active transaction as crash residue.

`SessionStore` owns current-session and same-dog process locks plus filesystem locks. Allocation,
dog image, crop box, sprite image/metadata, raw session bytes, job artifact, bundle
install, and selector commit all occur inside that reservation. This is deliberately
one FTD store rather than a second projection. Construction probes the approved
filesystem before any startup recovery may reconcile files.

The current-session revision hashes the complete session directory, including
unmanaged direct filesystem changes. Loads preserve exact source bytes and expose
typed known fields without expanding absent defaults. Existing-session writes use
compare-and-swap and return the current snapshot on conflict; creation separately
requires destination absence. Stable dog actions and gallery metadata mutations are
named operations, never a generic raw patch.

Legacy identity analysis is a separate read-only leaf. It accepts an explicit
corpus root, resolves referenced artifacts without following symlinks, classifies
stable/rebindable/ambiguous/unsupported sessions, and checks that the source tree
checksum did not change. It exposes no import or repair action.

`AppComponents` carries the injected store registry, worker, provider registry, and
central redactor. The default U1 test composition uses:

- `EditorStores`: explicitly composes the currently installed persistence authorities;
- `ManualWorker`: no thread and no startup loop;
- `FailClosedProviders`: every un-scripted provider lookup raises;
- `SecretRedactor`: sanitizes errors and persistence-shaped payloads before they
  cross an outward boundary.

Importing any backend module reads only package-owned static prompt data. It creates
no runtime object and starts no lifecycle.

## Local trust boundary

The loopback process generates a random launch credential for each app composition.
The request guard executes before routing:

1. require an exact allowed `Host` value (DNS-rebinding defense);
2. reject any non-matching `Origin`;
3. require an allowed Origin on mutating methods;
4. answer only narrow, same-origin preflights;
5. require the launch credential header for API, asset, and download paths.

The same-origin `/bootstrap` response is the only credential delivery path. It is
Host/Origin guarded, `no-store`, and `no-referrer`. Credentials in URLs are never
accepted. Remote exposure stays disabled unless a later, separately reviewed mode
adds authentication and transport requirements.

## Secret boundary

Provider/publisher secrets are `SecretValue` composition inputs. Their string and
representation forms are redacted, and they are not Pydantic/OpenAPI fields.
`SecretRedactor` recursively sanitizes untrusted text for API errors, logs, durable
events, SQLite metadata, artifacts, and evidence. Later persistence code must call
this boundary before writing; it must not grow feature-local scrubbers.

## Pure FTD leaves

- `domain/geometry.py`: FTD HUD/banner/safe-area and three-section geometry.
- `prompts/recipes.py` + `prompts/catalog.json`: server-owned FTD scenes, style,
  entity, hidden-object composition, and entity inpaint recipes. Provider invocation
  is intentionally excluded.
- `models/options.py`: the existing v1 model IDs/labels as an environment-free
  registry. Composition supplies provider capabilities instead of modules reading
  API-key environment variables.

These modules are final dependency leaves for later feature ports. They remain FTD
specific even where reliability infrastructure becomes reusable inside this tool.

## Deferred boundaries

- U4 adds the durable SQLite attempt ledger and single-owner worker.
- U5-U7 add named FTD handlers and direct feature modules.
- U8 adds publishing/schema/CI ownership.
- U9 rehearses cutover without changing authority.

None of those deferrals permit target code to import or write the legacy editor.
