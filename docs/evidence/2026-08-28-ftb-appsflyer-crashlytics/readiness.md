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

## Gates preserved

- AppsFlyer partner allowlist: empty.
- Meta/Google/Apple partner forwarding: disabled.
- Campaign delivery/spend: disabled.
- App Store submission/release: not performed.
- Production game release: not performed.

## Remaining external blocker

Authenticated AppsFlyer browser automation exhausted the SDK Integration Tests → Live events path. The account has no registered test device, so the test cannot start. The Strict SDK intentionally supplies no IDFA, and no approved non-tracking AppsFlyer test-device registration mechanism is available in the account. Native initialization and event acceptance are proven, but authoritative backend event receipt is not. The PR must remain draft and unmerged until the provider/account supplies an approved test-device path or equivalent backend readback.
