---
name: find-games-provider-ops
description: Verify Find Games provider readiness without guessing.
scope: optional
---

# Find Games Provider Operations

Use the deterministic provider-health tool and a fixed source order to operate
Find the Dog (FTD) and Find the Bird (FTB). This skill governs readiness and
report provenance; it never turns a health check into analytics evidence.

## When to Use

- Building the daily Find Games provider report.
- Checking whether reporting sources and browser fallbacks are ready.
- Diagnosing a missing, duplicate, signed-out, or degraded provider.
- Verifying that FTD and FTB identities remain isolated.
- Do not use for campaign, release, app-record, or credential mutations.

## Source Priority

Use sources in this exact order for each provider and reporting window:

1. Live provider reporting API.
2. Authenticated canonical Chrome provider dashboard.
3. Public App Store or Play storefront.
4. Local evidence already captured from one of those sources.

Never use chat, session history, memory, or a prior agent statement as proof of
current provider state. Historical context can explain what to inspect, but the
current source must provide the value reported today.

Do not merge values across precedence levels. If the API is available but its
requested window fails, report that failure; do not silently substitute an old
local number. A fallback must identify itself as a fallback.

## Browser Workspace Contract

The canonical browser is the persistent Chrome/browser-harness session named
`default`. It has one window and exactly nine tabs, one per provider:

1. AppsFlyer
2. AdMob
3. Google Play Console
4. GameAnalytics
5. RevenueCat
6. Meta Ads Manager
7. App Store Connect
8. Firebase
9. Google Drive

Keep one tab per provider. Do not open a replacement tab before confirming that
the canonical tab is missing. A duplicate is `degraded`, a login route is
`auth_required`, and a missing tab is `unavailable` when no higher-priority API
source works.

Chrome authentication is a read fallback. It is not proof that an API token,
OAuth grant, service account, or App Store Connect key exists.

Hammerspoon may launch Chrome or arrange windows. It must not scrape analytics,
choose source precedence, classify health, or own a reporting loop.

## Stable Game Identities

Read committed identities from
`tools/find-games-provider-ops/config/providers.json`. Verify these exact rows
before attributing any metric:

| Game | App Store | AppsFlyer | Bundle | GameAnalytics project |
|---|---:|---|---|---:|
| FTD | `6772100729` | `id6772100729` | `com.baseardahan.hiddenobj` | `350269` |
| FTB | `6796698146` | `id6796698146` | `com.basegamelab.findthebird` | `351396` |

The Meta ad account is `2805795896467959`. It is shared reporting context, not
a substitute for per-game campaign/app identity. Never copy an FTD result into
an FTB row or infer one game's state from the other.

## Credential Separation

Runtime locator configuration belongs outside Git at:

```text
~/.config/base-game-lab/find-games-provider-ops.json
```

Start from
`tools/find-games-provider-ops/config/runtime-config.example.json`. The file may
name environment variables whose values are non-AppsFlyer tokens or protected
file paths. AppsFlyer reporting is stricter: set exactly
`FIND_GAMES_APPSFLYER_REPORTING_TOKEN_FILE` to a protected regular file; never
put its reporting token value in an environment variable. Do not place
credential values or absolute user paths in committed files.

Protected files remain where the operator manages them. The source only accepts
their paths through runtime configuration or environment variables. Inspect
existence and POSIX mode without printing file contents or resolved paths.
AppsFlyer token files must not be symlinks and must have no group/world bits
(mode `0600` is expected).

AppsFlyer's existing developer key has kind `sdk_ingestion`. It sends SDK events
and does not grant reporting access. Only a distinct credential with kind
`reporting_api` can make an AppsFlyer API probe eligible. An authenticated
AppsFlyer dashboard remains a browser fallback until that token exists.

Never print tokens, JWTs, private keys, response bodies from authentication
failures, URL query strings, or URL fragments. Error output contains categories,
not provider payloads.

## Provider Verification

For every provider, begin with `health`. Then verify as follows:

- **AppsFlyer:** require a protected-file reporting token for API use. `health
  --live` probes the partners-by-date v5 endpoint for both exact committed app
  IDs with a Bearer authorization header. Treat the SDK developer key only as
  ingestion readiness. For bounded acquisition totals run:

  ```bash
  FIND_GAMES_APPSFLYER_REPORTING_TOKEN_FILE="$HOME/.config/base-game-lab/appsflyer-reporting-api.token" \
    node tools/find-games-provider-ops/cli.mjs appsflyer-aggregate \
    --from 2026-09-01 --to 2026-09-02
  ```

  The command groups stable rows per game/media-source/campaign and emits only
  CSV-provided installs, sessions, impressions, clicks, cost, and revenue
  fields. Blank numeric fields are zero and provider `N/A` values stay `null`.
  Never fabricate active users.
  AppsFlyer `organic` means unattributed and may include internal or TestFlight
  activity. GameAnalytics remains the product-behavior authority.
