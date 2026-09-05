# Find Games paid-UA code-owner handoff — 2026-09-05

## Decision for Ads

**Do not launch paid UA yet. Build 34 is usable for an exact-candidate diagnostic canary, but is not a verified paid-UA relaunch baseline. A new approved binary is required to include the two confirmed projection fixes on this branch. Do not cancel or replace the pending review automatically.** Existing approval for build34 automatic release is unchanged; no merge, release, provider mutation, history deletion or spend was performed.

Branch: `audit/find-games-ua-cutover`. Isolated checkout: `/Users/base/dev/appletolye/fabrikav2/.worktrees/ua-code-audit`.

## Authority reconciliation

- Read the latest Find The session `20260902_094851_77f96385`, prior analytics audit, clean baseline, GA runtime solution and current git state before changes. Historical contamination and session replay are context, not a fresh diagnosis.
- Fetched `origin/main`: `06cfd286d58ff6b51e7fd61bad51b697ab23517f` (PR53), exactly the candidate. Local primary `main` is separately at `c5a2d2ffcea3323152d731aadb8894bd2484877c` with unrelated dirty work. It was not reset, merged or edited. Attribution and GA implementation paths under audit are unchanged between the candidate and that local main.
- The previous GA fix is already present via PR50 (`321c3feaa`); no duplicate runtime rewrite was made.
- Store's independently saved result reports at 11:09:37 UTC: 1.2.1 (34) WAITING_FOR_REVIEW, AFTER_APPROVAL; public 1.2 (33). Code owner did not repeat ASC mutations. Store evidence: `/Users/base/store-review/find-games/ftb34-store-audit-2026-09-05/`.
- Canonical Portal stream remains `find-games-release-operations`, Store post `p_e4c475`. Direct route read here returned Sign in, so no public-route visibility is claimed. Store already sent the Portal blocker notification. This repo handoff is the requested code evidence, not a replacement Portal stream.

## Exact identity and artifact

| Item | FTB | FTD |
|---|---|---|
| Store / AppsFlyer numeric ID | 6796698146 | 6772100729 |
| iOS bundle | com.basegamelab.findthebird | com.baseardahan.hiddenobj |
| GameAnalytics project | 351396 | 350269 |

FTB exact IPA: `/Users/base/store-review/find-games/builds/ftb-1.2-34/export/App.ipa`.
SHA-256: `d1f86610e7d7fd6af57a0dd6df388713a4aaa630166c6ce15c55f52b679d361f`.
Native Info.plist: 1.2.1 / 34 / com.basegamelab.findthebird.
ASC version `599b4922-8c6a-4cde-80bc-a07d90b7eb9f`, build `27bba3d8-11b6-480b-972d-20e40cb60dcc`, review `86f30192-632b-4d2c-915a-1e48615a7474` are the assigned Store authority identifiers.

Re-read the IPA, not just source:
- Own AppsFlyer ID present; foreign FTD AppsFlyer ID absent.
- Both FTB GA credential values match protected canonical local configuration; both FTD values absent. No values copied into this report.
- Compiled flags: AppsFlyer enabled; attribution provider appsflyer; GameAnalytics iOS enabled / game find_the_bird; Adjust iOS disabled; AdMob enabled / test mode false; Crashlytics enabled; AppsFlyer sharing partners empty.
- Exactly three SKAN IDs: `cstr6suwn9.skadnetwork`, `n38lu8286q.skadnetwork`, `v9wttpbfk9.skadnetwork`.
- No NSUserTrackingUsageDescription. This proves no declared ATT prompt string, not all runtime privacy behavior.
- Embedded JS build info is `sha:"06cfd286d5",version:"1.2.0"`. AnalyticsService.buildStamp and SdkContext derive GA `build=1.2.0+06cfd286d5`, `app_version=1.2.0`, not native 1.2.1 / 34. Store identified the same mismatch independently. Do not filter GA on 1.2.1 or assume a native build-number field exists.

