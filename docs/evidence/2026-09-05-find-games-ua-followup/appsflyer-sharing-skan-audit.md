# Find games — AppsFlyer deny-all sharing vs. SKAN audit

Date: 2026-09-05. Scope: read-only source, installed SDK header, exact saved FTB IPA, and primary AppsFlyer/Apple/Meta documentation. No provider settings, privacy controls, repository code, devices, store state, policies, campaigns, or releases changed. This markdown is the only requested deliverable.

## Decision

**Keep `setSharingFilterForPartners(["all"])` before `start()`. Do not remove it to “fix SKAN.”** It blocks AppsFlyer sharing user data with partners; it is not the Apple SKAdNetwork transport-disable API. Apple sends SKAN postbacks to the winning ad network independently of AppsFlyer's user-level event-forwarding path. This architectural distinction is documented; successful SKAN delivery from these exact games is **not yet verified**.

**Prefer a separately approved, installs-only SKAN diagnostic/pilot over silently enabling Meta user-level forwarding or AEM.** There is no launch approval in this audit. SKAN install measurement, SKAN conversion optimization, AppsFlyer advertiser-side reporting, AppsFlyer partner event postbacks, and Meta AEM are different contracts. Do not substitute one for another.

| Intended mode | Exact recommendation with current deny-all binary | Required proof / remaining gate |
|---|---|---|
| Own-app AppsFlyer ingestion; no partner sharing | Retain current empty application `sharingPartners` and native `["all"]`. Starting/logging to AppsFlyer is not disabled by this filter. | Exact-build SDK/backend receipt, not `tracked=true`; privacy disclosures still need reconciliation. This is not proof of Meta attribution. |
| Apple SKAN → Meta; install optimization only | Preserve deny-all. Investigate/verify SKAN measurement enabled and actual install registration/CV API activity. No Meta SDK or user-level postback workaround is needed merely to establish the architectural route. | Correct advertised Meta app/store mapping, selected **SKADNETWORK** mode, eligible OS targeting, and eventual campaign-segmented SKAN install evidence. Meta says event configuration is not needed for mobile-app-install performance goals [M2]. Actual account eligibility remains unverified. |
| Meta SKAN results → AppsFlyer aggregate dashboard/API | Preserve deny-all. This is an inbound Meta SKAN-data integration, not a request to forward app users to Meta. | Per-app SKAN connection, authorized account/app access and `ads_read`, successful data pull, UTC reporting window. Owner approval required before establishing/changing a connection. Current connection state was not read. |
| SKAN post-install events / AEO / VO using AppsFlyer CV schema | Do not declare ready. Preserve deny-all while obtaining exact schema, mapping and import readbacks. AppsFlyer can own CV updates; the schema route is distinct from user-level postbacks. | AppsFlyer explicitly requires **In-app event postbacks ON** and event mappings for schema interoperability [AF4]. This console requirement is not permission to relax native filtering. Review egress implications first. Import and delayed CV evidence must succeed under the retained filter. Unspecified filter interaction with AppsFlyer-generated decoded SKAN postbacks requires vendor clarification if relied on. No revenue/VO promise without real revenue inputs and schema. |
| Meta MMP user-level install/event postbacks, including events for optimization | **Blocked by current native policy.** A console toggle cannot be treated as overriding `["all"]`. | Explicit privacy/data-sharing approval, reviewed client contract/code and tests, provider mapping/consent review, then separately approved binary/release and receipts. Do not set `sharingPartners=["facebook_int"]`: the app rejects it, and the underlying SDK API is an exclusion list, not an allowlist. |
| Meta AEM / Advanced Data Sharing | **Not a privacy-equivalent fallback to SKAN. Do not enable.** | AppsFlyer documents device-level identifier sharing, including devices without IDFA, when Advanced Data Sharing is ON [AF5]. Requires independent policy/consent/egress approval and compatible implementation. An “aggregate” reporting label does not prove aggregate-only collection or transport. |
| Strict requirement of no AppsFlyer collection, or no Apple attribution sharing at all | Current deny-all partner filter does **not** satisfy either broader requirement. | Separate requirements/approval needed. `isStopped`/not starting, anonymization, identifier collection, and `disableSKAdNetwork` are different controls; none changed here. |

## Exact local evidence

Repository prefix **R** = `/Users/base/dev/appletolye/fabrikav2/.worktrees/ua-code-audit`.

At audit read, `git rev-parse HEAD` returned `c641bd71c6404bfd2326d9b671c5de392111061d`; `git status --short` was empty. The two native bridge files and AppsFlyerConfig have no diff between candidate source `06cfd286d58ff6b51e7fd61bad51b697ab23517f` and this HEAD. This does not make all current branch fixes part of build34.

