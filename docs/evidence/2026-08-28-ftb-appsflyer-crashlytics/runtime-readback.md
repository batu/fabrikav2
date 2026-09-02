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

1. A bounded test-only native diagnostic displayed `UIDevice.identifierForVendor` on the physical iPhone without logging or committing it. The diagnostic was removed from both source and generated native shell immediately after private readback.
2. The IDFV was registered through **Settings → Test Devices** using AppsFlyer's supported iOS `IDFV` device type; the durable evidence intentionally omits the identifier.
3. After propagation, authenticated **SDK Integration Tests → Live events** was armed for app `id6796698146` and the registered iPhone.
4. The dashboard was cleared, the latest branch build was freshly installed, and its canonical all-states tour emitted exactly the approved in-app events `retention_milestone`, `af_tutorial_completion`, and `af_level_achieved`, plus SDK launch rows.
5. The selected level event contains only `af_level: 1`. Raw legacy names `appOpen`, `levelStart`, `levelComplete`, and `levelFailed` are absent from the clean run.
6. Dashboard General metadata reports SDK `6.18.1`, ATT status `-999`, and test device type `IDFV`. Device identifiers and AppsFlyer UID are excluded from committed evidence.

Inspected, privacy-cropped dashboard captures are under `appsflyer-live-events/approved-events.png` and `appsflyer-live-events/level-details.png`. This is authoritative AppsFlyer backend receipt for the physical Strict/no-ATT build.

## Strict/AdMob linkage

- The shell resolves `AppsFlyerFramework-Strict` and product `AppsFlyerLib-Strict`.
- `otool -L` on the strict AppsFlyer binary contains neither `AdSupport` nor `AppTrackingTransparency`.
- The final app links those frameworks transitively through the approved Google Mobile Ads SDK. The Xcode link graph names `GoogleMobileAds` and `UserMessagingPlatform`; the generated project contains no manual AdSupport/ATT wiring.
- Final `Info.plist` has no `NSUserTrackingUsageDescription`.
- Final privacy manifest declares `NSPrivacyTracking=false` and no tracking domains.
- Physical launch logs contain no ATT authorization request or prompt.

The release assertion is therefore provider-specific: AppsFlyer must resolve the Strict artifact and itself have no AdSupport/ATT linkage; operational AdMob’s documented transitive frameworks do not falsely fail that assertion while the app-level no-ATT declaration and runtime gates remain mandatory.
