# Find games provider-readiness handoff

Date: 2026-08-26  
Branch: `feat/provider-readiness-night`  
Scope: Find the Dog, Find the Bird, and `@fabrikav2/sdk`

## Outcome

The existing shared SDK remains the single provider architecture. The change adds explicit, validated provider selection instead of creating another service layer.

Both game composition roots now read:

- `VITE_AD_PROVIDER=auto|admob|applovin-max|disabled`
- `VITE_ATTRIBUTION_PROVIDER=auto|appsflyer|adjust|disabled`

Unknown values throw during composition. An explicitly selected but unavailable AppLovin configuration resolves to the disabled provider rather than silently falling back. The previous behavior remains under `auto` for compatibility.

## Implemented

- Added a shared closed-choice environment parser in `packages/sdk/src/config-env.ts`.
- Added explicit ad-provider selection to both owned and unowned shared ad composition.
- Added shared ad and attribution choice readers so games do not duplicate parsing or allowed-value lists.
- Changed both Find games from Adjust-only composition to the existing shared Adjust/AppsFlyer selector.
- Passed each game's injected environment into AppsFlyer configuration; tests no longer depend on ambient `import.meta.env`.
- Documented provider choice and AppsFlyer variables in both `.env.example` files.
- Preserved Firebase analytics as an optional sink gated by complete native Firebase configuration.

## Verified provider state

### Ads

- Shared adapters exist for AdMob, AppLovin MAX, and disabled operation.
- AppLovin MAX is not operational at the vendor-account level. Code configuration does not change that fact.
- Find the Dog's existing iOS AdMob migration (`3e25191db`) was reconciled onto this branch. iOS now composes AdMob through validated game-specific configuration while Android retains the shared selector.
- Find the Bird now has the equivalent switchable iOS AdMob package, configuration reader, native recipe, privacy declaration, SKAdNetwork catalog, plugin gate, and tests. Its iOS-mode web bundle builds successfully.
- Native-shell generation now omits AdMob package/app-ID/catalog wiring when `VITE_ADMOB_IOS_ENABLED` is false, preserving the provider-disabled shell path.
- Both Find games now have canonical iOS AdMob apps and banner/interstitial/rewarded units. All six formats were physically verified on Batu's iPhone using Google's sample inventory; see `docs/evidence/2026-08-27-find-games-admob-device-smoke/evidence.md`.

### Analytics and acquisition measurement

- Firebase, console, ring-buffer, GameAnalytics, and owned-mirror sinks already compose through the shared analytics facade.
- Decision recorded: Meta acquisition measurement will use attribution-provider forwarding (Adjust or AppsFlyer), not direct Meta App Events.
- The shared direct Meta provider remains disconnected from the Find-game event fan-out. Do not enable it for the same conversion events; that would duplicate measurement.
- Adjust and AppsFlyer are now selectable through one shared attribution seam. Native credentials and bridge availability still require direct verification.

## Tests and checks

Passing:

- `@fabrikav2/sdk`: 303 unit tests
- Find the Dog: 240 unit tests
- Find the Bird: 332 unit tests
- Full monorepo unit-test command
- Full monorepo TypeScript typecheck
- Full monorepo ESLint with two pre-existing warnings: `packages/sdk/src/analytics/console-sink.ts` and `games/arrow/content/level-tools/gallery/server/api.ts`
- Game-environment policy suite: 25 tests
- Find the Dog iOS and Find the Bird Android hermetic environment dry-runs
- `git diff --check`

The focused tests cover:

- Explicit AdMob selection on either native platform
- Explicit AppLovin selection failing closed when configuration is unavailable
- Explicit disabled-ad selection
- Explicit attribution disable despite valid Adjust configuration
- Invalid provider values throwing rather than silently defaulting
- Existing Firebase native gating and provider-composition matrices for both games

## Review and simplification

- Reused `createAdProvider`, `selectAttributionProvider`, and shared configuration helpers.
- Removed Find the Dog's local duplicate `envString` implementation.
- Centralized allowed provider values and parsing in their owning SDK modules.
- Preserved existing public function signatures by adding optional trailing provider preferences.
- Did not add a generic registry/framework; two closed provider unions solve the actual switching requirement with less machinery.
- An independent Codex review found that the new `.env.example` keys initially violated the exact canonical environment contract. The review finding was fixed by extending the shared policy, validating closed choices and AppsFlyer requirements, updating the hermetic fixture, and rerunning the policy suite/dry-runs.
- A second independent review after the fix found no actionable regressions; focused SDK tests and both game typechecks passed in that review lane.
- Find the Bird's native AdMob pass received two additional independent reviews. The first found a provider-disabled native-shell regression; the shell recipe was made conditional and regression-tested. The follow-up found no actionable regressions.

## Final account state and remaining gates (2026-08-27)

Completed:

- Find the Dog and Find the Bird each have one linked iOS AdMob app and exactly one canonical banner, interstitial, and rewarded unit. Guarded API diagnose readback reports `storefront_verified=true`, no missing units, and no extras for both games.
- Public IDs are committed in per-game manifests. Capacitor native registration now reads the same committed defaults as runtime composition.
- `https://basegamelab.com/app-ads.txt` serves the exact publisher authorization over HTTP 200 as `text/plain`.
- Find the Bird 1.0 is public in Turkey. The released binary predates this AdMob work, so a subsequent App Store build is required for revenue.
- Meta measurement decision is attribution-provider forwarding; direct Meta App Events stays disabled to prevent duplicate conversion events.

Hard gates requiring account access or explicit approval:

1. **App Store release:** archive/upload/submission and release are external actions. Prepare the next Find the Bird build from this branch only after deciding how to integrate it with current `main`; the attempted rebase encountered broad provider/config conflicts and was safely aborted.
2. **IAP/RevenueCat:** production product status, prices, entitlements, and offering mappings remain unverified because no usable App Store Connect issuer or RevenueCat administrative credential was available in this checkout/session.
3. **Apple Ads:** account/campaign creation and any budget are unverified external mutations. Create a paused campaign only after exact campaign, storefront, budget, and attribution settings are presented and approved.
4. **Google Ads API:** the cached grant belongs to a retired OAuth client and refresh returns `invalid_client`. Rotate the exposed client and complete fresh `adwords` authorization only after explicit credential-rotation approval; do not submit the re-review form without approval.
5. **AdMob review:** API inventory is converged, but the API does not expose the console's app-ads.txt crawl/review badge. Production serving readiness requires authoritative console readback after Google's recrawl.

No email was sent. No campaign was created or funded. No store build was uploaded or submitted. No credential was rotated.
