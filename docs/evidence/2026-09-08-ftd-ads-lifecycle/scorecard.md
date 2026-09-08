# Find The Dog iOS — clean economics scorecard (2026-09-01 → 2026-09-07)

Dog iOS only (App Store 6772100729, bundle `com.baseardahan.hiddenobj`, AdMob app `~9433079953`). Bird, Android and other games excluded. Every number below names its source file in `scorecard/`; nothing is estimated where a meter exists. Where a source could not be read, the cell says so and the export recipe follows.

## 1. Sources actually retrieved (read-only)

| Source | Method | File | Window / tz / currency |
|---|---|---|---|
| AdMob Ads Activity report, App = Dog, dimensions Ad unit × Format × Country | Batu's authenticated Chrome session via browser-harness (report UI, no export, no settings touched) | `admob-dog-adunit-by-country-20260901_07.json`, `admob-dog-country-format-summary.json`, screenshots | "Last 7 days" whose chart axis reads Sep 1 → Sep 7 2026; AdMob account timezone (not verified); USD |
| AppsFlyer raw data (Pull API v5): `installs_report`, `organic_installs_report`, `in_app_events_report`, `organic_in_app_events_report` | Reporting token from the owner key store; `curl -L`, no cache | `af-dog-*-20260901_07.csv` kept **outside git** (user-level rows: device ids, IPs) at `/Users/base/store-review/find-games/analytics/ftd-ads-lifecycle-20260908/scorecard/` | 2026-09-01..07, AppsFlyer app timezone (report default), USD revenue columns |
| AppsFlyer aggregate (`partners_by_date`) via `tools/find-games-provider-ops` | CLI | `appsflyer-aggregate-2026-09-01_07.json` | **rate limited** (`Limit reached for partners-daily-report`), degraded |
| Meta Marketing API v21: campaign objects + daily insights for the two Dog iOS campaigns | Token from owner key store, `GET /insights` with `time_range` + `time_increment=1` | `meta-campaign-*.json`, `meta-campaign-*-insights-daily-20260901_07.json` | 2026-09-01..07, ad-account timezone, **TRY** |
| provider-ops live health | CLI | `provider-ops-health-live.json` | appsflyer healthy; admob/GA/RevenueCat/ASC degraded (browser fallback only); meta missing_credential for the CLI's locator |

Not retrieved (blockers named in §7): AdMob per-date × ad unit rows (UI table stopped rendering rows for the 3-dimension view in a background tab; screenshots `admob-adunit-by-date-page*.png` show the blank body), AdMob serving-restriction / ATT / app-version cuts, GameAnalytics DAU/retention (session KPI still quarantined by the daily scorecard), RevenueCat net IAP (API key rejected as `Invalid API key.` for v2), StoreKit proceeds.

## 2. AdMob — Dog ad unit × country (Sep 1–7, USD)

Rows as rendered by AdMob (earnings rounded to cents per row; `—` = no impressions):

