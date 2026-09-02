# Find games: acquisition and monetization readiness

Date: 2026-08-26
Scope: Find the Dog, Find the Bird, and Marble Run; repository state plus official platform prerequisites.

## Decision

Do not begin by adding another advertising SDK independently to each game. The repository already has a shared `@fabrikav2/sdk` composition model and closely related Find-game integrations. First choose the measurement authority, reconcile the newer Find the Dog AdMob work into the intended release branch, and prove one production event path on a physical iOS build. Then port the resulting composition to Find the Bird.

For campaigns tomorrow, the shortest honest path is:

1. Confirm the store listing, bundle ID, Firebase/GA4 property, and Google Ads account ownership for each Find game.
2. Use the existing Firebase Analytics event path for Google Ads measurement; link GA4/Firebase to Google Ads and import `first_open` plus one meaningful in-game event.
3. Decide whether Meta campaigns will receive events through Meta App Events directly or through the existing attribution provider. Do not add both until ownership and deduplication are explicit.
4. Verify current-build events from physical devices in the correct vendor console before spending money.
5. Treat in-game ad monetization as a separate release lane with consent, placement policy, test ads, live-fill evidence, and store disclosure checks.

## Repository findings

### Shared foundation already exists

- `packages/sdk` contains provider-agnostic analytics, attribution, ads, IAP, and environment selection.
- Both Find games have `src/sdk/SdkContext.ts`, Firebase analytics sinks, Adjust attribution, owned analytics mirroring, privacy consent, remote config, and ad service seams.
- The two Find-game SDK trees are substantially siblings rather than independent implementations. Reuse should happen through the shared package or by reconciling the known game-specific delta, not by creating a third composition.

### Find the Dog

Current checked-out `main` (`4bf1dd0ac`) contains:

- Firebase Analytics on native iOS only when complete Firebase config is present.
- Adjust attribution on iOS with app-open, level-start, level-complete, level-fail, and rewarded-watch events.
- AppLovin configuration paths and privacy/consent handling.
- A shared analytics contract and owned mirror.

However, all-ref history contains commit `3e25191db` (`feat: migrate Find the Dog iOS ads to AdMob`, 2026-08-18), and that commit is **not an ancestor of the checked-out main branch**. It adds the AdMob Capacitor plugin, production config validation, AdMob SKAdNetwork IDs, and explicit iOS AdMob selection while retaining Android AppLovin. This branch/merge state must be resolved before using Find the Dog as the canonical monetization reference.

The checked-out Capacitor ID is `com.basegamelab.find_the_dog.dev`, which is visibly a development identity. Campaign setup must use the actual store bundle/package identity, not this default.

### Find the Bird

- Has nearly the same SDK composition as the checked-out Find the Dog implementation.
- Uses Capacitor ID `com.basegamelab.findthebird`.
- Has Firebase Analytics, Adjust, AppLovin/AdMob selector seams, consent service, and production environment validation.
- Has TestFlight evidence through build 19 in its planning record, but no current campaign-console event proof was found in this review.
- No direct Meta/Facebook App Events integration was found in the Find-game source scan.

### Marble Run

Marble Run is the strongest operational reference for SDK verification, not necessarily the code template for the Find games:

- AppLovin MAX, AppsFlyer, Facebook Core, Firebase Analytics, Remote Config, and a device-facing SDK verifier are documented.
- AppLovin units loaded with real fill on an iOS simulator; physical render/show remained pending in `docs/ad-config.md`.
- Remote Config was device-verified on Pixel.
- AppsFlyer and Facebook Core event flow were device-verified on Pixel.
- The checked-in document says Firebase Analytics had unresolved platform verification at the time; later Android config files exist and should be rechecked against a current build rather than assumed live.
- Current repository history records Marble Run build 9 submitted to App Store review on 2026-08-26.

## Account dependency correction

AdMob acceptance is not a prerequisite for buying installs through Google Ads. AdMob is the publisher-side product used to serve and monetize ads inside an app. Google Ads is the advertiser-side product used to buy traffic or installs. They may be linked, but ordinary Google Ads App campaigns can be created without an accepted AdMob account.

