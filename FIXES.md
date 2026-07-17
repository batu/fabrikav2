# Purchase & Analytics Audit — Implementation Report

Implements the fix list from `../purchase_audit/REPORT.md` as revised by
`../intent_verify/REPORT.md` (the ego-offer availability gate already exists and
works — old fix-list item #1 is obsolete; the failure point is inside the
provider purchase call). All work on branch `fix/purchase-audit` in fabrikav2.
Verification: workspace-wide `npm run typecheck` clean, `npm run test` green
(all workspaces; the one "xcodebuild test failed" line in output is fixture log
text inside verify-device's passing tests), plus per-item tests below.

## Work item 0 — Reconcile the drifted worktree

**Commit `a3343c4e`** (emitters; shared with item 1). The shipped 1.0.2 bundle's
`purchaseInitiated` / `purchaseCancelled` / `purchaseFailed` emitters and their
two call sites now exist as first-class source: `AnalyticsService` methods, the
shop buy-button tap handler (`HUD.ts purchaseShopProduct` — still emitting
`store:product_tap` first, preserving the shipped ordering), and the ego-offer
continue handler (`GameScene.continueWithEgoOffer`). Both sites fire only on a
tap of an enabled/available offer (the v2 gates match the shipped ones:
`LevelFailedOverlay` status guard + `buildFailContinueOfferSet` availability).
New: every funnel event carries `surface: 'shop' | 'fail_continue'` — the old
data could only attribute surfaces by subtracting product_tap counts.

### Systematic bundle-vs-HEAD divergence table

Method inventory extracted from the shipped bundle (`this.log("…")` +
`Pt("…")` GA design ids) vs the v2 `AnalyticsService`. Disposition of every
divergence:

| Shipped-bundle capability | At v2 HEAD before this branch | Disposition |
|---|---|---|
| purchase_initiated / cancelled / failed emitters + call sites | absent (contract-only) | **PORTED** (`a3343c4e`) |
| product_tapped (`store:product_tap`) | absent | **PORTED** (`a3343c4e`) |
| app_background / app_foreground emitters | absent (contract-only) | **PORTED** (`ae817b88`, item 3) |
| ad_show_failed visibility (was GA-native-SDK-only even in shipped) | absent | **PORTED as owned event** (`4addfd69`, item 4) |
| GA JS SDK + Firebase sinks wired in production | **absent — v2 prod sinks are EMPTY** (`AnalyticsService` sinks: console in dev, `[]` in prod; `GameAnalyticsProvider` is a no-op stub) | **FLAGGED, not ported** — wiring live sinks is the v2 analytics-migration card, out of this audit's scope. Until it lands, none of these events ship anywhere in production. This is the single biggest gap between shipped and HEAD. |
| Real RevenueCat provider + native AppLovin/Adjust plugins | v2 uses `FakePurchaseProvider` + `DisabledAdProvider` (device-stage wiring pending) | **FLAGGED, not ported** — same migration card; kernel seams (`RevenueCatProvider`, plugin contract) exist and the new telemetry rides them when wired. |
| store_opened / paywall_impression | absent (contract-only) | **REJECTED for now** — shop-funnel nice-to-have, not audit-critical; contract entries remain. |
| offer_shown / offer_outcome | absent (contract-only) | **REJECTED for now** — the new `surface` dimension covers the attribution need these served. |
| restore_initiated / completed / failed | absent (contract-only) | **REJECTED for now** — restore flow exists; telemetry deferred. |
| wrong_tap, time_to_first_find, level_abandoned, reward_milestone, experiment_exposure, rate_prompt, hint-booster events, error event | absent (contract-only) | **REJECTED** — gameplay/FTUE telemetry, separate card; unrelated to the purchase audit. |
| Emitter code in a build with **no corresponding commit** | n/a | Root cause addressed by item 5's provenance gate. |

## Work item 1 — Payment-sheet telemetry

**Commits `9994f15b` (kernel) + `a3343c4e` (game).**
- `@fabrikav2/sdk/iap` `IapService` now accepts `onEvent` and emits
  `purchase_dispatched` (immediately before `provider.purchaseProduct` — the
  payment-sheet request) and `state_changed` (every init-state transition with
  reason, e.g. `load-failed` carries the error, `ready` flags zero products).
- Failed results carry `failureKind: 'timeout' | 'store-error'`, classified via
  `isTimeoutError` at the throw site — **our `withTimeout` firing is now
  distinguishable from a StoreKit/provider rejection.**
- FTD maps these to `purchase:sheet_shown` and `iap:state_changed` (new
  canonical entries), and `purchase:failed` carries `reason`, `failure_kind`,
  and a 96-char-capped `error_message`.
- Tests: `packages/sdk/src/iap/service.test.ts` (21 pass — event sequences,
  dispatch-before-provider, no-dispatch on short-circuit, throwing listener
  swallowed, timeout vs store-error vs cancel classification);
  `games/find_the_dog/tests/unit/purchase-funnel-analytics.test.ts` (5 pass).

## Work item 2 — Falsy-field regression test

**Commit `3a3a1d77`.** The stringify fix already existed at HEAD
(`GameAnalyticsEvents.ts` `compactCustomFields`). New
`tests/unit/ga-falsy-custom-fields.test.ts` (3 pass) runs event output through
a faithful mock of GA SDK 4.4.7's `validateAndCleanCustomFields` (`!value`
drop): `dog_index: 0` arrives as `'0'`, `no_ads: false` as `'false'`, and the
raw values are shown to vanish — pinning the exact 7,987-warning failure mode.