| Ad unit | Country | Earnings | Impr. | Obs. eCPM | Requests | Match | Matched |
|---|---|---:|---:|---:|---:|---:|---:|
| banner | United States | $0.30 | 329 | $0.92 | 346 | 96.53% | 334 |
| interstitial | United States | $0.12 | 30 | $3.99 | 128 | 100% | 128 |
| rewarded | United States | $0.09 | 9 | $9.62 | 192 | 100% | 192 |
| banner | Australia | $0.06 | 36 | $1.54 | 36 | 100% | 36 |
| banner | United Kingdom | $0.04 | 26 | $1.61 | 26 | 100% | 26 |
| interstitial | Australia | $0.04 | 4 | $9.24 | 10 | 100% | 10 |
| banner | Philippines | $0.03 | 49 | $0.65 | 194 | 25.77% | 50 |
| interstitial | Philippines | $0.02 | 11 | $1.78 | 38 | 100% | 38 |
| rewarded | Philippines | $0.02 | 10 | $1.83 | 48 | 100% | 48 |
| interstitial | United Kingdom | $0.00 | 1 | $4.37 | 11 | 100% | 11 |
| interstitial | Portugal | $0.00 | 1 | $1.87 | 2 | 100% | 2 |
| banner | Canada | $0.00 | 2 | $0.67 | 2 | 100% | 2 |
| banner | Türkiye | $0.00 | 6 | $0.20 | 19 | 36.84% | 7 |
| interstitial | Türkiye | $0.00 | 1 | $0.70 | 15 | 100% | 15 |
| banner | Portugal | $0.00 | 4 | $0.10 | 4 | 100% | 4 |
| banner | Malaysia / Ireland / Kuwait | $0.00 | 2 / 1 / 1 | $0.19 / $0.30 / $0.13 | 2 / 1 / 1 | 100% | 2 / 1 / 1 |
| interstitial | Canada, Ireland, Romania (1 each), Kuwait, Malaysia (2 each) | $0.00 | 0 | — | 1–2 | 100% | = requests |
| rewarded | Australia 10, United Kingdom 16, Türkiye 9, Kuwait 3, Canada 2, Malaysia 2, Portugal 2, Ireland 1, Romania 1 | $0.00 | 0 | — | = matched | 100% | = requests |
| **Summary** | | **$0.73** | **523** | **$1.39** | **1,128** | **85.11%** | **960** |

Reconciliation: format totals rebuilt from the rows are banner 631/463/456, interstitial 211/211/48, rewarded 286/286/19 — identical to the audit's format report. Row earnings sum to $0.72 (banner $0.43) against the provider's $0.73 / $0.44: rounding, not missing revenue.

### By country (derived from the rows; eCPM from rounded cents, so sub-cent countries are shown as $0.00)

| Country | Earnings | Impr. | Requests | Matched | Match | Show | Obs. eCPM |
|---|---:|---:|---:|---:|---:|---:|---:|
| United States | $0.51 | 368 | 666 | 654 | 98.2% | 56.3% | $1.39 |
| Philippines | $0.07 | 70 | 280 | 136 | 48.6% | 51.5% | $1.00 |
| Australia | $0.10 | 40 | 56 | 56 | 100% | 71.4% | $2.50 |
| United Kingdom | $0.04 | 27 | 53 | 53 | 100% | 50.9% | $1.48 |
| Türkiye | $0.00 | 7 | 43 | 31 | 72.1% | 22.6% | — |
| others (PT, CA, MY, IE, KW, RO) | $0.00 | 11 | 30 | 30 | 100% | 36.7% | — |

What the country cut settles:

- **Unmatched requests are a Philippines banner problem, not a Dog-wide fill problem.** 144 of the 168 unmatched banner requests are Philippines (banner match 25.8%); Türkiye 12; United States 12. US banner match is 96.5%. Nothing here justifies floor changes.
- **US is 70% of impressions and 70% of revenue.** Fullscreen prices under child treatment in the US: interstitial $3.99 (30 impressions), rewarded $9.62 (9 impressions). These are the only adult-market-relevant prices and their sample is tiny.
- **Rewarded matched-but-never-shown inventory is everywhere:** 192 US matches → 9 impressions; 16 UK, 10 AU, 9 TR matches → 0 impressions. The cache-replacement mechanism fixed on this branch (repeated preload replacing an unshown ad) is consistent with this shape, but the share attributable to it versus users simply not opting in cannot be measured until the new `ad_lifecycle` telemetry ships.
- **Interstitial show rate is 22–29% in every country with volume** (US 23.4%, PH 28.9%, AU 40%, UK 9%), i.e. the "every 3rd completion, 120 s apart" cadence plus prewarm-at-boot leaves most loaded interstitials unused by design. Not a defect; do not raise pressure to fix a ratio.

## 3. September 5 anomaly — Dog daily by ad unit

