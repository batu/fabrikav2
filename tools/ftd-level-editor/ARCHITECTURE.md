# FTD Editor Architecture

## Authorities and dependency direction

```text
React feature -> typed same-origin FTD action -> thin FastAPI route
                                                |-> SessionStore (authoring CAS)
                                                |-> JobStore/worker (attempts/events)
                                                `-> PublishingService
                                                    |-> public schema + geometry
                                                    |-> immutable candidates
                                                    |-> catalog/sequence selection
                                                    `-> injected publisher readback
```

Four authorities stay separate: authoring session files, SQLite jobs/events,
the public level schema, and immutable packages plus selection manifests. There is
no LevelStore projection, generic command bus, plugin registry, compatibility
facade, service split, or multi-game editor abstraction.

`create_app(settings, components)` is the only composition boundary. Routes do not
discover paths or providers. Pure schema/catalog/geometry modules import neither
FastAPI nor job infrastructure. Job infrastructure imports no FTD feature module.

## Publication lifecycle

1. Validate public schema, baked/native geometry, catalog, starters, and ordered
   sequence input before a selection can change.
2. Persist an immutable canonical preview. Its SHA-256 binds actor, changelog,
   ordered level IDs, catalog revision, and remote base revision.
3. Consume a server-held, single-use Approval Grant for `publish_sequence` or
   `rollback_sequence`, bound to the candidate digest and source revision.
4. Persist `pending_remote` before calling an explicitly configured publisher.
5. A definite rejection records `failed` and preserves current selection. A timeout
   records `reconciling`; restart calls readback only, never publish.
6. Only an exact digest/version/base match reaches `remote_committed`, then local
   atomic finalization selects the immutable candidate. A crash before finalization
   remains recoverable through the same exact readback.
7. Rollback runs the same protected lifecycle against an eligible retained
   candidate and never edits its bytes.

Default composition has no publisher. `ScriptedPublisher` is a deterministic test
fixture, not an autonomous loop and not a network adapter.

## Contracts and CI

- `openapi.json` and `ui/src/api/generated.ts` derive from the fully composed,
  provider-free contract app.
- `publishing/level_schema.py` generates the game runtime `LevelFileV1` type.
- `verify_public_levels.py` validates every committed level, extension geometry,
  catalog, and the intentional `levels-index.json` retention gate.
- Root `npm run editor:verify` is the one focused local/CI entry point.
- CI gives the Python/editor aggregate its own job because npm workspace discovery
  alone cannot observe Python contract drift.

Production roots remain explicit, outside Git worktrees, and filesystem-probed.
Provider/publisher secrets stay backend-only and pass through the central redactor
before errors or durable state. U8 changes no runtime authority and performs no
remote call.