The Google Ads **API developer-token rejection** documented in `/Users/base/dev/appletolye/personal_site/docs/reports/2026-08-25-google-ads-api-application-gap.md` is also separate. It blocks programmatic campaign management through the API; it does not block manually creating campaigns in the Google Ads web interface, assuming the Ads account, billing, store listing, and conversion setup are ready.

Live App Store Connect and public-store checks on 2026-08-26 establish the actual release state:

- **Find the Dog** (`6772100729`, `com.baseardahan.hiddenobj`) — version 1.0.2 is `READY_FOR_SALE` and publicly available in Turkey: https://apps.apple.com/tr/app/find-the-dog-hidden-puppies/id6772100729
- **Find the Bird** (`6796698146`, `com.basegamelab.findthebird`) — version 1.0 is `PENDING_DEVELOPER_RELEASE` with manual release. It is approved but not public; the Turkish public URL returns 404. Releasing it is a separate public-deploy decision requiring explicit authorization.
- **Marble Run** (`6793860059`, `com.basegamelab.marblerun`) — version 1.0 is `READY_FOR_SALE` and publicly available in Turkey; version 1.0.1 is `WAITING_FOR_REVIEW`: https://apps.apple.com/tr/app/marble-run-sort-puzzle/id6793860059

Therefore Find the Dog and Marble Run are selectable candidates for Google Ads App campaigns and Apple Ads now, subject to account/billing and campaign-console availability. Find the Bird becomes eligible after its approved version is manually released. No public Google Play listing was found for the checked package IDs.

## Acquisition campaigns: required work

### Google Ads

Google's supported Firebase route requires each app to be registered in Firebase with Google Analytics enabled, the current Analytics SDK installed, relevant events logged, the GA4/Firebase property linked to Google Ads, and intended events imported as conversion actions. Android Play installs may be measurable without an SDK, but in-app optimization and iOS measurement still require an analytics/attribution path.

Per Find game:

- Verify production bundle/package identity against the live store listing.
- Verify Firebase native config is actually embedded in the release build.
- Confirm `first_open` reaches the correct GA4 property from a clean physical-device install.
- Select one optimization event. `level_complete` is a better early quality signal than a custom event that occurs too rarely to train a campaign.
- Link Firebase/GA4 to Google Ads and import conversion actions.
- Confirm account permissions: Google Ads admin plus Firebase owner or GA4 editor/admin; Play Console ownership for Android where applicable.
- Record attribution/privacy behavior for iOS, including SKAdNetwork and consent choices.

### Meta Ads

Meta app-promotion readiness requires a Meta developer app configured with each platform identity and store listing, a current event integration, verified activation/install and optimization events in Events Manager, plus iOS privacy/ATT and SKAdNetwork configuration where tracking applies.

No direct Meta App Events implementation was found in the Find games. Before adding one, decide:

- **Direct Meta SDK:** simplest path for Meta-specific optimization, but adds another native SDK and event owner.
- **Existing attribution provider:** potentially keeps one attribution authority, but requires confirming current Adjust account/config, Meta partner integration, event mapping, and deduplication.

The decision should be account- and ownership-driven. SDK installation without console ownership and event readback is decorative plumbing.

## Monetization: required work

For Find the Dog and Find the Bird, separately from acquisition:

- **AppLovin MAX is currently unavailable per Batu's account-state correction.** Do not treat the existing code integration as an operational monetization option. Inbox verification was attempted on 2026-08-26 but the Gmail connector was unavailable in this agent session; the exact vendor reason and next action remain to be recovered from email.
- Choose the production network/provider matrix by platform. Do not inherit the checked-out branch ambiguity.
- Obtain app IDs and banner/interstitial/rewarded unit IDs under accounts the studio can operate.
- Define placements and pacing through remote config, with kill switches and cooldowns.
- Integrate consent/privacy behavior before SDK initialization and update store privacy/data-safety disclosures.
- Verify test ads first, then real live fill and actual rendering on physical iOS and Android builds. Loading an ad is not proof that showing it works.

Find the Dog's unmerged AdMob migration is the best candidate implementation reference for iOS. Marble Run's verifier pane and evidence discipline are the best verification reference.

## Two-game acquisition matrix

### Find the Dog

