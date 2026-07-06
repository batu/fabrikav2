# marble_run — SDK TEST credentials (paths + modes, NO secret values)

Per decision doc `docs/DECISIONS-2026-07-06-v2-kickoff.md` ("SDK test credentials"):
the v2 marble_run pilot reuses find_the_dog's v1 (READ-ONLY) SDK configuration as
**TEST/sandbox** credentials only. This file records **where** each credential lives in
v1 and **which mode** the pilot runs in. It copies **no secret values** — every real
value stays in v1 env / config and arrives at runtime through a native shell.

> **HARD CONSTRAINT:** `/Users/base/dev/appletolye/fabrika` (v1) is READ-ONLY. Nothing here
> edits it; nothing here copies a key, token, or api-secret into this repo.

## Environment resolution (single source of truth)

All four SDK environments are resolved from ONE call — `resolveSdkEnvironments(buildEnv)`
(`packages/sdk/src/env/resolveSdkEnvironments.ts`) — never hand-mapped per SDK. The pilot
build (`import.meta.env.PROD ? 'production' : 'development'`) resolves to the dev row:

| Field | Dev-row value | Effect |
|---|---|---|
| `analytics` | `development` | mandatory `env` tag on every analytics payload |
| `adjust` | `sandbox` | Adjust attribution runs in sandbox |
| `admobTestMode` | `true` | AdMob forced to Google public test unit ids |
| `revenuecatSandbox` | `true` | expects a `test_`-prefixed RevenueCat sandbox key |

The load-bearing invariant (unit-tested): the dev row can **never** yield
`analytics: 'production'` or `adjust: 'production'` — the guard against polluting FTD's
production analytics/attribution.

## Reused v1 credential sources (READ-ONLY; do not edit, do not copy values)

| SDK | v1 source path (READ-ONLY) | Mode this pilot uses | How the value reaches runtime |
|---|---|---|---|
| **AppLovin MAX** (ads) | `games/find_the_dog/src/ads/AppLovinConfig.ts` | test/sandbox; AdMob fallback uses Google public test unit ids (`admobTestMode: true`) | Vite env (`VITE_APPLOVIN_*`) read in the config; disabled on web by construction |
| **Firebase** (analytics) | `games/find_the_dog/src/analytics/firebaseApp.ts` | `env: 'development'` tag on every event; Firebase sink is native/worker-only | native Firebase transport injected into `createFirebaseSink` (Blocked-on-Batu) |
| **Adjust** (attribution) | `games/find_the_dog/src/attribution/AdjustConfig.ts` | `AdjustEnvironment: 'sandbox'` | Vite env (`VITE_ADJUST_*`) via `readAdjustIosConfig`; disabled on non-iOS by construction |
| **RevenueCat** (iap) | `games/find_the_dog/src/shop/IapService.ts` (key site: `revenueCatAndroidApiKey()` / `revenueCatIosApiKey()`, ~L113–119, reading `VITE_REVENUECAT_ANDROID_API_KEY` / `VITE_REVENUECAT_IOS_API_KEY`) + `games/find_the_dog/src/bootstrap.ts` (wiring) | sandbox api key (`isSandboxApiKey` = `test_`-prefixed); **FakePurchaseProvider in web/CI** | native RevenueCat plugin + sandbox key on device (Blocked-on-Batu) |

Note: v1 stores no hardcoded secret values in source — every key is read from a Vite env
var. The pilot inherits that pattern; this repo ships **no** `.env` and no key material.

## What runs where (web/CI vs native)

- **Web / CI (this card's scope):** ads → `DisabledAdProvider`; attribution →
  `DisabledAttributionProvider`; IAP → `FakePurchaseProvider` seeded from the catalog with
  the placeholder sandbox key `test_marble_run_sandbox`; analytics → console + capture
  sinks tagged `env: 'development'`. No real credential is exercised; no network SDK call is
  made. This is what the unit/integration suite and `vite dev` verify.
- **Native (Blocked-on-Batu, NOT in this card):** Capacitor shells supply the real AppLovin/
  AdMob, Adjust sandbox, Firebase transport, and RevenueCat sandbox key. Live ad fill,
  sandbox purchases, and real Adjust/Firebase delivery are a **separate Blocked-on-Batu**
  item and are **not** claimed here.

## Residual risk

The one real risk is an untagged or mis-resolved analytics/attribution event reaching FTD's
production pipeline while reusing FTD credentials. It is mitigated by (1) the mandatory
`env` marker baked into every analytics payload, (2) `resolveSdkEnvironments`' dev-row
invariant (never production for analytics/adjust in a dev build), and (3) the native
delivery transports being absent on web/CI (nothing is actually transmitted here).

**Real marble_run app IDs / production credentials are a separate Blocked-on-Batu item.**
