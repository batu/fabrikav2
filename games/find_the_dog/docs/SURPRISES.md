# Find the Dog Port Surprises

- `twf status --card poKzTZyx` reported the card in `todo` while also showing the Brainstormed checklist. The user-spawned direct-to-work contract was followed: implementation artifact first, then exactly one `twf next`.
- `npm install` initially failed because the default npm cache under `/Users/base/.npm` was root-owned in this sandbox. Re-running with `npm_config_cache=/private/tmp/npm-cache` installed the workspace dependencies.
- The v2 `create-game` seed expected a tiny placeholder app, but FTD is a full Phaser app with DOM HUD, public level corpus, runtime sequencing, and persistent progression. The placeholder E2E smoke had to be replaced with a real Phaser/HUD boot observation.
- The v1 app depended on `@fabrika/core` for asset/manifest helpers and UI primitives. v2 does not expose that package, so this port includes local `src/v1core/` compatibility adapters to preserve FTD behavior without flattening sequencing or UI.
- Vendor SDK seams from v1 were native/provider-specific: Firebase remote config, Firebase/GameAnalytics analytics, RevenueCat purchases, Adjust attribution, and ad networks. The first v2 pass maps the high-level game APIs onto `@fabrikav2/sdk` where available and uses disabled/dev providers for unavailable native lanes.
- The old remote-config path was part of level sequencing. It could not be removed without changing progression semantics, so `RemoteConfigService` now preserves the same `initAndWait`/`value` API with local defaults and test overrides.
- The harness could not use random completion. `winLevel` is bound to the existing `dogPositions` tap-target data, and `failLevel` taps deterministic safe miss points away from dog radii.
- This sandbox has no iPhone/WKWebView device lane. Browser/headless checks are useful compile and smoke proxies only; conductor must run on-device capture, tour markers, and visual fidelity checks.