### Application implementation

Both exact source files have identical line numbering and content:

- `R/games/find_the_bird/native-resources/ios/App/AppsFlyerAttributionPlugin.swift`
- `R/games/find_the_dog/native-resources/ios/App/AppsFlyerAttributionPlugin.swift`

| Lines | Evidence and consequence |
|---|---|
| 17–23 | Initialization is idempotent; missing credentials fail; nonempty `sharingPartners` returns `initialized=false`. |
| 24–30 | Sets app identity, then `sdk.setSharingFilterForPartners(["all"])`, then `sdk.start()`. No `disableSKAdNetwork` assignment occurs in either complete bridge. Absence in this bridge is not proof of console measurement state or internal runtime success. |
| 35–41 | Calls `logEvent(name:values:) { _, _ in }`, discarding both callback outputs; immediately returns `tracked=true`. This proves a local SDK invocation, not acceptance by AppsFlyer or Meta. |
| 44–45 | `getStatus` reports the local initialized flag and AppsFlyer UID, not backend delivery or SKAN state. |

`R/packages/sdk/src/attribution/AppsFlyerConfig.ts:7–8,53–59,82–89`: describes an application allowlist but currently supports only empty/deny-all. **Line 57 is misleading if interpreted as a user-level forwarding recipe:** “keep deny-all and activate reviewed partners in the dashboard” cannot defeat the native exclusion filter. It can at most describe separately reviewed integration configuration; do not operationalize it as consent or forwarding capability. No edit made.

`R/packages/sdk/src/attribution/AppsFlyerAttributionProvider.ts:57–68,84–104`: forwards empty sharing configuration to native; legacy Adjust-shaped events are deliberately ignored; `trackConfirmed` uses native `tracked=true`, bounded by a timeout. Do not introduce blind retries on timeout: SDK queuing may already own an event.

### Installed vendor API header

Header **H** = `/Users/base/Library/Developer/Xcode/DerivedData/App-ecsegeslvyodlmcjwifkvechvvzy/SourcePackages/artifacts/appsflyerframework-strict/AppsFlyerLib/AppsFlyerLib.xcframework/ios-arm64/AppsFlyerLib.framework/Headers/AppsFlyerLib.h`.

The adjacent installed framework Info.plist reports `CFBundleVersion=6.18.1`.

- **H:276:** `@property(nonatomic) BOOL disableSKAdNetwork;` — a separate SKAN control.
- **H:433–438:** `start` and `startWithCompletionHandler` APIs.
- **H:468–471:** event API accepts a completion handler, which the app discards.
- **H:695–704:** “Block an events from being shared with ad networks and other 3rd party integrations”; “The sharing filter is cleared in case if `nil` or empty array passed as a parameter”; “\"all\" keyword sets sharing filter for ALL partners” and has highest priority.

Consequences: `nil`/SDK-empty is a privacy widening, **not** the app's empty/deny-all convention. `["facebook_int"]` excludes Meta rather than allowing it; combining `all` with named partners still denies all. Do not implement a pseudo-allowlist by simply passing application partner names into this SDK API.

Header inspection is installed SDK interface evidence, not vendor implementation source or proof of a closed-source backend rule. The installed strict package and exported IPA both report SDK version 6.18.1; byte identity between that local package and exported framework is not asserted.

### Exact saved FTB artifact reread

`/Users/base/store-review/find-games/builds/ftb-1.2-34/export/App.ipa`

- SHA-256 freshly recomputed: `d1f86610e7d7fd6af57a0dd6df388713a4aaa630166c6ce15c55f52b679d361f`.
- `Payload/App.app/Info.plist`: `com.basegamelab.findthebird`, version `1.2.1`, build `34`.
- `Payload/App.app/Frameworks/AppsFlyerLib.framework/Info.plist`: `CFBundleVersion=6.18.1`.
- `SKAdNetworkItems`: `cstr6suwn9.skadnetwork`, `n38lu8286q.skadnetwork`, `v9wttpbfk9.skadnetwork`.
- **`NSAdvertisingAttributionReportEndpoint` absent.** This build has not opted into Apple's developer-copy postback endpoint through that key. It can still participate in the ordinary Apple → winning-network path. The missing optional copy is a backend-observability limitation, not evidence Apple → Meta is broken [A2,A3]. Adding it requires approved artifact work; not a console-only change.
- `NSUserTrackingUsageDescription` absent. This does not demonstrate no AppsFlyer collection, and does not block SKAN API use [A1].

