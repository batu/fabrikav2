# Find Games UA follow-up — 2026-09-05

Status: **partial — code and offline regression evidence passed; native distribution/backend evidence remains Store/provider-owned.** Suitable for source review, not release or relaunch approval.

## Decision and scope

Continue `audit/find-games-ua-cutover` from `c641bd71c6404bfd2326d9b671c5de392111061d`. The previous warm-return and non-production projection fixes remain included, but neither they nor this provenance correction are in build34. Build34 remains diagnostic only. No merge, release, deployment, campaign mutation, privacy-policy publication, partner-sharing expansion, device action, or analytics-history deletion occurred. Pending review and paused/archived campaigns were not touched. Portal report-view verification remains deferred after Ads received Wrong passphrase; no broad blocked alert was sent.

The supplied `/Users/base/store-review/find-games/coordination-store-result.txt` was empty when read. The existing `store-agent-ftb-1.2.1-result.txt` records the earlier build34 WAITING_FOR_REVIEW / AFTER_APPROVAL submission; this is not a new live Store observation.

## Provenance correction and why

The actual saved build34 archive command applied `MARKETING_VERSION=1.2.1 CURRENT_PROJECT_VERSION=34` after web compilation. `tools/game-release/src/ios-release.mjs` likewise compiles web assets before native stamping. A package.json/Vite-only correction would not reliably capture late Xcode overrides.

Both Find GA sinks now obtain `App.getInfo()` from the installed native binary before GA initialization. Queued and subsequent mapped GA events carry `native_app_version` and `native_build_number`. Existing `app_version` and `build` retain package/source-stamp semantics without rewriting history. The safe mapper explicitly allows the new fields and the sink prioritizes them under GA's field cap. No device/user/session identifier is added. Failed, invalid or timed-out native identity uses the existing bounded initialization/queue failure policy rather than emitting misleading native provenance.

Production regression compiles the real sink, canonical mapper, analytics facade, Capacitor JS and build-info plugin using each game's iOS production Vite configuration. Identical compiled bytes receive two late native identity fixtures (1.2.1/35 and 1.2.2/36); the GA fields change with native identity while source fields remain unchanged. These are TEST FIXTURES, not chosen release numbers or produced binaries. Baseline replay fails at missing `native_app_version` for both games; corrected code passes.

Limits: this is a production-compiled JS/bridge-contract test, not Xcode archive execution, real Info.plist runtime, complete SdkContext bootstrap, physical-device proof or GA ingestion. Store exclusively owns the next physical window and actual binary numbering.

## Collector correction and authority

Canonical collector: `/Users/base/.hermes/scripts/find-games-daily-scorecard.mjs`, located via the existing clean-measurement baseline and adjacent shell wrapper. It is not in a Git repository; no separate repo/worktree was invented. `collector/` is a review/reproduction snapshot, not a replacement canonical collector.

The canonical active script was edited in place; the existing schedule may use it on its next invocation. No cron config/wrapper was modified and the collector main/network/browser/publication path was not run. No existing report or latest.json was rewritten by this work.

- Missing/failed/malformed organic exports and blank version provenance produce null aggregates with incomplete status, never zero.
- Paid report row_count stays diagnostic. Paid acquisition requires exact app/version/campaign, complete timestamp and media provenance, approved UTC cohort, observed-time bounds and complete QA exclusion policy. Ambiguous rows yield incomplete/null rather than a partial clean total.
- Both paid cohorts remain null. No public T0 or version promotion was selected. Existing organic version quarantine is retained.
- Independent review reproduced four P2 edges: blank organic version, future same-day paid time, date-only/calendar-invalid install time, and whitespace-only dimensions. All were corrected tests-first; no actionable residual findings remain.

See `collector/README.md`, `collector/REVIEW-FOLLOWUP.md`, baseline, patch and portable tests. Parent verified snapshot/canonical bytes match and reran the canonical suite. The patch reproduces the canonical corrected source from the exact backup. Applying/merging this repository PR does not install the external collector.

## Authoritative verification

Parent ran on the final behavior-bearing tree:

