# @fabrikav2/services

Backend-facing services, made game-agnostic. Holds the `analytics-worker` (FTD's
Cloudflare worker generalized to multi-game, keyed by `game_id`), `remote-config` (FTD's
schema/template service made game-agnostic), and a CDN asset manifest/cache layer decided
per pilot need (v1's version was FTD-only — whether it comes to v2 now or when a game needs
it is one of Batu's open decisions). These are the pieces games talk to over the network,
not code that ships inside the game bundle. See `docs/architecture/v2-architecture.md`
§packages/services.

## `analytics-worker` (`@fabrikav2/services/analytics-worker`)

FTD's Cloudflare owned-analytics ingest worker generalized to serve **many
games from one deployment**. Every batch carries a `game_id` (keys storage,
scopes rate-limit + replay) and an `env` marker (`production` |
`development` | `test`) that partitions dev/test SDK verification out of
production data — the decision-doc 'SDK test credentials' guardrail, promoted
from a credential-level convention to a validated field of the ingest contract.
Wire format tag: `fabrika-owned-analytics-v1`.

- Ingest: `POST /ingest` — auth (public client key), abuse gates (oversize,
  malformed, duplicate/replayed `dedupe_key`, clock skew, per-(game,key,ip)
  rate limit), then Analytics Engine (default) or D1 (fallback) storage.
- Query: `GET /v1/query/funnel?game_id=…&env=…&start_ms=…&end_ms=…` — operator
  funnel reads with low-N suppression, freshness, and trust labels.
- Budget: per-game volume/D1 budget constants ported verbatim from FTD.
- Deploy is **Batu's**: `src/analytics-worker/wrangler.template.toml` is a
  placeholder template (no account ids, no secrets). Code + tests only.

## `remote-config` (`@fabrikav2/services/remote-config`)

FTD's Firebase-welded, 60-key remote-config service distilled to a
game-agnostic, **schema-declared** typed service. A game declares its flags
(`booleanField` / `numberField` / `stringField`, each with a default and an
optional domain `validate`); both the value type and the runtime validation
fall out of that one declaration. The Firebase SDK is pushed behind a
`RemoteConfigProvider` seam so it unit-tests with zero network and any game can
wire any backend. Consumed by sdk/ads cadence + ui offers.

**Fallback contract:** a key resolves to its remote value only when the
provider delivered a value that coerces to the declared type and passes
`validate`; absent / wrong-type / failed-validate all fall back to the declared
default, and a failed refresh keeps the last good values.

## Verify

```
npm run typecheck --workspace=packages/services
npm run test:unit --workspace=packages/services
```
