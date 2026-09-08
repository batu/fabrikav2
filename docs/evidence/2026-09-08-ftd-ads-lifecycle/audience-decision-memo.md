# Find The Dog iOS — audience treatment decision memo

Date: 2026-09-08. Status: **decision requested; nothing live changed.** This memo is evidence-backed but is not legal advice; the classification question below needs qualified legal judgment before any flag flip.

## 1. What is declared and shipped today (verified)

| Fact | Evidence |
|---|---|
| App Store age rating **4+**, `kidsAgeBand: null` (not in the Kids Category), `advertising: true` in the age-rating declaration | ASC readbacks captured 2026-09-06: `store-review/find-games/ios-submission-20260906/dog/age-rating-existing.json`, `app-infos.json` (READY_FOR_SALE 1.0.5, PREPARE_FOR_SUBMISSION 1.0.6) |
| Store copy positions the game as relaxed casual play for a general audience: "made for unhurried play", keywords `puzzle, seek, spot, relaxing, hints, visual, scavenger, casual, brain, observation, illustrated`. No "for kids / for children" terms (Apple 2.3.8 reserves those for the Kids Category). | `dog/localizations.json` (en-US) |
| Privacy nutrition label declares **"Advertising Data — used for tracking purposes"** and Device ID for third-party advertising | `dog-asc-privacy.txt` |
| Shipped binary 1.0.6 (26) has **no `NSUserTrackingUsageDescription`** and never prompts ATT | implementation-audit.md (IPA Info.plist), repo: no plist key anywhere outside tests |
| Every ad request runs with `tagForChildDirectedTreatment: true`, `tagForUnderAgeOfConsent: true`, `MaxAdContentRating.General`, `npa: true`; UMP `requestConsentInfo` also sets under-age | `packages/sdk/src/ads/AdMobProvider.ts` init options (unchanged by this branch) |
| Bridge `@capacitor-community/admob` 8.1.0 exposes only the two boolean tags; it has **no** `ageRestrictedTreatment` or `publisherPrivacyPersonalizationState` surface | `node_modules/@capacitor-community/admob/ios/Sources/AdMobPlugin/AdMobPlugin.swift:307-313` |
| Sep 1–7 Dog traffic is mostly US (54 of 83 unattributed installs; 329 of 456 banner impressions) | AppsFlyer raw organic installs; AdMob country cut (`scorecard/`) |
| No age or audience-composition data is collected anywhere in the product | analytics registry forbids identifiers; no age screen exists |

Two internal inconsistencies worth fixing regardless of the audience decision:

1. **Privacy label vs. behaviour.** The label declares tracking, but the app cannot track: it never requests ATT and child-directed treatment suppresses the IDFA. Either the label overstates (fix the label) or a future adult path will need ATT and the label is already ahead of it. This is a human decision (ASC edit), not code.
2. **Both age tags set true.** Google's current iOS targeting guide (updated 2026-09-03): "The tags to enable the child-directed setting and tagForUnderAgeOfConsent shouldn't both simultaneously be set to true. If they are, the child-directed setting takes precedence." Harmless in effect (child wins) but it signals a copy-paste configuration rather than a decided one. Google also now marks both booleans **deprecated** in favour of `GADRequestConfiguration.ageRestrictedTreatment` (`.child` / `.teen` / `.unspecified`) plus `publisherPrivacyPersonalizationState`.

## 2. The classification question

Under COPPA (FTC FAQ, amended Rule of 2025-04-22), "directed to children" is a totality test: subject matter, visual content, animated characters or child-oriented activities, music, age of models, child celebrities, language, whether the advertising is directed to children, **competent and reliable empirical evidence regarding audience composition**, and evidence of intended audience. No single factor decides.

Applied to Find The Dog:

- **For "directed to children":** puppies as the core subject; bright illustrated scenes; extremely simple tap-to-find mechanic; 4+ rating; a "hidden puppies" title.
- **Against / toward general or mixed:** store copy explicitly targets unhurried adult casual play ("relaxing", "brain", "observation"); no child-oriented incentives, no cartoon characters with child appeal beyond the dogs themselves; no child celebrities; ads are contextual General-rated; the operator's stated intent (Batu, 2026-09-08) is a child-friendly game for a broad audience including adults; paid acquisition targets adults on Meta.
- **Unknown:** actual audience composition. There is no empirical evidence either way, and AppsFlyer/GameAnalytics cannot supply it.

Child-friendly content is not the same as child-directed. But a puppy-finding game with a 4+ rating is close enough to the line that the FTC's **"mixed audience"** category is the realistic target if the owner wants any adult treatment: a service that appeals to children but whose primary audience is not children may use a **neutral age screen** and apply COPPA treatment to users who identify as under 13. A pure "general audience" position (no age screen, treat everyone as adults) is not defensible on this evidence.