| Command | Result |
| --- | --- |
| `npm run test:unit -w @fabrikav2/sdk` | 345 passed |
| `npm run test:unit -w @fabrikav2/find_the_bird` | 408 passed, 3 skipped |
| `npm run test:unit -w @fabrikav2/find_the_dog` | 326 passed, 2 skipped |
| `node --test tools/game-release/test/native-analytics-provenance.integration.mjs` | 2 passed; both games, two override fixtures each |
| `node --test /Users/base/.hermes/scripts/find-games-daily-scorecard.test.mjs` | 12 passed |
| SDK, Bird and Dog `npm run typecheck` | all exit 0 |
| `npx eslint .` in each Find game | both exit 0 |
| `git diff --check` | exit 0 |

Raw parent logs and command exit codes: `assets/verification.json`, `assets/sdk-suite.log`, `assets/ftb-suite.log`, `assets/ftd-suite.log`, `assets/production-propagation.log`, `assets/collector.log`. Worker logs preserve RED/GREEN chronology; exploratory failed test-harness/lint attempts are not final verification. Existing skipped credential/config tests and Node localStorage warnings remain visible.

Independent review: `provenance-review.json` (no actionable findings), `collector-review.json` (four findings, all resolved as documented). Correctness/testing/reliability/adversarial/API/standards and simplification lenses ran in independent worker contexts, inline per reviewer because nested delegation was unavailable. No cross-model review is claimed. Optional further tests: full production bootstrap composition, queued native-identity recovery across lifecycle, crowded field cap.

## Sharing/SKAN recommendation

Keep native `setSharingFilterForPartners(["all"])` before start. It is a partner exclusion filter, not Apple's SKAN disable control. Passing an SDK empty list clears the filter; passing `["facebook_int"]` excludes Meta rather than allowing it. Do not use either as a workaround.

- Own-app AppsFlyer ingestion: keep deny-all; still require actual backend receipt.
- SKAN installs-only: preferred mode to investigate for a separately approved bounded diagnostic; verify Apple registration, Meta advertised-app/mode/OS and delayed aggregate evidence. No approval to activate is provided here.
- Inbound Meta SKAN reporting into AppsFlyer: separate integration/authorization readback needed; not equivalent to outbound user-level sharing.
- SKAN post-install optimization: exact CV schema/mapping/import required. AppsFlyer documents mandatory in-app postback configuration and a possible MMP-event bootstrap trap; no privacy widening to unlock it. Verify compatibility under deny-all or get vendor confirmation and remain installs-only/not ready.
- MMP user-level forwarding and AEM/Advanced Data Sharing: not authorized and not compatible with claiming current deny-all allows forwarding. AEM is not a privacy-equivalent fallback.

Primary URLs, exact code/header/IPA evidence and mode-specific gates are in `appsflyer-sharing-skan-audit.md`. Parent re-read AppsFlyer privacy and SKAN interoperability primary pages. Exact effect of the native filter on AppsFlyer-generated decoded outbound SKAN postbacks is not explicitly resolved by consulted documentation; vendor/account evidence remains necessary if that route is relied upon.

## Backend limitations and approval gates

1. Native `tracked=true` still means immediate SDK handoff; callback errors are discarded. No exactly-once/backend-success claim and no unsafe timeout retry was introduced.
2. No exact-device GA/AF receipt or authoritative non-demo GA export is supplied by this follow-up. New fields are demonstrated at the GA SDK API boundary, not reporting backend.
3. Production TestFlight and public traffic still share environment; native version/build alone cannot exclude QA on the same binary. Ads must approve public T0 and device/window/cohort exclusions only after Store evidence.
4. Build34 has no optional developer-copy SKAN endpoint. Apple-to-network transport is distinct from AF report visibility. SKAN is delayed/aggregate/privacy-suppressed and cannot be deterministically joined to a native build or GA user/session. Null CVs are not zero gameplay/revenue.
5. Collector tests use labeled synthetic HTTP responses; live provider schema, truncation limits, scheduled execution, downstream null handling and current backend receipts remain unverified. Existing raw diagnostic report breakdowns are not approved paid metrics.
6. Separate approval is required for merge, next binary/release and privacy-policy publication. Store retains pending review and exclusively owns physical proof, including AdMob. Ads owns attribution-mode choice, partner configuration scope, actual public T0 and a bounded paid pilot. No spend/quality claim before these gates, absent an explicit named measurement override.

Next action: review the source PR without merging; after explicit merge/release approval, Store proves an exact new binary and the provider owner obtains native/source-matched product receipts and mode-appropriate aggregate attribution. Preserve all history and paused campaigns throughout.
