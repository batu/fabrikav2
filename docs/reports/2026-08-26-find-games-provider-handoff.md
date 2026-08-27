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
- Physical-device ad serving remains unverified because no production Find-game AdMob records/IDs exist and account-side approval is incomplete.

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

## Blockers and decisions for Batu

1. Choose Meta measurement: attribution-provider forwarding or direct Meta App Events, not both.
2. Decide whether to adopt/reconcile the separate Find the Dog AdMob migration (`3e25191db`) with this provider-selection branch.
3. Provision a real native AdMob lane for Find the Bird before calling Android AdMob operational.
4. Wait for AdMob account acceptance before expecting production ad revenue.
5. Verify Google Ads, Meta Business, Apple Ads, Adjust, and AppsFlyer account access directly; code presence is not account readiness.

## Direct AdMob API check (2026-08-27)

- Dedicated AdMob OAuth access succeeded (`HTTP 200`) and returned one account.
- The account contains one Android app record: **Block Blast Extreme**, unlinked, `ACTION_REQUIRED`.
- The account contains two Block Blast ad units (banner and interstitial).
- There are no Find the Dog or Find the Bird AdMob app records or ad units.
- The API does not expose enough payment/profile review state to call account acceptance complete. App approval, account/payment verification, and production serving are separate checks.

Required account-side sequence:

1. Resolve the existing Block Blast `ACTION_REQUIRED` notice in the AdMob console; do not infer its cause from the API enum.
2. Create/link a Find the Dog iOS app record to App Store id `6772100729`, then create banner/interstitial/rewarded units.
3. Do not link Find the Bird until its public release is explicitly authorized and the listing is public; its current App Store state is pending developer release.
4. Put resulting public app/unit IDs only in untracked release environment files, then run native build, sync, and physical-device test-ad verification before production serving.

No email was sent. No campaign was created or funded. No game was released, deployed, merged, or pushed.
