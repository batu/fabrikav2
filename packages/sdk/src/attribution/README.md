# `@fabrikav2/sdk/attribution`

Reusable JavaScript attribution layer for Fabrika games. The module provides:

- `AttributionService`, a small service with studio-standard event names.
- `createAttributionProvider`, which enables Adjust only on iOS when config is valid.
- `AdjustAttributionProvider`, the timeout-bounded Capacitor bridge adapter.
- `DisabledAttributionProvider`, the no-op fallback for unsupported platforms or missing config.

This module is JS-only. A consuming game must provide its own native Capacitor plugin before Adjust can work on device.

Ported from v1 `@fabrika/core/attribution` (the dead, freshly-extracted copy that carried the tests). The one deliberate behavioral change for v2 is that the Adjust backend environment **defaults to `sandbox`** when `VITE_ADJUST_IOS_ENVIRONMENT` is unset — see [Environment](#environment). The `../runtime/with-timeout` dependency is vendored locally as `./with-timeout.ts` (a later card should promote it to `@fabrikav2/kernel` and de-dupe).

## Native Contract

The JavaScript adapter calls `registerPlugin('AdjustAttribution')`. The iOS app must register a Capacitor plugin whose `jsName` is exactly `AdjustAttribution`, with these promise methods:

- `initialize(options)` resolves `{ initialized: boolean }`.
- `trackEvent(options)` resolves `{ tracked: boolean }`.
- `getStatus()` resolves `{ initialized: boolean, environment: string | null }`.

The native plugin should resolve rather than reject for normal validation failures. Return `initialized: false` or `tracked: false` when config is missing, the SDK refuses a token, the SDK is not initialized, or an event is not configured.

The current production iOS bridge that this module was copied from is the reference implementation:

- `AdjustAttributionPlugin.swift` declares `jsName = "AdjustAttribution"` and the three methods above.
- The game bridge view controller registers it with `bridge?.registerPluginInstance(AdjustAttributionPlugin())`.
- The SPM package includes `.package(name: "AdjustSdk", url: "https://github.com/adjust/ios_sdk", from: "5.6.2")`.

Android has no Adjust bridge yet. `createAttributionProvider` intentionally returns the disabled provider off-iOS.

## Native Allowlist

The Swift bridge owns the callback-parameter allowlist per event. Unknown event names and unknown callback parameter keys are ignored by native code, and callback values must be strings. The reference bridge caps each value at 96 characters.

When a game adds new params through `AttributionService`, update that game's native allowlist to match. The JS layer serializes primitive values; native decides what is allowed to leave the device. A consuming game's attribution tests should assert the JS event names and param keys it emits are present in that game's native allowlist before enabling Adjust in production.

This module intentionally does not export a universal param schema. Event params are game-owned, because each game's native bridge controls the final allowlist and egress policy.

## Privacy

The studio default is no IDFA and no App Tracking Transparency prompt. The JS initialization payload sends:

- `disableIdfaReading: true`
- `disableAppTrackingTransparencyUsage: true`

The native bridge must apply the same Adjust SDK switches before initializing.

## Environment

The consuming game's Vite build provides the env bag. This module is compiled in that game build, so the game's `.env` controls these keys:

- `VITE_ADJUST_IOS_ENABLED`
- `VITE_ADJUST_IOS_APP_TOKEN`
- `VITE_ADJUST_IOS_ENVIRONMENT` (`sandbox` or `production`; **defaults to `sandbox` when unset**)
- `VITE_ADJUST_VERBOSE_LOGGING`
- `VITE_ADJUST_EVENT_APP_OPEN_TOKEN`
- `VITE_ADJUST_EVENT_LEVEL_START_TOKEN`
- `VITE_ADJUST_EVENT_LEVEL_COMPLETE_TOKEN`
- `VITE_ADJUST_EVENT_LEVEL_FAIL_TOKEN`
- `VITE_ADJUST_EVENT_REWARDED_WATCHED_TOKEN`

Never commit real Adjust app tokens or event tokens. `VITE_ADJUST_IOS_ENVIRONMENT` is optional and defaults to `sandbox`; only the app token is required when Adjust is enabled. Production builds still require `VITE_ADJUST_IOS_ENVIRONMENT=production` — sandbox is rejected in production, so a production build with the env unset (defaulting to sandbox) resolves to disabled. If `import.meta.env.PROD` is absent, the module treats the build as production and fails closed.

`readAdjustIosConfig()` validates the app token and environment only. Event tokens are optional so a game can ship a subset of attribution events; events with missing tokens are skipped at runtime. Each consuming game should define its required event-token policy in game-owned tests or release checks.

## Diagnostics

If the native plugin is not registered, Capacitor reports the bridge method as not implemented. `AdjustAttributionProvider` treats definitive initialization failure as permanently disabled for that provider instance. Initialization timeout is treated as transient, so a later event can retry native init.

Use `AdjustAttribution.getStatus()` in game devtools as the bridge-wiring smoke test. Verbose native logging should be gated twice: non-production JS build and sandbox native environment.

## Usage

Each game owns its singleton:

```ts
import { AttributionService, createAttributionProvider } from '@fabrikav2/sdk/attribution';

export const attribution = new AttributionService(createAttributionProvider());
```

Pass any startup/privacy/config gate in the `AttributionService` constructor before exporting the singleton. `configureStartupGate()` is only for early bootstrap code that can run before any attribution event is fired; it cannot retroactively gate an event that already started.

Rewarded flows should attribute only after the reward is actually granted. Keep that timing in game-owned glue instead of this shared provider module.

## AppsFlyer adapter

`AppsFlyerAttributionProvider` mirrors the Adjust adapter behind the same
`AttributionProvider` interface, selected via `selectAttributionProvider`
(explicit `preferred` choice wins; otherwise AppsFlyer-before-Adjust by config
presence; everything else resolves Disabled with a reason). Native contract
(`jsName='AppsFlyerAttribution'`): `initialize({devKey, appleAppId, debugLogging,
attWaitSeconds})`, `trackEvent({eventName, eventValues})`, `getStatus()` — all
resolve-not-reject.

Env keys:

| Key | Meaning |
|---|---|
| `VITE_APPSFLYER_ENABLED` | Master gate; anything but `true` is disabled |
| `VITE_APPSFLYER_DEV_KEY` | AppsFlyer dev key (required both platforms) |
| `VITE_APPSFLYER_APPLE_APP_ID` | Numeric App Store id (required on iOS) |
| `VITE_APPSFLYER_DEBUG_LOGGING` | Verbose logs; forced off in production builds |