## Work item 3 — Analytics lifecycle flush

**Commit `ae817b88`.** `AnalyticsService.init()` registers an
`analytics-flush` lifecycle hook: on suspend → `app_background` +
`sessionEnd()` + `flush()` of every buffering sink; on resume →
`app_foreground` + new session segment. `gameLifecycle` adds a `pagehide`
listener (the only teardown signal WKWebView reliably fires — `beforeunload`
never does). Tests: `tests/unit/analytics-lifecycle-flush.test.ts` (2 pass,
simulated lifecycle via `setLifecycleForTest`).
*Flagged:* `@capacitor/app` (native `appStateChange`) is not a dependency;
adding it would give an earlier/native suspend signal — needs a dependency
decision. Also note the flush currently has no production sink to flush (see
item 0 table).

## Work item 4 — Banner ads

**Commit `4addfd69`.** v2 ships no native AppLovin plugin yet (runtime
`adService` is `DisabledAdProvider`), so the fix lands at the seams the native
port will implement:
- `AppLovinMaxPlugin.showBanner/hideBanner` now carry a **persistent-banner
  contract**: one MAAdView created once and reused, MAX auto-refresh owns
  reloads, hide never destroys. (The v1 Swift `showBannerOnMain` built a fresh
  MAAdView+`loadAd` per call — the direct cause of the 38% failed shows.)
- `AppLovinMaxProvider.showBanner` returns `true` when already visible
  (previously `false`, which would have miscounted every level start as a
  failure under the new telemetry).
- `GameScene` emits owned `ad_show_failed` (`ad_type`/`placement`/`reason`) on
  banner and interstitial `shown:false`, gated on new `AdProvider.enabled`.
- Tests: `tests/unit/ad-show-failed.test.ts` (4 pass).
*Flagged:* the equivalent Swift change to v1's `AppLovinMaxPlugin.swift`
(persistent `MAAdView` property instead of per-show creation) is described in
the plugin contract comment for whoever ports the native layer.

## Work item 5 — Build provenance

**Commit `726abf43`.**
- `configs/vite.base.ts` stamps every build: `__BUILD_INFO__` define (short
  SHA, dirty flag, version, timestamp) + `build-info.json` emitted into the
  bundle. FTD analytics adds `build: '<version>+<sha>[-dirty]'` to every
  event's global params — the v2 analog of GA `configureBuild()`.
- `tools/verify-gate/release-provenance-gate.mjs` (+ `src/release-provenance.mjs`,
  fail-closed): refuses any release build from a dirty tree or an unpushed
  HEAD. Store pipelines must chain it before sign/upload.