The SKAN IDs are principally **source/publisher-app configuration**; Meta's own IDs documentation explicitly links to Apple's “Configuring a Source App” [M1]. Their presence in this advertised game does not prove its own acquisition schema, attribution or postback receipt. A game can act as both an advertiser and an ad publisher; do not conflate those roles.

No device read/installation/launch performed. FTD source is verified; its distribution binary is not independently inspected in this audit. Existing handoff remains the authority for device-installed versions and prior canary results, not a fresh observation here. A stripped archive symbol read did not establish native execution order; source-to-candidate continuity and IPA metadata are reported separately, not as disassembly proof.

## Primary evidence and interpretation

### AF1 — exclusion semantics and timing

https://dev.appsflyer.com/hc/docs/preserve-user-privacy-ios#prevent-sharing-data-with-third-parties

> “use the `setSharingFilterForPartners` method before calling `start`.”
> “Partners that are excluded with this method will not receive data through postbacks, APIs, raw data reports, or any other means.”

https://dev.appsflyer.com/hc/docs/ios-sdk-reference-appsflyerlib#setsharingfilterforpartners

> “Lets you configure which partners should the SDK exclude from data-sharing.”

The iOS example explicitly labels `["all"]` as “All partners” and `nil` as “Reset list (default)”. Installed H independently confirms this contract. These statements govern AppsFlyer's partner-sharing route; they do not say Apple cancels its network postback.

### AF2 — attribution caveat, not a universal “all organic” rule

https://support.appsflyer.com/hc/en-us/articles/360001422989-Apply-privacy-preserving-SDK-methods

> “AppsFlyer will disable the sharing of user data with the excluded partner by any means...”
> “This does not apply to Advanced SRNs, where attribution is still possible; however, installs, re-engagements, and in-app events will not be shared back due to the sharing filter.”

Do not claim deny-all universally prevents AppsFlyer attribution, or that an attributed install proves an outbound Meta event. The document distinguishes non-SRNs, SRNs and Advanced SRNs and notes engagement-data limitations. Exact app/account integration behavior needs evidence.

### AF3 — SDK CV updates and Apple transport

https://support.appsflyer.com/hc/en-us/articles/360011420698-SKAdNetwork-SKAN-solution-guide

> “During each window, AppsFlyer sets the CV based on user actions and the defined CV schema.”
> “After the window closes, iOS sends the postback to the ad network and a postback copy to AppsFlyer.”
> “Ad network forwards enriched postback to AppsFlyer or SRN communicates postback data by API.”
> “SKAdNetwork reports don't contain user-level identifiers.”

The copy statement is conditional on the separate opt-in configuration in Apple's documentation; this IPA lacks it. AppsFlyer says its SKAN solution relies on ordinary in-app events to set CVs, and only one SDK should set CVs. Logging events to AppsFlyer and forwarding them to Meta are not the same step.

The guide also documents **AppsFlyer-generated decoded SKAN postbacks to partners**, distinct from Apple's original postback and from Meta's inbound reporting API. The consulted sources do **not explicitly specify** how a per-user `["all"]` filter affects that aggregate/decoded outbound route. Do not promise either suppression or delivery of this third route without vendor confirmation/account evidence.

### AF4 — Meta interoperability, required mappings, and bootstrap trap

https://support.appsflyer.com/hc/en-us/articles/360017095198-SKAdNetwork-SKAN-interoperation-with-Meta-ads

Full article, including collapsed procedures/FAQ, was read in a browser after the extractor omitted them.

> “Meta ads shares SKAN postback data for inclusion in the SKAN dashboard and aggregated reports.”
> “Allow Meta ads to share SKAN data with AppsFlyer. If you don't do so, you won't see SKAN installs attributed to Meta ads in the AppsFlyer SKAN dashboard.”
> “[Mandatory] From the Integration tab, turn on In-app event postbacks.”
> “If you don't map the events, Meta ads can't optimize and will only count installs.”
> “Completing the procedure enables Meta ads to get the CV schema from AppsFlyer using a proprietary randomized structure.”

The documented import can be disabled when the app has never sent an event to Meta using an MMP SDK. The FAQ recommends passing events via MMP, Facebook SDK or App Events API. **That is a privacy approval gate here, not an instruction to execute.** Do not send a synthetic event, remove the filter, add Meta SDK, or add server forwarding to unlock the UI. Ask vendor support for an aggregate-only/bootstrap path, or remain installs-only if eligible; otherwise stay blocked.

The article also states turning off **Activate partner** is insufficient to stop SKAN recording; SKAN connections are removed separately. This corroborates separate integration state, but does not by itself prove the sharing filter's backend handling of every SKAN-derived output.