- **AdMob:** prefer its reporting API credential. Otherwise inspect the AdMob tab
  and label the result browser-derived.
- **Google Play Console:** prefer the reporting API/service account. Otherwise
  inspect the exact app in the console; use the public listing only after that.
- **GameAnalytics:** prefer reporting API access and verify project `350269` or
  `351396` before reading values. Otherwise use the authenticated tab.
- **RevenueCat:** prefer reporting API access and select the exact app/project.
  Browser authentication alone stays degraded.
- **Meta:** use the read-only live probe against ad account
  `2805795896467959` when its reporting token exists. Never put the token in a
  URL; use the authorization header.
- **App Store Connect:** use issuer ID, key ID, and protected P-256 private key.
  The tool signs a short-lived JWT in memory and never emits it.
- **Firebase:** prefer configured API/service-account access. Otherwise use the
  authenticated console and select the exact bundle/project.
- **Google Drive:** use authenticated API/OAuth access when configured. Otherwise
  treat the canonical Drive tab as a browser fallback only.

A successful Meta, AppsFlyer, or App Store Connect probe proves read
reachability, not that every requested analytics metric exists. AppsFlyer calls
share an owner-only cache keyed by app ID and exact date window. Once a response
succeeds, resume from that cache rather than fetching the same app/window again.
Never blindly retry AppsFlyer's low-quota partners daily report. A `403` whose
body exactly matches `Limit reached for partners-daily-report` is classified
`degraded` / `rate_limited`; no other response body is returned or logged.

## Reporting Schema

Preserve the CLI's stable JSON fields:

```json
{
  "schema_version": 1,
  "observed_at": "ISO-8601",
  "providers": [{
    "observed_at": "ISO-8601",
    "provider": "provider_id",
    "status": "healthy|missing_credential|auth_required|degraded|unavailable",
    "source": { "kind": "live_api|authenticated_browser|none", "provenance": "provider_id" },
    "freshness": { "observed_at": "ISO-8601", "window": null },
    "games": [],
    "credentials": [],
    "error": { "category": "redacted_category" }
  }]
}
```

When a metric is later added to a daily report, attach its own reporting window
and game identity. Do not reuse the health observation timestamp as the metric's
data freshness unless the provider explicitly says they are the same.

## Daily Report Workflow

1. Run non-live `health`; confirm the browser contract and credential locator
   states are explicit. Completion: all nine providers have a status.
2. Run `health --live` only where read-only credentials are configured.
   Completion: Meta and App Store Connect probes either succeed or expose a
   stable failure category.
3. Acquire each requested metric using the source priority, exact reporting
   window, and exact game identity. Completion: no metric is inferred or guessed.
4. Record `observed_at`, provider, source/provenance, freshness/window, identity,
   and error category. Completion: every row can be traced to its current source.
5. Mark browser-only rows `degraded`; mark login walls `auth_required`; mark
   absent credentials `missing_credential`; mark unreachable sources
   `unavailable`. Completion: no false-green provider remains.
6. Publish or schedule only after reviewing the JSON for secret and identity
   leakage. Completion: the output contains neither secrets nor resolved paths.

## Mutation Gates

Provider health and daily reporting are read-only. Stop and obtain explicit
human approval before changing an ad, budget, campaign, release, app metadata,
provider user, OAuth grant, key, browser tab inventory, or external schedule.

Do not install or modify cron from this skill. A scheduler change occurs only
after the source branch is reviewed, trusted, and merged. The scheduled command
must use the same runtime file outside Git and preserve explicit non-green states.

## Pitfalls

- `healthy` means a live read probe succeeded; it is not a metric assertion.
- Browser login does not imply reporting API access.
- An AppsFlyer SDK key is not a reporting token.
- Public storefront data has lower precedence than an authenticated dashboard.
- Local screenshots and evidence can be stale even when their files are new.
- Duplicate tabs create ambiguous provenance; do not choose one silently.
- Unsafe credential-file permissions are `degraded`, not acceptable readiness.
- API 401/403 is `auth_required`; 429 is `degraded`; network/5xx is
  `unavailable`. Never replace these with guessed values.

## Verification

Run focused tests and lint, then inspect the real read-only browser inventory:

```bash
node --test tools/find-games-provider-ops/test/*.test.mjs
npx eslint tools/find-games-provider-ops
node tools/find-games-provider-ops/cli.mjs health
FIND_GAMES_APPSFLYER_REPORTING_TOKEN_FILE="$HOME/.config/base-game-lab/appsflyer-reporting-api.token" \
  node tools/find-games-provider-ops/cli.mjs appsflyer-aggregate \
  --from 2026-09-01 --to 2026-09-02
```

Confirm one window, nine tabs, nine provider rows, both game identity rows, no
query strings, no resolved credential paths, and no secret values. If live
credentials are available, run `health --live` and report the real provider
outcomes. If they are not available, preserve `missing_credential` or degraded
browser fallback; missing access is evidence, not a reason to invent green.
