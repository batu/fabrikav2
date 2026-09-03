# Find Games provider operations

`find-games-provider-ops` is a deterministic readiness check for the provider workspace used by Find the Dog and Find the Bird. It validates non-secret identity configuration, credential *locators*, the live Chrome tab contract, and optional API reachability without printing credential contents.

A passing health check is **not analytics proof**. It proves that a source can be reached or that a browser fallback is present. A metric is current only when the resulting report records the provider source, observation time, requested reporting window, and game identity for the metric itself.

## Commands

Run the read-only health check against the canonical Chrome workspace:

```bash
node tools/find-games-provider-ops/cli.mjs health
```

Run real read-only AppsFlyer, Meta, and App Store Connect API probes when their reporting credentials are available:

```bash
FIND_GAMES_APPSFLYER_REPORTING_TOKEN_FILE="$HOME/.config/base-game-lab/appsflyer-reporting-api.token" \
  node tools/find-games-provider-ops/cli.mjs health --live
```

Fetch a bounded AppsFlyer partners-by-date aggregate for both committed app IDs:

```bash
FIND_GAMES_APPSFLYER_REPORTING_TOKEN_FILE="$HOME/.config/base-game-lab/appsflyer-reporting-api.token" \
  node tools/find-games-provider-ops/cli.mjs appsflyer-aggregate \
  --from 2026-09-01 --to 2026-09-02
```

Both commands share an owner-only cache under `~/.cache/base-game-lab/find-games-provider-ops/appsflyer`, keyed by exact app ID and requested date window. A successful app/window response is fetched once and resumed from cache; do not delete the cache or blindly retry to work around provider failures. AppsFlyer's `403` body exactly equal to `Limit reached for partners-daily-report` is safely recognized as `degraded` / `rate_limited`; arbitrary `401`/`403` bodies remain redacted and classify as `auth_required`.

Use deterministic fixtures (tests and incident reproduction; no network):

```bash
node tools/find-games-provider-ops/cli.mjs health \
  --tabs-file path/to/tabs.json \
  --probe-file path/to/probes.json \
  --observed-at 2026-09-03T10:00:00.000Z
```

Run focused verification:

```bash
node --test tools/find-games-provider-ops/test/*.test.mjs
npx eslint tools/find-games-provider-ops
```

## Configuration

Committed identity and provider definitions live in `config/providers.json`. Copy `config/runtime-config.example.json` to:

```text
~/.config/base-game-lab/find-games-provider-ops.json
```

The runtime file contains environment-variable names only. `FIND_GAMES_APPSFLYER_REPORTING_TOKEN_FILE` must resolve to a regular, non-symlink token file with no group/world permission bits (normally mode `0600`). The token value is never accepted directly through an environment variable. Do not place credentials or absolute machine paths in Git.

The AppsFlyer `sdk_dev_key` is deliberately typed `sdk_ingestion`; it does not satisfy the separate protected-file `reporting_token` requirement. Browser authentication is represented as a degraded read fallback and never upgrades reporting API credential availability.

## AppsFlyer aggregate meaning

The aggregate command returns deterministic JSON grouped per game, media source, and campaign. It sums only metric columns actually present in AppsFlyer's CSV among installs, sessions, impressions, clicks, cost, and revenue variants; blank numeric cells become zero and provider `N/A` cells remain `null`. It does **not** invent active users or any other metric absent from the endpoint.

AppsFlyer `organic` means **unattributed**, not necessarily external discovery. It can include internal, development, and TestFlight activity. AppsFlyer is the acquisition-attribution source; **GameAnalytics remains the product-behavior authority** for active users, engagement, retention, and gameplay behavior.

## Statuses

- `healthy`: a supported live API probe succeeded.
- `missing_credential`: a required reporting locator has no usable value (normally exposed as the provider error category while an authenticated browser remains a degraded fallback).
- `auth_required`: the provider tab is on a login route or an API rejected credentials.
- `degraded`: browser fallback only, duplicate tabs, unsafe credential-file mode, or rate limiting.
- `unavailable`: no usable source, network failure, or provider 5xx response.

The CLI never returns guessed metrics. Its JSON includes `observed_at`, provider, source/provenance, freshness/window, per-game identities, credential kinds and presence, and a redacted error category.

## Browser contract

On macOS the CLI reads Google Chrome with JXA through `osascript`. The canonical workspace is the persistent browser-harness `default` session: one window and exactly one tab for each of AppsFlyer, AdMob, Google Play Console, GameAnalytics, RevenueCat, Meta Ads Manager, App Store Connect, Firebase, and Google Drive. Query strings and fragments are removed from tab provenance before it can be returned.

Hammerspoon may launch or arrange the browser, but it must not extract analytics or determine provider health.

## Mutations

This tool is read-only. It does not change campaigns, releases, app records, credentials, browser tabs, cron jobs, or external accounts. Any daily scheduler integration must be installed separately after the branch is trusted and merged, and must preserve the same read-only and explicit-failure behavior.
