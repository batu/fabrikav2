# Physical runtime and backend readback

Date: 2026-08-28
Device: Batu’s iPhone 12 (`iPhone13,2`)
Bundle: `com.basegamelab.findthebird`
Firebase app: `1:449540096581:ios:1b90d0a4490c787037192c`

## Crashlytics

1. A Release physical-device build mounted the shared Crashlytics verifier under explicit test-only build gates.
2. The generated Release build phase reported `Successfully uploaded Crashlytics symbols`.
3. The controlled marker was logged before `FirebaseCrashlytics.crash`; the app terminated with signal 5.
4. After reinstall/relaunch with autocrash disabled, authenticated Crashlytics REST readback for 2026-08-28 returned exactly one event in issue `6793a62c6a18a41ee123b75c1f727bab`.
5. Issue title: `[App] FirebaseCrashlytics.swift - FirebaseCrashlyticsPlugin.crash(_:)`; type `EXC_BREAKPOINT`, fatal, fresh.
6. Event batch readback returned a symbolicated developer-owned blame frame: `FirebaseCrashlytics.swift:14`, `FirebaseCrashlyticsPlugin.crash(_:)`, library `App`, plus `AppDelegate.swift:6`.

The REST API was enabled on `find-the-bird-basegamelab` for authenticated, repeatable readback. No credential or token is stored here.

## Device tour

The repaired canonical marker tour captured all six requested states with live-device provenance and exact accessibility markers. The inspected captures are under `device-ftb-v5/raw-captures/`; `menu`, `level`, `settings`, `win`, `fail`, and `pause` are all marked `gated` in `summary.json`. The vision panel was deliberately skipped, so this is runtime/state evidence rather than an aesthetic score.

## AppsFlyer

Physical-device console evidence proves:

- the selected provider initialized through `AppsFlyerAttribution`;
- the key remained redacted in logs;
- the native bridge returned `initialized: true`;
- `trackEvent` returned `tracked: true` for the app-open path;
- sharing partners remained the empty deny-all allowlist.

Authenticated AppsFlyer browser automation reached **Settings → SDK Integration Tests → Live events** for app `id6796698146`. The account has no registered test device, and the Live events workflow cannot start without one. The inspected dashboard state is `appsflyer-live-events-no-test-device.png`. Registering a persistent device identifier solely to satisfy this test would contradict the strict child-directed posture unless the provider supplies an approved non-tracking test-device mechanism. Therefore authoritative AppsFlyer backend receipt remains an external provider-console blocker, not an untried browser path.

## Strict/AdMob linkage

- The shell resolves `AppsFlyerFramework-Strict` and product `AppsFlyerLib-Strict`.
- `otool -L` on the strict AppsFlyer binary contains neither `AdSupport` nor `AppTrackingTransparency`.
- The final app links those frameworks transitively through the approved Google Mobile Ads SDK. The Xcode link graph names `GoogleMobileAds` and `UserMessagingPlatform`; the generated project contains no manual AdSupport/ATT wiring.
- Final `Info.plist` has no `NSUserTrackingUsageDescription`.
- Final privacy manifest declares `NSPrivacyTracking=false` and no tracking domains.
- Physical launch logs contain no ATT authorization request or prompt.

The release assertion is therefore provider-specific: AppsFlyer must resolve the Strict artifact and itself have no AdSupport/ATT linkage; operational AdMob’s documented transitive frameworks do not falsely fail that assertion while the app-level no-ATT declaration and runtime gates remain mandatory.
