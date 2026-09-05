# @fabrikav2/sdk

Provider-agnostic device and monetization services: one interface plus N adapters per
concern, with adapters living beside the interface so the next provider is a file, not a
fork. Concerns: `ads` (`AdProvider` interface generalizing v1's AdMob-only service, with
`admob` / `applovin-max` / `disabled` adapters, rewarded + interstitial), `analytics`
(canonical event contract + pluggable `firebase` / `owned-mirror` / `console` sinks),
`iap` (product-catalog schema from FTD + RevenueCat purchase/restore/fulfillment),
`attribution` (Adjust, AppsFlyer), `haptics` (v1 core's implementation as-is), and `audio` (a minimal
`AudioBus` — play/mute/volume/ducking — that kills the 4×~1,860-line per-game audio
rewrite). Source-shipped; native-backed SDKs need a native shell to verify. See
`docs/architecture/v2-architecture.md` §packages/sdk.

Built in migration order (haptics → audio → analytics → ads → iap → attribution). Landed so far:

- **`./haptics`** — v1 core's 92-line wrapper carried nearly verbatim (`safeImpact` /
  `safeNotification`, two-layer web/native safety, native enum re-exports) plus
  `createHaptics({ isEnabled })` — a gated factory taking an INJECTED predicate (FTD's
  gating pattern, decoupled from `gameState`). `@capacitor/core` + `@capacitor/haptics` are
  OPTIONAL peer deps (native shell supplies them; unit tests mock them).
- **`./audio`** — a minimal `AudioBus` (`music` / `sfx` channels; `play`, per-channel
  `setMuted` / `setVolume`, depth-counted `duck` / `unduck`, `unlock` / `suspend` / `resume`,
  `master` recording tap). Games plug in decoded clips or procedural voices; the gain math is
  a pure `Mixer` state machine (`effectiveGain = muted ? 0 : volume * duckFactor`) with a thin
  Web Audio apply-layer over it. Ships exactly one trivial test synth — no game synth is
  ported. Covers all 4 v1 games' mute/volume shapes (see
  `docs/brainstorms/2026-07-06-sdk-haptics-audiobus-requirements.md`).

- **`./analytics` / `./ads` / `./iap` / `./attribution`** — implemented (the "stubs"
  note above is historical): canonical analytics contract + firebase/owned-mirror/console
  sinks; `AdProvider` with `admob` / `applovin-max` / `disabled` adapters (opt-in
  `VITE_APPLOVIN_ALLOW_PARTIAL_UNITS` lets a game run MAX with only some unit ids);
  RevenueCat IAP; Adjust + AppsFlyer attribution behind `selectAttributionProvider`.
- **`./meta`** — Facebook Core SDK surface (init + app events only, no Login):
  `readMetaConfig` (`VITE_FB_APP_ID` / `VITE_FB_CLIENT_TOKEN`, auto-log and
  advertiser-id collection default OFF), `CapacitorMetaProvider` over the
  `MetaEvents` native bridge, `DisabledMetaProvider` as the first-class off state.

Source-shipped; native-backed SDKs need a native shell to verify.

## Purchase timeout recovery

Inject an application-scoped `pendingPurchaseStore` (the SDK exports
`localStoragePendingPurchaseStore(key)`) and register
`setOnCompletedPurchase(result => acknowledged)` before `init()`. The handler
receives successful native results that arrived after the caller timed out.
Return `true` only after an atomic durable wallet grant, or a duplicate found in
that durable transaction ledger. Return `false` or throw to retain the result.
Call `reconcilePendingPurchases()` from the existing application resume hook.
It also runs on initialization and purchase retry; a retry that delivers an old
result returns that result instead of issuing another charge.

Results are saved before delivery and removed after acknowledgment. Failure to
remove a delivered record can cause redelivery, so wallet idempotence is required.
Malformed/unreadable records block new purchases rather than overwrite evidence.
Consumers without a pending store retain the earlier in-memory same-SKU retry.
Normal results still go to their awaiting caller. This is not universal purchase
reconciliation: a process killed before receiving the native result, an on-time
caller that fails to fulfill, or unwritable/volatile storage still needs recovery
outside this late-result mechanism. Do not grant consumables from restored
product membership; it does not preserve the original purchase transaction ID.

## AdMob native correction

Root `npm install`/`npm ci` runs `tools/patch-admob-ios-revenue.mjs` after the
existing GameAnalytics correction. It approves only AdMob 8.1.0 and exact
original/patched source hashes, converting iOS decimal currency values to micros
in all five native formats. `node tools/patch-admob-ios-revenue.mjs --verify`
checks an existing installation without changing it. Review and update the
correction when upgrading the dependency; Android's existing micros stay intact.
Rewarded completion follows earned-reward plus dismissal events, with fullscreen
ownership held until a terminal event or disposal. Automated adapter tests do
not establish physical-device behavior or ordering for future mediation SDKs.
