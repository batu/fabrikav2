---
status: partial
subject: Find the Bird banner exclusions
created: 2026-09-13
mode: pipeline
---

# Find the Bird banner exclusions

## Verdict

The 26-level banner exclusion, first-session automatic-ad suppression, and
future-generation guidance are implemented.
Physical iPhone evidence confirms the cactus-ranch banner is absent and the
previously obscured bird can be picked up. Native ad restoration on an unaffected
level and the other 25 excluded levels were not individually device-tested.

## Changes and scope

- The exact 26 stable IDs from the agreed saved 44-level serving list are in
  `excluded-levels.json`; an exact-match check against the runtime Set passed.
  The other 18 IDs keep their existing banner behavior. This is not a new live
  CDN audit or a geometric fix for all 101 local catalog folders.
- Native banner operations are serialized per provider, including error recovery,
  to prevent a delayed show/hide from overriding the next level's policy.
  Intentional suppression does not emit an ad-show-failed event.
- A fresh installation suppresses banners and interstitials for its entire
  first cold launch, including background/resume. Existing durable save evidence
  is captured before eager runtime imports. On subsequent cold launches normal
  automatic-ad eligibility returns, subject to the 26 banner exclusions.
  Unavailable durable storage keeps automatic ads suppressed. Optional rewarded
  ads (hints and completion bonuses) remain available, including the first launch.
  Level artwork and stored ad preferences are unchanged.
- `tools/level-editor/PIPELINE.md` now requires painted birds, sprites, props,
  and tap targets to clear the real banner footprint at supported viewport sizes
  and camera positions. This is documentation, not a new automated export gate.

## Verification

### Follow-up verification and economy telemetry

- Normal-player iOS 1.2.4 (39) was built from `f7ed93546`, with the harness
  disabled and production configuration validated, installed on the physical
  iPhone, and driven into cactus-ranch gameplay using the native XCTest runner.
  Inspected captures show the previously covered bird collected (0/15 to 1/15)
  without the banner. The first-launch policy still has automated coverage;
  the existing phone save was preserved.
- All 459 Bird unit tests passed (3 pre-existing skips); typecheck and lint passed.
  The prior GameAnalytics failure was an unapplied local postinstall patch.
  The attribution test now checks catalog cardinality, uniqueness and required
  AdMob/Meta entries instead of requiring an obsolete three-entry catalog.
- Restored missing workspace entries in the npm lockfile; an isolated
  `npm ci --dry-run --ignore-scripts` passed. Remote CI remains a separate gate.
- Initial remote CI passed the Bird workspace. Two baseline gate repairs were
  then required: exclude the shared rendering-library directory from game-only
  structure/harness checks, and rebuild five stale Dog catalog package records
  after images changed in historical commit `3f3427618`. The latter uses the
  existing public-level exporter and a new catalog snapshot; old snapshots,
  image bytes, geometry, level identity/order, cohorts and retention are preserved.
  Public-corpus validation passed for 104 packages; audit unit tests passed (60).
  No CDN, Remote Config or editor production state was published.
- Economy telemetry records visible hint options, affordability, option selection
  or decline, wallet snapshots at level start/hint use/offer display, and
  rewarded-provider outcomes before local grants. Coin prices, rewards and caps
  are unchanged. Selection is not proof of payment or grant; a provider
  `not_granted` result is not proof of video dismissal or no-fill.
- DOM tests exercise offer exposure, decline, coin purchase and wallet/callback
  preservation. Provider tests exercise granted, not-granted and thrown-error
  results; GA sink tests prove zero balances and boolean dimensions survive the
  SDK boundary. Authenticated analytics backend receipt is not yet verified.
- Independent reuse, quality and efficiency reviewers ran. Applied parameter
  normalization, explicit payload types and one shared modal-open snapshot;
  clarified selection semantics separately from successful resource grants.

### Post-release measurement

Use verified native version/build dimensions to isolate this release. Exclude
QA, historical identity-contaminated builds and unknown versions. Inspect raw
sample sizes before percentages. Measure zero-hint encounters before completion
6, single-hint affordability, rewarded-hint cap encounters, balances at level
starts 1/3/6/12, and requested/provider-result/local-grant counts separately for
hint and completion placements. Join ordered player activity where reporting
allows it; pooled event ratios are not player conversion rates. Historical
economy conclusions remain unavailable until authenticated reporting access is
restored. New telemetry cannot reconstruct events that were never collected.

### Initial verification (before follow-up)

- Focused Vitest suite: 37 tests passed across session/banner policy, bootstrap,
  ad event, and SDK composition tests. Covers allowed/excluded/allowed transitions,
  delayed show, delayed hide, disabled ads, no-fill, native failure recovery,
  first/returning launch, denied storage, and rewarded-provider calls during the
  first session.
- Full game suite: 451 passed, 2 failed, 3 skipped. Both failures reproduce in
  the unchanged main checkout: `gameanalytics-persistence.test.ts` expects a
  successful queue-deletion save patch in the installed dependency;
  `native-shell-manifest.test.ts` expects 3 SKAdNetwork entries but source has 50.
  No unrelated dependency or identifier changes were made. These block a green
  full-suite result and automatic merge.
- New policy import initially failed before implementation; the deferred-show
  regression then reproduced the race before serialization fixed it.
- Game TypeScript typecheck, game ESLint, and `git diff --check` passed.
- Debug iOS build and strict deep signature verification passed. Installed and
  launched that artifact on the connected physical iPhone 12.
  Installed local debug identity: `com.basegamelab.findthebird`, 1.0 (1).
  The final combined session/banner build was also built, installed and launched.
  The App Store build previously on the phone was 1.2.3 (38); no upload or store
  submission was performed. Existing progress was retained.
- Source base: `81d4d9be783cc3a5cb3ce6d783ab975f5fe4b802`, with this change.
  Initial banner-verification executable SHA-256:
  `630df5256e477df40017aa4e0e07c69c6b0c3f59878422fc61d2d3d77bddd356`.
  Final combined-policy executable SHA-256:
  `be05aed6749ef38208ef9f6dd7197fa14c077c01dc09e60dddb8a89cb5e01a4d`.
- Build flags enabled CDN and Remote Config; test harness enabled, automatic tour
  disabled. Device Web Inspector was disabled, so existing native XCUITest taps
  were used instead of the JavaScript harness.

## Physical captures

- [Before: live banner over the bird](assets/before-banner.png).
- [New build: no banner, before tap, 0/15](assets/after-before-tap.png).
- [New build: native tap succeeds, 1/15](assets/after-tap.png).

The before/after camera positions differ. The two new-build captures share a
camera position and prove the bird pickup outcome, not animation quality or
latency. The hint chip can still overlap part of this bird in this camera position;
this banner-only mitigation does not redesign the HUD.

## Reviews

- Reuse and efficiency reviewers: no findings.
- Quality/correctness reviewer: delayed native operations were fixed; final
  serialized behavior reviewed without a remaining correctness finding.
- Game-feel reviewer: no new visible regression; accepts the narrow cactus
  banner-removal and bird-accessibility result, with the gaps above.
- First-session policy was reviewed separately for bootstrap ordering and reward
  preservation; no blocking finding remained. A real first-install run was not
  performed, to preserve the existing phone save; automated bootstrap/service
  tests are the first-session evidence.

## Next action

Resolve the two baseline test failures before merge. Before a store release,
verify first and second launches on a clean QA installation without deleting
the operator's existing save, and capture a live banner on an unaffected level after an
excluded level; spot-check another excluded level and Android. Current device
captures are sufficient only for the stated cactus-ranch behavior. Production
users require a separately authorized build upload/release to receive this code.