Retrieved (`admob-dog-adunit-by-date-20260901_07.json`, `admob-dog-daily-summary.json`; the report tab had to be foregrounded and its table editor closed before the rows rendered):

| Date | Requests | Matched | Match | Impr. | Earnings | Notes |
|---|---:|---:|---:|---:|---:|---|
| Sep 1 | 5 | 5 | 100% | 0 | $0.00 | interstitial 4, rewarded 1 |
| Sep 2 | 4 | 4 | 100% | 0 | $0.00 | interstitial 4; banner 0 |
| Sep 3 | 42 | 42 | 100% | 11 | $0.00 | banner 11/11, interstitial 13, rewarded 18 |
| Sep 4 | 309 | 201 | 65.0% | 121 | $0.18 | **banner 209 req / 101 matched (48.3%)**, interstitial 46 → 22 impr, rewarded 54 → 2 |
| **Sep 5** | **137** | **137** | **100%** | 70 | $0.10 | banner 64/64/64, interstitial 30 → 3, rewarded 43 → 3 |
| Sep 6 | 117 | 81 | 69.2% | 42 | $0.04 | banner 74 → 38 matched (51.4%), interstitial 18 → 4, rewarded 25 → 1 |
| Sep 7 | 514 | 490 | 95.3% | 279 | $0.39 | banner 273 → 249 (91.2%), interstitial 96 → 19, rewarded 145 → 13 |

**The September 5 account-level anomaly (760 requests, 19% match) is not Dog.** Dog made 137 requests on Sep 5 and every one matched; Dog's own unmatched days are Sep 4 and Sep 6, both banner-only (108 and 36 unmatched), consistent with the Philippines banner fill problem in §2. The account spike therefore belongs to Bird, and neither its cause nor any later Dog build has anything to do with it. Dog's Sep 5 dip is a volume dip (137 vs 309 requests), not a serving change.

## 4. AppsFlyer — installs, countries, events

From the raw reports (2026-09-01..07):

| Report | Rows | Notes |
|---|---:|---|
| `installs_report` (attributed / non-organic) | **0** | no paid install was attributed to Dog in the window |
| `organic_installs_report` (unattributed) | 83 | US 54, PH 6, AU 5, UK 5, TR 4, CA 3, MY 2, KW/RO/IE/PT 1; app versions 1.0.5 = 61, 1.0.6 = 21, "1.0" = 1; by install date: Sep 7 = 48, Sep 5 = 11, Sep 6 = 8, Sep 4 = 7, Sep 3 = 7, Sep 2 = 1, Sep 1 = 1 |
| `in_app_events_report` (attributed) | 0 | |
| `organic_in_app_events_report` | 101 | `af_level_achieved` 57, `af_tutorial_completion` 36, `retention_milestone` 8; **no `af_ad_revenue` and no `af_purchase` rows**; `Event Revenue USD` sums to 0.00 |

Consequences:

