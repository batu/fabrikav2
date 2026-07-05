# @fabrikav2/services

Backend-facing services, made game-agnostic. Holds the `analytics-worker` (FTD's
Cloudflare worker generalized to multi-game, keyed by `game_id`), `remote-config` (FTD's
schema/template service made game-agnostic), and a CDN asset manifest/cache layer decided
per pilot need (v1's version was FTD-only — whether it comes to v2 now or when a game needs
it is one of Batu's open decisions). These are the pieces games talk to over the network,
not code that ships inside the game bundle. See `docs/architecture/v2-architecture.md`
§packages/services.

_Stub — no implementation yet. Generalized from FTD by a later card._
