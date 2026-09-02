# Find the Bird release and ads handoff

## Mission

Make Find the Bird publicly playable on iOS today, prepare an Apple Ads user-acquisition campaign for tomorrow, and establish the shortest honest path to in-game ad monetization.

## Repository state

- Repo/worktree: `/Users/base/dev/appletolye/fabrikav2`
- Branch: `main` at `4bf1dd0ac`
- The main worktree is extremely dirty (5,475 status entries) with unrelated human/agent work. Do not modify, delete, revert, stage, or commit unrelated files. Prefer an existing relevant worktree or create isolated work.
- Relevant existing worktree: `.worktrees/provider-readiness-night` on `feat/provider-readiness-night`.
- Read first: `docs/reports/2026-08-26-game-ads-readiness.md`.

## Decisions and known state

- Find the Bird App Store version 1.0 is approved and `PENDING_DEVELOPER_RELEASE`; releasing it publicly is a production action requiring explicit user confirmation immediately before release.
- Monetization provider: **AdMob for iOS**. AppLovin MAX is operationally unavailable under the current account.
- Tomorrow's initial UA channel: **Apple Ads**. Basic Apple Ads acquisition does not require a third-party SDK.
- The approved binary likely cannot serve AdMob: Find the Bird currently selects AppLovin on iOS and its package does not include the native AdMob plugin. Confirm from the exact approved archive/build; do not infer completion from source alone.
- If AdMob is absent from the approved binary, release it ad-free and prepare a new AdMob-enabled build for Apple review. Do not claim same-day monetization.

## Goals for today

1. Verify the exact approved iOS build and request explicit authorization before manually releasing it in App Store Connect.
2. Confirm public App Store propagation and physically verify the released game is playable on iPhone.
3. Prepare tomorrow's Apple Ads campaign: product selection, geography, budget, keywords/targeting, creative/product-page readiness, and success threshold for human approval.
4. Confirm the approved binary's ad capability. If AdMob is absent, scope and begin the isolated AdMob-enabled follow-up build with consent, disclosures, placements, test ads, and device verification.

## Definition of done

- The approved version is publicly visible in the App Store and playable on a physical iPhone, with captured evidence; or release is explicitly blocked awaiting the user's production-release confirmation.
- A concrete Apple Ads campaign configuration is ready for approval and tomorrow's launch; do not spend or launch without explicit authorization.
- Monetization status is factual: either production ads are proven on-device from the approved binary, or a new-build/review requirement is documented and underway.

## Verification

Use the repository's `game-device-verification` and `portal-game-release` workflows. Verify the public App Store listing, install the public build on a physical iPhone, confirm build identity, play through representative gameplay, and capture evidence. Loading an ad is insufficient; rendering and dismissal must be observed on-device. Never expose credentials or commit environment files.
