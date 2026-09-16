# Meter pulls behind ad policy v2 (read 2026-09-16 18:20 UTC)

- `gameanalytics-2026-09-09..16.json`: querytool responses (completions, starts, sessions, ad-event users, design counts, installs ratio) for Bird 351396.
- `admob-2026-09-01..16.json`: AdMob GetReportData replies, day × format, consent × format, country × format (USD).
- AppsFlyer (provider-ops `appsflyer-aggregate`, Sep 9–16): 113 Facebook Ads installs across four FTB campaigns; no Apple Ads, cost null.
- Meta insights act_2805795896467959, Sep 9–16: TRY 11,234 across the same four campaigns (USD 231 at 48.66).
- App Store lookup: live version 1.2.5 released 2026-09-15T17:56:10Z. GA4 property 554041647 had 2–4 users in the window (Firebase stubbed before 1.2.6).

## Device run 2026-09-16 (iPhone 12, harness Debug build of b9d64fee6, Wi-Fi JS relay)

Drive scripts: `/tmp/ftb-adexp-relay/drive3.js` (reveal-aware completion + pointer-sequence Next), `drive4.js` (tap CLAIM 2x). Relay results ids 39–67.

Verified on the phone:
- Fresh install (localStorage cleared, reload): `ftb_install_day = 2026-09-16` written at bootstrap. Four completions on the install day each reported `interstitial_gate: install_day`, `cadence_progress 0`, `days_since_install 0`; no show requested; no cadence key written.
- Backdated to `2026-09-15`: completions counted progress 1 and 2 with their transaction ids; progress 2 survived `devicectl process terminate` + relaunch; the third completion reported `cadence` eligible (cp3, d1) then provider `show_requested` → `shown` → a real interstitial (real AdMob unit, Batu's device) → `dismissed`, `ad_impression`, `ad_shown` with `auto_ad_impressions 1`; cadence reset to 0, `firstAutoAdDay 1`; `next_level_ready.after_interstitial true`.
- CLAIM 2x rewarded: `show_requested` → `reward_earned` → `dismissed`; `lastRewardedDismissedAt` persisted; the following Next reported `interstitial_gate: rewarded_cooldown` (cp1) 51 s after dismissal.
- `Capacitor.isPluginAvailable('FirebaseAnalytics')` true and `setUserProperty` resolves once the shell is synced with the Firebase env exported (first build was synced without it and every Firebase call returned UNIMPLEMENTED).

Not verified on device: an abandoned rewarded ad (closed before reward), a not-loaded interstitial at an open gate (retained opportunity), the UTC-midnight rollover mid-session, and provider-side ingestion of the new fields, dimensions, and user properties.

Device left with the Debug harness build installed (relay injected, `NSAllowsArbitraryLoads`); save restored to level 44 / 2155 coins from the 2026-09-14 backup, with no `ftb_install_day` key, so it is an `existing_install`.