### AF5 — AEM/Advanced Data Sharing is not SKAN

https://support.appsflyer.com/hc/en-us/articles/207033826-Meta-Ads-integration-setup#advanced_data_sharing

> “When Advanced data sharing is turned on, Meta receives postbacks and events with device-level identifiers for all devices, including devices that have not made their Advertising ID (IDFA) available.”

Do not equate no IDFA, no ATT prompt, strict SDK, AEM, anonymization and deny-all. Do not enable Advanced Matching or accept AMM terms as a hidden prerequisite for a SKAN-only pilot. AMM is a separately approved device-level reporting arrangement; the documentation says its expanded visibility is prospective for newly attributed devices after acceptance, not retroactive repair.

### A1–A3 — Apple owns transport and the optional copy

**A1:** https://developer.apple.com/documentation/storekit/skadnetwork

> “The information in the postback that Apple cryptographically signs doesn’t include user- or device-specific data.”
> “Apps don’t need to use App Tracking Transparency before calling SKAdNetwork APIs, and can call these APIs regardless of their tracking authorization status.”

Apple assigns ad networks the responsibility to receive install-validation postbacks at their registered URL, and advertised apps the responsibility to register installation by updating a conversion value on first launch. The current page also recommends AdAttributionKit for new work; this audit assesses the proposed SKAN route, not an unapproved migration.

**A2:** https://developer.apple.com/documentation/storekit/configuring-an-advertised-app

> “The advertised app doesn’t require any configuration to participate in install validation. However, to register ad attributions, the app needs to call one of the methods that update conversion values when the app first launches.”
> “To opt in to receive copies ... add the `NSAdvertisingAttributionReportEndpoint` key...”

**A3:** https://developer.apple.com/documentation/storekit/receiving-ad-attributions-and-postbacks

> “Starting in iOS 15, devices also send a copy of the winning postback to the advertised app’s developer, if the developer opts in to receive it.”

### M1–M3 — Meta primary documentation

**M1:** https://developers.facebook.com/docs/SKAdNetwork

Publisher-side Audience Network guide lists `v9wttpbfk9.skadnetwork` and `n38lu8286q.skadnetwork`, and explicitly says: “For more information, see the Configuring a Source App topic in the Apple StoreKit documentation.” Not an advertiser-side completion checklist.

**M2:** https://www.facebook.com/business/help/670955636925518/

> “Configuration isn’t needed if you’re only setting performance goals for mobile app installs.”
> “Import from a partner app. If you use a mobile measurement partner (MMP), you can configure your events on your partner’s platform.”

These passages were available in the first-party indexed search result; direct extraction returned only the page summary. Treat exact current UI/account eligibility as unverified, not as a successful setup. The result describes reviewing/confirming imported configurations and automatic refresh from the partner.

**M3:** https://developers.facebook.com/documentation/app-ads/SKAdNetwork-aem-and-limitations/

> “If you want to use Meta’s Aggregated Event Measurement, then set this field to `AEM`. If you want to use Apple’s SKAdNetwork, then this field should be set to `SKADNETWORK`.”
> “Once an SKAdNetwork Campaign is live, you cannot edit the promoted object or the SKAdNetwork flag.”

This page is dated October 5, 2023 and has campaign-count guidance conflicting with the newer AppsFlyer article. **Do not use either static count as a current account limit or blindly replay old API payloads.** Ads must validate the current API version/UI and read back selected mode, promoted app/store, and OS range before approving a campaign. A `*_to_14.4` range cannot satisfy a planned modern-iOS SKAN pilot. AEM must not be silently selected as fallback.

## Backend/reporting limitations

