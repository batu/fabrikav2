# Find The Dog iOS — ad lifecycle telemetry contract

Status: source-ready on branch `fix/ftd-ads-lifecycle`; not device-verified, not merged, not released.

## Principles

1. **Impression evidence is native only.** Banner impressions come from the plugin's `bannerAdImpression` event (`bannerViewDidRecordImpression`). Full-screen "impression" comes from the plugin's `interstitialAdImpression` / `onRewardedVideoAdImpression` events, which `@capacitor-community/admob` 8.1.0 raises from the native `paidEventHandler` (they carry `impressionId`, value, currency, precision). Request acceptance (`showBanner()` resolving `true`) is never counted as shown.
2. **One correlation id per native load.** `load_id` = `<format>-<provider generation>-<counter>`; every later stage of that ad object (`show_requested`, `shown`, `impression`, `dismissed`, `reward_earned`, `expired`) carries the same `load_id`, so a consumer can deduplicate and compute cache age.
3. **Data minimization.** No IDFA, device id, birth date, consent details or user id are attached at this layer. `ad_impression_id` is attached only to `ad_revenue_paid` (for revenue dedupe); the owned mirror strips it by its existing forbidden-key policy, GameAnalytics does not receive it (not in `adRevenueFields`).
4. **Global dimensions come from the analytics facade** (`game`, `environment`, `platform`, `build`, `app_version`, cohort bucket, experiment params). QA/TestFlight/production separation uses `environment` + `build`; nothing here adds a new environment flag.

## Event: `ad_lifecycle` (owned analytics, new)

Emitted by `AdMobProvider.onAdEvent` → `createAdMobCompositionOptions` → `analytics.adLifecycle`.

| param | values | notes |
|---|---|---|
| `ad_type` | `banner` \| `interstitial` \| `rewarded` | format |
| `placement` | `gameplay` (banner), `between_levels` (interstitial), `rewarded` (rewarded) | static per format; rewarded placements (`hint_button`, `level_complete_claim_x2`) stay on the game-level `rewarded_ad_granted` event |
| `stage` | see table below | |
| `load_id` | string | correlation id (absent on `skipped` when no load exists) |
| `reason` | string | failure/skip reason, identifier-free, ≤80 chars |
| `attempt` | 1..3 | interstitial load attempt inside a failure streak |
| `cache_age_ms` | number | age of the cached ad at `show_requested` / `expired` |

### Stages by format

| stage | banner | interstitial | rewarded | source |
|---|---|---|---|---|
| `load_requested` | on native `showBanner` call | on `prepareInterstitial` (with `attempt`) | on `prepareRewardVideoAd` | provider |
| `loaded` | `bannerAdLoaded` | `prepareInterstitial` resolved | `prepareRewardVideoAd` resolved | native/bridge |
| `load_failed` | `bannerAdFailedToLoad` (`native_<code>`) or bridge throw | bridge reject (`reason`, `attempt`) | bridge reject | native/bridge |
| `expired` | — | cached >1 h at next gate/resume/preload | cached >1 h at next preload/show/resume | provider clock |
| `skipped` | — | `not_initialized`, `frequency_cap`, `show_in_progress`, `not_loaded`, `retry_pending`, `load_budget_exhausted`, `terminal_listener_registration` | `not_loaded`, `terminal_listener_registration` | provider |
| `show_requested` | — | before native `showInterstitial` (with `cache_age_ms`) | before native `showRewardVideoAd` | provider |
| `shown` | — | native `showInterstitial` resolved (= presented) | — (rewarded native promise resolves only on reward) | bridge |
| `impression` | `bannerAdImpression` | `interstitialAdImpression` (paid callback) | `onRewardedVideoAdImpression` (paid callback) | native |
| `reward_earned` | — | — | `onRewardedVideoAdReward` with amount > 0 (once) | native |
| `dismissed` | — | `interstitialAdDismissed` | `onRewardedVideoAdDismissed` (`reason: closed_before_reward` when no reward) | native |
| `show_failed` | — | bridge throw or `interstitialAdFailedToShow` | bridge reject or `onRewardedVideoAdFailedToShow` | native/bridge |
| `hidden` | `hideBanner` while visible/pending, or `loaded_after_hide` re-hide | — | — | provider |

### Game-level events that remain authoritative for placement

- `ad_shown{ad_type:'interstitial', placement:'between_levels'}` — emitted by GameScene when `maybeShowInterstitial` resolves `true` (native present + terminal event). Unchanged.
- `ad_shown{ad_type:'banner', placement:'gameplay'}` — **now emitted only from the native banner impression** (composition). GameScene no longer emits it on request acceptance.
- `ad_show_failed{ad_type:'banner', reason}` — `native_<code>` from the composition on native failure; `request_rejected` from GameScene when the provider refused to request (not initialized / web / throw).
- `rewarded_ad_granted{placement}` — unchanged (game-level, exactly-once grant path).
- `ad_revenue_paid{ad_type, placement, revenue_usd, currency, precision, network_name, ad_impression_id}` — **new emission** from the native paid callback (previously only forwarded to AppsFlyer). Value is decimal currency units after the `tools/patch-admob-ios-revenue.mjs` micros correction; see "Paid value verification" below.

### Offer available / voluntary tap (game level, not changed here)

- Rewarded offer availability is the HUD hint-booster option (`HintBoosterOffers`, `status: available|disabled`) and the level-complete `claimX2Available` flag. A voluntary tap is `handleRewardedHintTap` / `onClaimX2`. These remain product-owned; a dedicated `ad_offer_shown` / `ad_offer_tapped` event is proposed as a follow-up once the funnel above is live on device, so tap → `show_requested` → `reward_earned` can be evaluated instead of matched → impression.

## Paid value verification

- Plugin 8.1.0 iOS emits `valueMicros: adValue.value.int64Value` where Google's `AdValue.value` is decimal currency (0.0012 = $0.0012), so unpatched builds truncate to 0 and the provider drops `valueMicros <= 0`.
- `tools/patch-admob-ios-revenue.mjs` (root postinstall, verified by the iOS release preflight) rewrites it to `multiplying(by: 1_000_000).int64Value` in five executors.
- Shipped 1.0.6 (26): the submission checkout's install log shows `AdMob@8.1.0 iOS revenue correction verified (5 files patched)` (`/Users/base/store-review/find-games/ios-submission-20260906/npm-ci.log:6`). This worktree: patched (1 match in `BannerExecutor.swift`). The main checkout `node_modules` is **unpatched** (0 matches) — do not build a device/release binary from it.
- Provider divides by 1,000,000 → `revenue` in currency units; AppsFlyer receives `af_revenue` in those units with `af_currency`. Unit test `forwards paid impressions with normalized required fields` covers the JS side; the native conversion is covered by `tools/verify-gate/test/patch-admob-ios-revenue.test.mjs`. End-to-end backend receipt (AppsFlyer `af_ad_revenue` row) is **not verified** in this session — see the evidence README.

## Sink routing

- Owned mirror + ring buffer: all events, `ad_impression_id` stripped by policy.
- GameAnalytics: `ad_lifecycle` is `Firebase only` (not forwarded); `ad_shown` / `rewarded_ad_granted` continue to drive GA's `adImpression` / `adReward` design events.
- AppsFlyer: `af_ad_revenue` (deduped by impression id, durable) — unchanged path.
- Firebase Analytics is not composed (deliberately; see `CreateSdkContextDependencies.firebaseAnalyticsLoader` comment). Nothing here adds Adjust or Firebase Analytics.
