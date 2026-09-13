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