- Verified live: the gate FAILs on this very branch (dirty + unpushed), and a
  real `vite build` emitted `build-info.json` with the true SHA and
  `dirty: true`. Tests: `tools/verify-gate/test/release-provenance.test.mjs`
  (5 pass).
*Minor:* FTD's `package.json` has no `version` field, so the stamp's version
half reads `0.0.0` until one is set.

## Work item 6 — Device diagnostic: PARTIAL — blocked on two device-side switches

**What ran (all verified live):** fabrika v1 FTD was built for the real device
and is running on it — `vite build --mode ios` (real `appl_` RevenueCat key
baked in), `npm run ios:sync`, Xcode Debug build (BUILD SUCCEEDED, signed),
installed to Batu's iPhone 12 (`com.baseardahan.hiddenobj` build 11) via
devicectl, launched, and relaunched under a live `pymobiledevice3 syslog`
capture (`scratchpad/rc-syslog.log`, `app-syslog.log`). The full
build→install→launch→log seam works end to end from this Mac.

**What is blocked, and by what:**
1. **Driving the purchase scenarios** (cold-start → fail-screen → ego-offer
   tap; shop purchase; Link Conditioner variants) needs the WKWebView remote
   inspector, and **Web Inspector is disabled on the phone** (`pymobiledevice3
   webinspector` → "Web inspector is not enabled"). Unblock: Settings → Safari
   → Advanced → **Web Inspector ON** (+ Remote Automation for the js-shell).
   Note the driver: pymobiledevice3's `webinspector cdp` crashes in this
   version (asyncio bug) — use `webinspector js-shell`, or v1's
   `tools/drive-device.js` against a working CDP proxy. Probe script ready at
   `scratchpad/iap-probe.js` (samples shop-button enable-latency after cold
   start, taps a buy button, watches the result).
2. **RevenueCat's own verbose log** is not visible in the plain syslog stream
   at default log level; ground truth needs either `sudo log collect
   --device-udid …` (interactive sudo) or a one-line diagnostic tweak in the
   v1 build (`Purchases.setLogLevel({ level: LOG_LEVEL.VERBOSE })` before
   configure) and a rebuild.
3. Completing a sandbox purchase requires a human finger on the payment sheet
   regardless — the automated part ends at sheet dispatch.

**Diagnosis so far / what the new telemetry already changed:** the
intent_verify pixels run proved the failure is *inside* the provider purchase
call, past product-load (offers were priced and enabled). The remaining split
— StoreKit error vs our 60s `withTimeout` vs the "purchase still processing"
path — is exactly what item 1's `failure_kind` now records on every attempt,
so even without this manual repro, the next test build answers the question
per-event. The manual runbook above remains the fastest way to catch the raw
StoreKit error string.

**Timeout design note (pre-empting "just bump the number"):** if the repro
shows our timeout firing, the fix is not a larger constant: the purchase
`withTimeout` should be removed as a *result-decider* and kept only as a
UI-unlock (the overlay already has the "purchase still processing" path; the
late-settle pattern proven in `restore()` — settle-bound + banked late result
— is the design to mirror for purchase). A sheet the user is staring at is
not a failure.

**v1 side effects of the diagnostic (uncommitted, in fabrika v1):** the
standard `ios:sync` build steps re-patched `CapApp-SPM/Package.swift` +
`Package.resolved` (normal, idempotent) — left in place; and the gitignored
`ios/App/App/public` now holds the fresh diagnostic bundle (see incident note
below).

## Incident note (transparency)

Preparing the device diagnostic required `cap sync` in fabrika v1, which
**overwrote the gitignored shipped-1.0.2 reference bundle**
(`ios/App/App/public/assets/bootstrap-D3zTf5sT.js`) with a fresh build. All
findings extracted from it are preserved in `purchase_audit/REPORT.md` and
`intent_verify/REPORT.md`, but the raw artifact no longer exists locally. It
is recoverable from App Store Connect (download the 1.0.2 build) or from the
remote Mac's Xcode archives. Item 5's provenance stamping exists precisely so
this class of artifact is never load-bearing again.
