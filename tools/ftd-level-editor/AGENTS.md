# Find the Dog Editor Agent Guide

This is an internal FTD authoring and publishing tool, not a generic game editor.

## Non-negotiable boundaries

- Treat `/Users/base/dev/appletolye/fabrika` as read-only prior art and explicit
  fixture input. Never import it at runtime, write it, or discover it by path.
- Compose through `create_app` with explicit settings, stores, worker, providers,
  publisher, and secret redactor. Imports create no runtime state.
- Tests use disposable roots, fail-closed providers, and scripted publishers. Never
  point tests at ambient services, production roots, live credentials, or user data.
- An ambiguous publish remains pending/reconciling. Reconcile through exact remote
  readback; never retry publication blindly.
- Publish and rollback require a fresh server-held Approval Grant bound to action,
  actor, digest, and source revision. Caller role claims are not authority; the
  generic agent grant route must reject publication actions.
- Protected publication requests persist a stable Request ID. Replays return the
  existing saga and never invoke the publisher again.
- Keep FTD schema, dogs, geometry, hitboxes, cohorts, tombstones, starters,
  packages, and sequence semantics explicit. Do not introduce a framework.
- Preserve the existing dependency set. A new dependency is a stop condition.
- Do not delete `levels-index.json` until runtime, create-game scaffold,
  generated-evidence, and publishing consumers all prove it unnecessary.

## Dependency direction

- `app.py` composes; routes validate/translate and delegate.
- `publishing/level_schema.py`, `catalog.py`, and geometry validation are pure leaves.
- `PublishingService` owns preview/saga/selection persistence and injected publisher
  calls; UI and routes do not write manifests directly.
- Only `SessionStore` owns authoring-session locks and mutation.
- Job infrastructure imports no FTD feature module.
- Browser fixtures enumerate allowed paths and fail on every unmatched protected
  request.

## Verification

Run `npm run editor:verify` from the repository root. It is provider-free and
includes schema/OpenAPI/type drift, public geometry/catalog validation, backend
contracts, UI contracts, lint, and build. If public runtime bytes or schema behavior
intentionally change, the later initiative gate must capture real-device proof;
desktop browser evidence is never a proxy for the mobile game.