## Attribution and privacy path

`games/find_the_bird/src/sdk/SdkContext.ts` selects AppsFlyer, installs the canonical projection, and retains game/platform/build/app_version/environment global product provenance. Shared release policy binds each game's own store ID and pinned GA credentials; sibling-ID rejection is covered by existing tests.

Both Find iOS AppsFlyer bridges reject nonempty sharingPartners and call `setSharingFilterForPartners(["all"])` before SDK start. This is an explicit deny-all partner-sharing policy, not proof that AppsFlyer forwards approved value events to Meta. Ads must reconcile this with the proposed attribution mode and partner console mapping. Do not remove the privacy gate silently. SKAN plist IDs alone do not prove mapping, conversion schema or a received postback. A deny-all partner filter is not by itself evidence that Apple SKAN transport is broken.

Legacy Adjust-shaped calls are deliberately ignored by AppsFlyerAttributionProvider.track; only canonical mapped value events use trackConfirmed. Thus service appOpen/levelStart calls are not independent duplicate AppsFlyer value events. Direct Meta event paths must remain disabled; Ads must verify no second server/partner path before activating anything.

Native `trackEvent` currently returns tracked=true immediately after logEvent and discards its completion error. JS dedupe records SDK handoff as successful, not a backend receipt. This is a known unresolved delivery-observability limitation. Do not naively change it to retry on a 3-second JS timeout: the SDK may already own an offline event, producing duplicates when it later uploads. Callback/timeout/SDK-queue semantics need a separate faithful native failure test before changing that contract. No exactly-once delivery claim is made.

Production-built TestFlight and public distribution share production analytics environment. The new environment guard stops development/test envelopes at the projection boundary; it does NOT automatically identify TestFlight as test traffic. Test exclusion still requires controlled device/window provenance and provider-side cohort segmentation.

Store additionally found the current app privacy page names Adjust/AppLovin while this binary uses AppsFlyer/GoogleMobileAds. Store/Ads must reconcile disclosures and consent policy before launch; no legal page or account settings were modified here.

## GameAnalytics audit

Paths: both games' `src/analytics/AnalyticsService.ts`, `GameAnalyticsSink.ts`, `GameAnalyticsEvents.ts`, `CanonicalAnalyticsEvents.ts`; shared analytics facade; `tools/patch-gameanalytics-persistence.mjs`.

- init shares one promise; lifecycle bridge suppresses repeated same-state transitions. First-open claim is durable, migrates existing game state, and fails acquisition identity closed when storage is volatile. Upgrade is not a new install.
- GA 4.4.7 creates a native session during initialize. Sink adopts it instead of calling startSession again. Canonical session:start remains a distinct design event. Suspend sends canonical close before native endSession; resume creates one next native session.
- Pre-readiness wrapper queue is bounded to 100 items / three init attempts. Loader/readiness retry is trigger-driven; explicit flush can exhaust bounded readiness retries. Queue before SDK handoff is memory-only, so crash/forced termination before readiness can lose events. This is not a durable exactly-once outbox.
- Native SDK persists its queue. Successful deletion persistence is patched and digest-pinned. Exact IPA chunk `GameAnalytics.node-CWtBZGzD.js` contains `e===h.Ok)i.delete(E.Events,g),i.save(a.getGameKey())` before sent logging. The historical acknowledged-event replay patch is actually bundled in build34.
- Clean isolated npm install with --ignore-scripts followed by the existing patcher succeeded. Main checkout's reused unpatched dependency initially failed the persistence test; that local dependency is NOT evidence the IPA is unpatched. Isolated patched install passes both sibling suites.
- Diagnostics truthfully leave lastSuccessfulFlushAt null. Client flush/sent means local dispatch, not backend ingestion. Canonical mappers retain safe game/build/platform/environment provenance and drop forbidden identifiers. No raw event UUID backend export was obtained to prove transport deduplication in production.