- **Apple Ads:** eligible now because version 1.0.2 is live. No third-party SDK is required for a basic campaign.
- **Google Ads:** eligible at the store level now. Firebase event contracts exist, but live production-console delivery and Google Ads conversion linkage remain unverified.
- **Meta/Facebook Ads:** eligible at the store level now. No direct Meta App Events integration was found. The code contains an Adjust attribution path, but production Adjust credentials, Meta partner connection, event mapping, and live event delivery remain unverified.

### Find the Bird

- **Apple Ads / Google Ads / Meta Ads:** blocked from app-install launch until the approved version is manually released. The App Store version is `PENDING_DEVELOPER_RELEASE`, not rejected or awaiting review.
- Its checked local `.env` explicitly disables Adjust and AppLovin. No direct Meta App Events integration or Meta credentials were found.
- Firebase and Adjust code paths exist because Find the Bird mirrors the Find the Dog composition, but code presence is not production measurement readiness.

### Meta implementation decision

The lowest-duplication candidate is to use the existing Adjust path as Meta's measurement partner, provided the studio has or creates operational Adjust apps for both titles. That requires connecting Adjust in Meta Events Manager, adding Meta in Adjust Campaign Lab, mapping canonical events such as app open and level complete, and proving real delivery. If Adjust forwards events, equivalent automatic/manual Meta SDK event logging must remain disabled to avoid duplicates. Direct Meta App Events is the alternative if Adjust account cost or ownership is unacceptable; do not ship both paths for the same events.

## Tomorrow-ready checklist

A campaign can honestly start tomorrow only if these are true for the selected game/platform:

- Store listing is live and the production app identity is known.
- Vendor accounts and permissions are available now.
- A current store-equivalent build sends `first_open` and the chosen optimization event to the intended property/provider.
- The event is visible and selectable in Google Ads or Meta Events Manager.
- Privacy policy, consent behavior, ATT/SKAdNetwork configuration, and store disclosures match the shipped SDK behavior.
- Campaign geography, budget, creative, optimization event, and success threshold have human approval.

If those are not true, tomorrow's deliverable should be a verified measurement build—not a campaign spending against blind attribution.

## Recommended sequence

1. Resolve Find the Dog's production identity and the fate of commit `3e25191db`.
2. Prove Firebase `first_open` + `level_complete` on a physical Find the Dog build and import them into Google Ads.
3. Diff Find the Bird against the reconciled Find the Dog composition and port only the configuration/game-identity delta.
4. Choose direct Meta App Events versus attribution-partner forwarding; then implement once in the shared/native-shell lane where possible.
5. Open a separate monetization lane using Find the Dog AdMob code plus Marble Run's verifier/evidence pattern.

## Sources

Repository:

- `games/find_the_dog/src/sdk/SdkContext.ts`
- `games/find_the_bird/src/sdk/SdkContext.ts`
- `packages/sdk/src/`
- `games/marble_run/docs/ad-config.md`
- `games/find_the_bird/docs/plans/2026-08-06-overnight-polish-RECORD.md`
- git all-ref history, especially `3e25191db`

Official platform documentation:

- Google Ads, mobile app conversion setup: https://support.google.com/google-ads/answer/16056245
- Google Ads, app campaign for installs: https://support.google.com/google-ads/answer/12575501
- Google Ads, mobile app conversion tracking: https://support.google.com/google-ads/answer/6100665
- Firebase Analytics for Android: https://firebase.google.com/docs/analytics/android/get-started
- Firebase Analytics for Apple platforms: https://firebase.google.com/docs/analytics/ios/get-started
- Meta App Events for iOS: https://developers.facebook.com/docs/app-events/getting-started-app-events-ios
- Meta App Events for Android: https://developers.facebook.com/docs/app-events/getting-started-app-events-android
- Meta Android SDK source: https://github.com/facebook/facebook-android-sdk
- Meta iOS SDK source: https://github.com/facebook/facebook-ios-sdk

## Limits

This was a read-only repository and documentation review. No vendor console, current production build, physical device, Telegram history, or live campaign account was inspected. The working tree already contained extensive unrelated changes; none were modified. Platform requirements should be rechecked during implementation because vendor SDK and privacy rules change.