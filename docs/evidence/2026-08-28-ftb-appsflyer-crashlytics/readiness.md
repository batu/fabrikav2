# Find games measurement readiness

Date: 2026-08-28
Branch: `feat/ftb-appsflyer-crashlytics`

## Verified

- Dedicated exact-bundle Firebase identities and mode-0600 owner plists for both games.
- AppsFlyer Strict and Crashlytics-only native graphs; Adjust and Firebase Analytics absent.
- Deny-all partner sharing applied before AppsFlyer start.
- Shared typed event projection with bounded durable dedupe.
- RevenueCat revenue is emitted only after a successful verified purchase result with product, ISO currency, numeric revenue, and transaction identity.
- AdMob paid-impression callbacks supply format, placement, ISO currency, numeric revenue, and impression identity; mapper dedupe prevents repeats.
- Physical iPhone 12 Release crash, successful dSYM upload, authenticated Firebase issue receipt, and symbolicated developer-owned app frames.
- Canonical FTB device tour now captures all six states with non-blind markers; inspected win, fail, and settings artifacts.
- FTD composes the same AppsFlyer mapper, RevenueCat callback, AdMob callback, and provider-selection path.
- AppsFlyer Strict binary has no AdSupport/ATT dependency. Final-app AdSupport/ATT linkage is attributable to approved AdMob; no ATT usage copy, tracking declaration, tracking domains, authorization call, or physical-device prompt exists.
- The physical iPhone was registered privately as an AppsFlyer IDFV test device using the provider-supported Strict/no-ATT path. Authenticated Live Events received `retention_milestone`, `af_tutorial_completion`, and `af_level_achieved`; the clean run contains no raw legacy gameplay event names.

## Gates preserved

- AppsFlyer partner allowlist: empty.
- Meta/Google/Apple partner forwarding: disabled.
- Campaign delivery/spend: disabled.
- App Store submission/release: not performed.
- Production game release: not performed.

## Merge readiness

All requested implementation, privacy, physical-device, Crashlytics symbolication, and AppsFlyer backend-receipt gates are directly proven. The PR may be marked ready once final review passes and may merge normally when required CI checks pass and the merge remains conflict-free.
