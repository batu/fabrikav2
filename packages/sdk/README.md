# @fabrikav2/sdk

Provider-agnostic device and monetization services: one interface plus N adapters per
concern, with adapters living beside the interface so the next provider is a file, not a
fork. Concerns: `ads` (`AdProvider` interface generalizing v1's AdMob-only service, with
`admob` / `applovin-max` / `disabled` adapters, rewarded + interstitial), `analytics`
(canonical event contract + pluggable `firebase` / `owned-mirror` / `console` sinks),
`iap` (product-catalog schema from FTD + RevenueCat purchase/restore/fulfillment),
`attribution` (Adjust), `haptics` (v1 core's implementation as-is), and `audio` (a minimal
`AudioBus` — play/mute/volume/ducking — that kills the 4×~1,860-line per-game audio
rewrite). Source-shipped; native-backed SDKs need a native shell to verify. See
`docs/architecture/v2-architecture.md` §packages/sdk.

_Stub — no implementation yet. Built in migration order (haptics → audio → analytics → ads → iap → attribution)._
