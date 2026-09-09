# Find games — general-audience code changes (Codex handoff)

## Mission
Both Find games (Find the Dog `games/find_the_dog`, Find The Bird `games/find_the_bird`) are now general-audience apps that run paid user acquisition (Meta ads, Apple Ads) with AppsFlyer attribution and AdMob monetisation. Make the codebase reflect that: ATT prompt, tracking-aware privacy manifest, AdMob no longer tagged child-directed, and Dog's AppsFlyer bridge brought up to Bird's. Work only in this worktree on branch `feat/appsflyer-general-audience` (HEAD `db59505a3`, which already replaced the AppsFlyer deny-all filter with an explicit blocklist). Do not touch `/Users/base/dev/appletolye/fabrikav2` (main checkout, dirty with other work). Do not merge. Commit on this branch in small commits with neutral messages.

## Tasks (all required)

1. **AdMob flags** — `packages/sdk/src/ads/AdMobProvider.ts`: `tagForChildDirectedTreatment: false`, `tagForUnderAgeOfConsent: false` in both the initialize options and `requestConsentInfo` options. Keep `maxAdContentRating: General`. Update `AdMobProvider.test.ts` to assert the new flags.

2. **ATT prompt owned by the AppsFlyer bridge** — for BOTH games `games/*/native-resources/ios/App/AppsFlyerAttributionPlugin.swift`:
   - First make Dog's bridge identical in structure to Bird's (Bird has the `didBecomeActive` observer / `initializeOnMain` foreground fix; Dog lacks it). The two files must end up byte-identical.
   - Before `sdk.start()`: `sdk.waitForATTUserAuthorization(timeoutInterval: 60)` when the initialize call carries `requestTrackingAuthorization == true` (default true from JS on iOS).
   - On the first `didBecomeActive` after initialization (and once only), call `ATTrackingManager.requestTrackingAuthorization { _ in }` (import `AppTrackingTransparency`, `if #available(iOS 14, *)`). Keep the existing behaviour that `sdk.start()` runs when active / on activation. The blocklist filter (`setSharingFilterForPartners(blockedPartners)` only when non-empty) stays before start.
   - `getStatus` additionally returns `attStatus` as a string (`authorized|denied|notDetermined|restricted|unavailable`).
   - JS: `packages/sdk/src/attribution/AppsFlyerAttributionPlugin.ts` add `requestTrackingAuthorization: boolean` to initialize options and `attStatus: string | null` to status; `AppsFlyerConfig.ts` adds `requestTrackingAuthorization` (env `VITE_APPSFLYER_REQUEST_ATT`, default true; add the key to `tools/game-env/src/policies/find-the-dog.mjs` canonical keys and to both `games/*/.env.example` with a one-line purpose comment). Provider passes it through. Update tests.
   - Info.plist: set `manifest.ios.trackingUsageDescription` in both `games/*/native-resources/ios/shell-manifest.json` to: `Allowing tracking lets us measure which ads bring new players and keep the game free with relevant ads.`

3. **native-shell generator/validator** — `tools/native-shell/src/native-shell.mjs`:
   - Treat `AppsFlyerAttributionPlugin.swift` as a tracking provider wherever `hasTrackingProviders` is computed (both in `patchPbxproj` and `validateGeneratedShell`), so `AdServices`, `AdSupport`, `AppTrackingTransparency`, `StoreKit` are weak-linked for AppsFlyer shells.
   - Replace the AppsFlyer forbidden list `['waitForATTUserAuthorization', 'AdSupport', 'requestTrackingAuthorization']` with requirements: the bridge must contain `waitForATTUserAuthorization`, `requestTrackingAuthorization`, `import AppTrackingTransparency`, `blockedPartners`, `sdk.start()`; still forbid `AdSupport` (no IDFA reads outside the SDK) and the deny-all filter.
   - Privacy manifest checks for AppsFlyer shells: require `<key>NSPrivacyTracking</key>\n\t<true/>` and a `NSPrivacyTrackingDomains` array (see task 4).
   - Update `tools/native-shell/test/native-shell.test.mjs` (manifest fixture, wiring expectations) and `tools/native-shell/test/appsflyer-foreground.test.mjs` (Swift harness: add `waitForATTUserAuthorization` and an `ATTrackingManager` double; assert ATT is requested exactly once after activation and that `waitForATTUserAuthorization(60)` precedes `start()`; run the harness against BOTH games' bridges).

4. **Privacy manifests** — `games/*/native-resources/ios/App/PrivacyInfo.xcprivacy` (both identical): `NSPrivacyTracking` → `<true/>`; add `NSPrivacyTrackingDomains` with `appsflyer.com` (AppsFlyer's SDK manifest declares its own domains; the app-level manifest must still declare tracking). Mark `NSPrivacyCollectedDataTypeAdvertisingData` and `NSPrivacyCollectedDataTypeUserID` with `NSPrivacyCollectedDataTypeTracking` `<true/>` and add purpose `NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising` where missing. Keep the rest.

5. **Verification (must all pass before you report)**
   - `cd tools/native-shell && npx vitest run && npx eslint .`
   - `cd packages/sdk && npx vitest run src/attribution src/ads && npx tsc --noEmit -p . && npx eslint src/attribution src/ads`
   - `cd tools/game-env && npx vitest run` (four pre-existing `no-undef` eslint errors in game-env are known; do not fix them)
   - `node tools/native-shell/validate.mjs --game find_the_bird --allow-missing` and same for `find_the_dog` must report no issues.
   - `diff games/find_the_bird/native-resources/ios/App/AppsFlyerAttributionPlugin.swift games/find_the_dog/native-resources/ios/App/AppsFlyerAttributionPlugin.swift` must be empty.

## Constraints
- No `rm -rf`; no changes outside this worktree; no edits to Adjust/AppLovin code paths; do not weaken the AdMob UMP consent flow.
- Do not reintroduce `setSharingFilterForPartners(["all"])`.
- Final report: list commits (sha + subject), the exact test/lint output tails, and anything you could not do with the reason.