## Confirmed fixes, regression evidence

Two inherited projection defects were reproduced RED before production edits:
1. D1 return with a still-resident app emits app_foreground, not app_open; projection ignored it (zero forwarded calls). Fix handles either opening opportunity with the existing elapsed-day boundary and shared dedupe key.
2. Development level completion forwarded tutorial/progression into configured AppsFlyer (two calls). Fix rejects every non-production envelope before forwarding or touching retention storage.

Changes are limited to shared AppsFlyerAnalyticsProjection and tests; no game features, IDs or partner policy changed. Added integration coverage exercises real FTB AnalyticsService -> shared analytics -> projection through inactive/active lifecycle, including a repeated active transition. Focused independent review found no actionable regression in this diff. Its non-blocking suggestion was explicit test-environment coverage in addition to development; central guard covers both.

Verified after changes:
- SDK: 345 passed.
- FTB: 404 passed, 3 skipped (407 total).
- FTD: 322 passed, 2 skipped (324 total).
- SDK + FTB typecheck pass; SDK lint zero errors, one existing unused-eslint-disable warning; git diff --check passes.
- These prove code behavior, not physical-device analytics ingestion. Logs: `docs/evidence/2026-09-05-find-games-ua-code/assets/`.

## Physical and backend evidence

At 11:29 UTC full devicectl read with --include-all-apps verified paired iPhone 12, FTB native **1.2 (33)** and FTD 1.0.5 (25). Without --include-all-apps the distribution-installed FTB row was omitted; the first filtered read was insufficient. TestFlight is installed. No build34 install or launch is claimed. Concurrent Mage device work is present; coordinate a single phone window rather than racing another owner.

Physical blocker: exact build34 is not installed. Store supplies existing TestFlight build34; Ads assigns one device owner/window. Update without uninstalling or clearing storage; read back all-app native 1.2.1/34 before any canary. Never call a same-source development re-sign the exact App Store artifact. Fresh first_open=true additionally needs an approved clean device/install; do not erase Batu's save.

Live AppsFlyer read at 11:23:23 UTC, app id6796698146, Sep 5 UTC:
- organic installs: one row, app version 1.2.1;
- attributed installs: zero rows;
- non-organic in-app event report: zero rows; a separate subsequent organic_in_app_events_report read also returned zero rows.
No build column was available in the returned install row. Empty event exports are bounded report-window evidence, not proof that an exact device executed and failed to send gameplay. The install row is prerelease/unattributed evidence, not a build34 physical receipt or paid conversion.

GameAnalytics reporting credential discovery found ingestion credentials, not a reporting API token. Authenticated browser fallback for project351396 showed N/A overview and a Demo mode banner; an attempted Exit Demo changed navigation but did not yield an unambiguous production event view. No numbers from that view are accepted. Raw local read: `/Users/base/store-review/find-games/analytics/2026-09-05-code-audit-ga.json`. Need a non-demo project event export or authenticated query with exact custom build fields. No GA receipt matched to the candidate/device canary exists from this investigation.

## Minimal event contract

Identity G = game + provider project/app + iOS + environment + GA source stamp, joined to native version/build and a UTC canary window in operator evidence. Never forward raw device/session/transaction IDs as GA custom fields. Expected counts describe an observed test opportunity, not existing provider counts.