- **The SDK → AppsFlyer ad-revenue path has no backend receipt.** AdMob recorded 523 Dog impressions in the window; AppsFlyer received zero `af_ad_revenue` events. Either the native paid callback never reached JS in production builds (the micros correction is verified in the 1.0.6 (26) build log, but 1.0.5 predates it and truncated values are dropped by the provider's `valueMicros <= 0` guard), or the `trackConfirmed` path drops them. The device drive on this branch emits the owned `ad_revenue_paid` event and forwards to AppsFlyer; a whitelisted-test-device TestFlight run is the next step (§7).
- **Install-country mix (65% US) matches the impression mix (70% US)**, so blended eCPM is dominated by US child-treated pricing.
- **Retention cohorts cannot be built from these files** (they carry install time but no return-visit series); `retention_milestone` custom events (8) are too sparse to be a denominator-safe D1.

Install-day cohorts by app version and country are available from the same CSV whenever a mature-horizon retention source exists.

## 5. Meta — Dog iOS spend and delivery (ad account currency TRY)

| Campaign | Status | Objective | Days with spend | Spend (TRY) | Impr. | Clicks | Install actions |
|---|---|---|---|---:|---:|---:|---|
| 120249302115590442 "FTD \| iOS Creative Tests \| Legacy + Dog Backgrounds v3" | ACTIVE | OUTCOME_APP_PROMOTION | Sep 2, Sep 7 | 1,697.64 + 1,556.77 = **3,254.41** | 24,152 + 1,104 | 284 + 211 | **none reported**; only `app_store_visit` 67 + 160 |
| 120249434565090442 "FTD \| iOS 15+ SKAN \| US \| v17 feed \| 2026-09-08" | ACTIVE, daily budget TRY 500 | OUTCOME_APP_PROMOTION | starts 2026-09-09 | 0 in window | | | |

Reconciliation: Meta reports zero install actions and AppsFlyer reports zero attributed installs for the same window, so **no CPI can be computed from meters for Sep 1–7**. The "$1.75 CPI / >1,000 installs" figures in the brief are not reproducible from any source read here and should not be used as a baseline. TRY→USD conversion is deliberately not applied (no rate source in the window; the account bills in TRY).

## 6. Break-even framing (arithmetic only, no forecast)

With the country cut, the only defensible per-market framing is the US: blended US eCPM $1.39 (368 impressions, 56% banner). Nothing in this window supports a lifetime-impressions-per-install figure because there is no cohort denominator and no verified CPI; the audit's 1,259 impressions/install at $1.75 remains an illustration, not a target.

## 7. Missing data and exact next exports

| Gap | Blocker | Exact next step |
|---|---|---|
| AdMob Serving restriction × Format, ATT status × Format, App version × Ad unit | No AdMob reporting API credential exists (`FIND_GAMES_ADMOB_REPORTING_CREDENTIAL_FILE` unset; provider-ops reports `degraded`); each UI cut costs a foreground-tab session | Either create a read-only AdMob API OAuth credential and store it at the provider-ops locator, or add the three dimensions one at a time in the same report UI used for §2/§3 (foreground tab, table editor closed) |
| Daily DAU, ad viewers, impressions/DAU, ARPDAU | GameAnalytics session KPI is quarantined (`daily-scorecard/latest.json` session_quality) and GA is browser-only for this tooling | Keep the two-clean-snapshot acceptance gate; until then report impressions and revenue per install-day cohort from AppsFlyer + AdMob, not per DAU |
| D1/D3/D7 retention with eligible denominators | No retention source with a mature horizon was readable (GA quarantined; AppsFlyer cohort API not attempted because the aggregate endpoint is rate limited today) | Tomorrow: `cohort` report via AppsFlyer Master API or GA retention once un-quarantined; include zero-revenue installs |
| Verified net IAP | RevenueCat key on file is rejected by API v2 (`Invalid API key.`) | Issue a v2 read-only secret key for the Dog project in RevenueCat and store it under `~/.config/base-game-lab/revenuecat/`; then pull `/v2/projects/{id}/…/overview` or export transactions and net of Apple commission/refunds |
| AppsFlyer `af_ad_revenue` receipt | Zero rows in production; device build on this branch had AppsFlyer disabled to avoid polluting production data | TestFlight build with this branch + AppsFlyer test-device allowlist; verify one `af_ad_revenue` row with `af_revenue`/`af_currency` matching the device's `ad_revenue_paid` event |
| AppsFlyer partners aggregate | daily rate limit hit | rerun `node tools/find-games-provider-ops/cli.mjs appsflyer-aggregate --from 2026-09-01 --to 2026-09-07` after 24 h |

Small-sample warning: fullscreen prices rest on 48 interstitial and 19 rewarded impressions; per-country fullscreen eCPMs are single-digit impression counts everywhere except the US. No confidence intervals are quoted because none would be honest.