1. **Not user-level:** SKAN row-level postbacks are not user-level event exports. No deterministic join to GA device/session identity, true first-open flag, native build, or per-user retention can be required or fabricated. Keep product analytics and aggregate acquisition views separate.
2. **No direct copy in build34:** AppsFlyer visibility depends on the configured Meta SKAN-data connection for that route; absence of a normal non-organic install/export row does not prove Apple SKAN failed.
3. **Delayed:** AF3 documents SKAN4 window-1 delay of 24–48 hours after window closure and later-window delays of 24–144 hours, followed by reporting processing. AF4 documents daily Meta collection at 01:00 UTC and dashboard/aggregate updates seven hours later; schema changes may take up to 24 hours. Do not apply an immediate-event SLA to SKAN.
4. **Privacy suppression:** Fine/coarse CVs and dimensions can be null/reduced. AF4 states the minimum campaign install volume for post-install data is undisclosed. A small canary can establish setup or install evidence without proving useful AEO/VO signal. Null CV is not zero gameplay/revenue. Do not increase spend automatically to overcome it.
5. **Dates/metrics differ:** AF4 says SKAN postbacks lack actual install timestamps; Meta and AppsFlyer assign dates differently. AppsFlyer can receive up to seven days retrospectively on data sync. Match mode, UTC/window definitions and reporting provenance before comparing totals; no exact same-day/user-level equality claim.
6. **Current evidence is bounded:** `R/docs/handoffs/2026-09-05-find-games-ua-code-audit.md:84–90` reports one organic FTB install and zero rows in sampled event exports, with no exact-build device receipt. Those are prior operator observations, not fresh reads here and not a SKAN query. The same handoff reports no authoritative non-demo GA backend receipt.
7. **Delivery observability:** native initialization, `getStatus`, and `tracked=true` do not expose CV-rule download, Apple's update callback, postback transmission, provider ingestion or partner delivery. Need separate receipts for each claimed surface.
8. **Revenue and retention:** the handoff's contract is tutorial/progression/retention events, not proof of an AppsFlyer revenue connector. D1 has a documented build34 warm-return defect; current branch fixes are not in that IPA. Do not select VO or assert SKAN encodes every D1/D3/D7/D14/D30 event simply because canonical product events exist.

## Approval gates and owner checklist

**Ads / provider owner — first choose and record exactly one launch mode.** Read back both apps independently (FTB Store/AF ID `6796698146`, bundle `com.basegamelab.findthebird`; FTD `6772100729`, bundle `com.baseardahan.hiddenobj`). Check advertised Meta app ownership/Live status, ad-account permission, store mapping, selected campaign attribution mode and OS range. No current provider configuration is claimed by this research.

**For SKAN installs-only:** read current Conversion Studio measurement state and SDK support; read Meta SKAN connection and authorization state if AppsFlyer reporting is required; define reporting delay/null-CV acceptance and bounded spend/stop rules. Creating a connection or campaign requires separate owner approval. Preserve native deny-all.

**For SKAN AEO/VO:** first approve the actual schema and each case-sensitive event mapping. Establish one CV owner (AppsFlyer); verify import under deny-all and confirm it in Meta. Explicitly review the mandatory AppsFlyer postback toggle, recipients, data scope and any bootstrap event requirement. If uncertain, obtain written AppsFlyer/Meta clarification rather than broadening privacy. Suggested vendor question: “With iOS strict SDK 6.18.1, `setSharingFilterForPartners([\"all\"])` before start, can you confirm CV rule delivery/update, Meta MMP schema import, inbound Meta SKAN reporting, and AppsFlyer-generated decoded SKAN postback behavior separately, including a no-user-event bootstrap path?” No support message sent.

**Store / privacy owner:** reconcile the existing public disclosure mismatch (handoff reports Adjust/AppLovin text versus AppsFlyer/GoogleMobileAds artifact), approve any privacy change, and own exact distribution candidate/device window. This is not permission to publish policy changes. Any sharing-code change or optional developer-copy endpoint addition requires its own reviewed build/release approval; do not cancel pending review.

**Device owner:** only in the assigned Store-coordinated window, verify the exact installed build and real event opportunities without erasing saves/reclassifying upgrades. This audit performs no device actions. SKAN acquisition proof requires a genuine eligible ad→install opportunity or an explicitly identified test mechanism; a retained-install TestFlight update is not proof of a paid fresh install.

**Spend:** remain blocked until required artifact/runtime/provider checks and bounded pilot approval are recorded, or the owner explicitly accepts named missing measurement proof for a bounded diagnostic. Such approval does not authorize privacy widening, duplicate Meta paths, synthetic events, data deletion, merge/release, or automatic scaling.

## Completion and unresolved items

Completed: mode-specific documentation audit; both bridge line references; installed 6.18.1 API contract; fresh exact-IPA identity/hash/plist verification; identification of missing optional developer-copy endpoint; reporting limitations and approval gates.

Unresolved by design: live Conversion Studio schema/state, Meta import eligibility, account authorizations/mode, exact closed-source filter handling of AppsFlyer-generated decoded SKAN outbound postbacks, exact-device SKAN execution, backend SKAN receipt, and policy approval. Portal “Wrong passphrase” remains a known deferred publication/access issue and did not block this research. No Portal post attempted.

Research access notes: AppsFlyer collapsed setup text required browser recovery; Meta help-page full extraction was incomplete and its relevant primary-source search passages are labeled accordingly. A local Python helper initially hit quoting/version incompatibilities; corrected read-only commands successfully produced the IPA results above. No failed read was replaced with invented data.