Apple's constraints (guidelines 1.3 / 5.1.4, living document): the app is not in the Kids Category, so third-party advertising is permitted; "apps intended primarily for kids should not include third-party analytics or third-party advertising"; birthdate may be asked "only for the purpose of complying with these statutes" and the app must remain useful regardless of age. A neutral age screen for COPPA compliance is therefore permitted and, if adult treatment is wanted, expected.

## 3. Options

| Option | Age treatment | Personalization / IDFA | Demand eligibility | Risk |
|---|---|---|---|---|
| **A. Status quo (child-directed for all)** | `.child` for everyone (current booleans) | none; no ATT | AdMob child-eligible demand only; AppLovin/MAX mediation auto-disabled and AppLovin forbids initializing its SDK for a child (Google AppLovin adapter guide, 2026-09-03) | Lowest legal risk; leaves adult demand on the table; contradicts the "tracking" privacy label |
| **B. Mixed audience with neutral age screen** | Age screen before any ad SDK init: <13 → `.child`; 13–17 → `.teen`, NPA; 18+ → `.unspecified` + UMP consent + optional ATT | 18+ with consent (UMP) and ATT authorization; teens NPA; children none | Adult cohort eligible for personalized AdMob demand and (later) one eligible mediation source; child/teen cohorts stay as today | Requires legal sign-off that the primary audience is not children, an age-screen UX, a bridge API migration, label + policy updates, and tests |
| **C. General audience, no age screen** | `.unspecified` for everyone | personalization by consent | broadest | Not defensible given subject matter and 4+ rating; rejected |

**Recommendation: prepare Option B, do not flip anything until the gates below clear; keep Option A live meanwhile.** Ad content suitability stays `General` in every branch: the app is 4+ and content rating is separate from age treatment.

Unknown-age handling under B: anyone who dismisses or fails the screen is treated as **child** (current behaviour), never as adult. Returning users re-enter the screen only if no durable answer exists; the answer is stored locally as a coarse band (child / teen / adult), never a birth date, and never sent to analytics. A neutral screen means free-form date entry or a neutral age-band picker that does not default to or nudge toward 13+.

## 4. What Option B needs before approval

1. **Legal judgment** on the mixed-audience position for this specific product (subject matter + 4+ rating + adult-facing copy), including the revised COPPA Rule's treatment of persistent identifiers for contextual advertising and the 2025 amendments. Not something to decide from this memo.
2. **Bridge API migration:** the plugin only exposes deprecated booleans. Either upgrade `@capacitor-community/admob` to a version exposing `ageRestrictedTreatment` / `publisherPrivacyPersonalizationState`, or add a small native patch in the existing `tools/patch-*` style (hash-pinned, verified at release preflight). Restrictions must be applied **before** `MobileAds.initialize` and before the first `requestConsentInfoUpdate`.
3. **Consent lifecycle tests:** `requestConsentInfoUpdate` every launch; gate on `canRequestAds` both immediately after the update and after form completion, deduplicated so initialization happens once; privacy-options entry point when `privacyOptionsRequirementStatus` requires it (exists in Settings today); error path uses prior-session consent rather than disabling ads forever; denied / unknown / returning-user branches. ATT refusal must not disable ads (contextual ads remain allowed).
4. **Store and label updates:** privacy nutrition label aligned with actual tracking behaviour; add `NSUserTrackingUsageDescription` only if ATT is actually requested for the adult path; keep the app out of the Kids Category; keep 4+.
5. **Product decision:** age screen placement (first launch, before the first ad SDK call; the game must be fully playable before and after), copy, and the fact that a wrong-but-reversible answer defaults to child treatment.
6. **Measurement:** the `ad_lifecycle` contract on this branch carries no age band; if B ships, add a coarse `age_band` dimension only after the legal review confirms it is acceptable to log.

## 5. What is explicitly not recommended

- Removing or "blanket-disabling" TFCD/TFUA/NPA to chase eCPM.
- Treating unknown-age users as adults.
- Lowering `maxAdContentRating` below General.
- Initializing AppLovin/MAX or any child-ineligible network before the decision; MAX is not a workaround for child restrictions.
- Promising a revenue uplift: the only adult-relevant observed prices are Sep 1–7 US rewarded $9.62 and US interstitial $3.99 eCPM at 9 and 30 impressions respectively, all under child treatment. No forecast is supportable.

## Sources

- Google AdMob iOS targeting: https://developers.google.com/admob/ios/targeting (last updated 2026-09-03)
- Google UMP iOS: https://developers.google.com/admob/ios/privacy (2026-09-03)
- Google AppLovin adapter child restrictions: https://developers.google.com/admob/ios/mediation/applovin (2026-09-03)
- Apple App Review Guidelines 1.3, 2.3.8, 5.1.4: https://developer.apple.com/app-store/review/guidelines/
- FTC COPPA FAQ (notes the Rule was amended 2025-04-22): https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- Local evidence: `/Users/base/store-review/find-games/ios-submission-20260906/` (ASC readbacks), `/Users/base/store-review/find-games/analytics/ftd-admob-audit-20260908/`, this directory's `scorecard/`.
