# Find the Dog Editor Agent Guide

This is an internal FTD authoring tool, not a generic game-editor platform.

## Non-negotiable boundaries

- Treat `/Users/base/dev/appletolye/fabrika` as read-only prior art and explicit
  fixture input. Never import it at runtime, write it, or discover it by path.
- Compose through `create_app` with explicit settings, stores, worker, providers,
  and secrets. Backend imports must not create runtime state.
- Tests use one disposable root and fail-closed providers. Do not point tests at an
  ambient editor, developer backend, user data root, or production ledger.
- Keep provider and publisher credentials backend-only. Sanitize untrusted text at
  the central `SecretRedactor` boundary before API, log, SQLite, event, artifact, or
  evidence output.
- Keep the exact existing v1 dependency set. A new dependency is a stop condition,
  not an implementation convenience.
- Preserve FTD names and semantics for dogs, prompts, geometry, hitboxes, variants,
  and publishing. Do not add a command bus, plugin system, service split, generic
  repository layer, compatibility façade, or multi-game abstraction.

## Dependency direction

- `app.py` composes; routes stay thin.
- Domain, prompts, and model options are pure leaves.
- Job infrastructure imports no FTD feature module.
- Only `SessionStore` owns authoring-session locks and mutation. U2's store shell
  handles raw bundle reservation/publication; U3 adds typed session revisions.
- Browser fixtures list allowed paths exactly and reject everything else.

## Verification

Use the commands in `README.md`. Provider calls, remote publication, credentials,
production roots, and the legacy corpus are never part of the default test lane.
When a real integration seam is added, record its first live run separately; mocked
tests do not prove that seam.