| Event / projection | Owner | Trigger | Identity | Expected count |
|---|---|---|---|---|
| install / first_open | AppsFlyer native install; canonical GA session first_open flag | genuine fresh install and first launch | own AF app; G; approved clean-device window | one install/first_open=true per real install; upgrades/resumes false |
| session_start / session_end | GA product facade + separate GA native lifecycle | cold launch, actual resume, actual suspend | G; separate native vs canonical session metrics | one canonical start per launch/resume; one close per suspend; no immediate phantom native restart |
| app_open / app_foreground | GA | bootstrap / real resume | G | one per corresponding transition; not counted as installs |
| level_start / level_complete / level_fail | GA progression | actual attempt, successful finish, terminal fail | G + level | one start per attempt; one appropriate terminal result; no invented complete on quit |
| dog_found -> dog:found (FTB legacy name), hint_used | GA | actual discovered bird / consumed hint | G + level | one per real action; retain names, no migration reset |
| af_tutorial_completion / af_level_achieved | AppsFlyer approved value projection | first level completion / levels 1,5,10,20,30,40,50 | own app; local durable dedupe | at most one per milestone per retained install state after SDK handoff |
| retention_milestone | AppsFlyer projection; GA owns retention analysis | real cold or warm return at elapsed days 1,3,7,14,30 since first-seen | own app; retained first-seen baseline | at most one per selected day; never install-day; build34 misses warm-only returns |
| ad lifecycle / ad_revenue_paid | GA behavior; AdMob revenue authority | actual request/show/fail/reward/paid callback | G + placement/format | one per corresponding callback/opportunity; purchase intent is not revenue |
| purchase funnel / verified purchase | GA intent; RevenueCat/store transaction authority | genuine purchase outcome / fulfillment | G + product; transaction dedupe stays local/native | one fulfillment per transaction; only verified store revenue counts |

## Non-destructive cohort proposal

Do not set the cutoff now. After Store proves public availability and a controlled exact-build receipt, Ads records T0 (UTC), native version/build, IPA hash, source stamp, provider IDs, campaign IDs and QA windows in Portal.

For diagnostic build34 GA queries use `game=find_the_bird`, `platform=ios`, `environment=production`, `build=1.2.0+06cfd286d5`, not app_version=1.2.1. AppsFlyer uses native version1.2.1 with install-time >= T0. These dimensions are not equivalent: native build34 is not remotely explicit in GA; same-source TestFlight is not separable by version alone. Keep QA/test devices/windows excluded or mark ambiguous rows unknown. Do not pretend timestamp alone proves absence of ongoing QA. A later fixed build needs its own verified source/native mapping.

Retain all old events. Quarantine known FTD1.0.4-in-FTB historical rows separately. Do not reset first-open/retention markers, create projects, delete cohorts, rewrite old installs or backfill synthetic events. Existing scorecard hard-codes FTB1.2.1 as test and 1.2 as clean; Ads must update the collector's policy after the actual public T0, not blindly promote all1.2.1 rows. Its report-failure handling also currently turns missing organic report into zero and unfiltered attributed rows into paid totals; those reports require fail-closed/segmented handling before new paid decisions.

## Counterpart actions and post-release validation

1. Ads: own decision; keep archived campaigns inactive, spent FTD campaign120249302115590442 PAUSED. Reconcile Meta advertised-app/store mapping, partner-sharing policy and SKAN schema; define bounded attribution acceptance and spend approval separately.
2. Store: keep build34 review/monitor unchanged; reconcile privacy disclosures; schedule TestFlight upgrade with one device owner. New fixed binary requires specific merge/release authorization and fresh artifact proof.
3. Find The/device owner: in the assigned window, verify build34 native install, capture launch -> one level attempt -> background -> foreground -> second launch; prove first_open=false on retained install; physically capture AdMob opportunity, and read matching backend events. New branch's warm-return fix needs a later approved binary to prove natively.
4. Ads/provider owner: obtain non-demo GA raw event/custom-field receipt and AppsFlyer own-app acquisition evidence for the same window, dedupe by native provider IDs where available, reject impossible repetition. User-level partner postbacks and SKAN postbacks have different privacy/delay semantics; do not require or invent a deterministic cross-provider user join for SKAN.
5. Until exact receipt and approved pilot exist: no CPI, D1 or ROAS quality claim. Monitor candidate/source-segmented sessions and progression through next processed provider window and D1. Unexpected replay, missing provenance, duplicate partner paths or unmatchable QA traffic keep launch blocked; mitigation is no spend, never analytics deletion.
