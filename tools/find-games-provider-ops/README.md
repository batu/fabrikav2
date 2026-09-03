# Find Games provider operations

`find-games-provider-ops` is a deterministic readiness check for the provider workspace used by Find the Dog and Find the Bird. It validates non-secret identity configuration, credential *locators*, the live Chrome tab contract, and optional API reachability without printing credential contents.

A passing health check is **not analytics proof**. It proves that a source can be reached or that a browser fallback is present. A metric is current only when the resulting report records the provider source, observation time, requested reporting window, and game identity for the metric itself.

## Commands

Run the read-only health check against the canonical Chrome workspace:

```bash
node tools/find-games-provider-ops/cli.mjs health
```

Run real read-only Meta and App Store Connect API probes when their reporting credentials are available:

```bash
node tools/find-games-provider-ops/cli.mjs health --live
```

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

The runtime file contains environment-variable names only. Set those variables to credential values or protected-file paths in the operator environment. Do not place credentials or absolute machine paths in Git. Existing protected files may be used by setting the corresponding `*_FILE` environment variable.

The AppsFlyer `sdk_dev_key` is deliberately typed `sdk_ingestion`; it does not satisfy the separate `reporting_token` requirement. Browser authentication is represented as a degraded read fallback and never upgrades reporting API credential availability.

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
