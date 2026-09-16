# Find the Bird: ad policy v2 (install-day protection, persisted cadence, exposure tracking)

Status: implemented on `feat/ftb-ad-cadence`, 2026-09-16. Targets the 1.2.6 build. No experiment arms in this build; enrollment of `ftb_ad_protection_v1` is retired (never shipped).

## Why

Measured 2026-09-16 (GameAnalytics, AdMob, AppsFlyer, Meta; see `docs/evidence/2026-09-16-ftb-ad-policy-v2/`):

- D1 18–21 % and D3 8 % on cohorts that installed builds **without** first-launch ad protection (PR #76 merged 2026-09-13 22:21; the carrying store build 1.2.5 went live 2026-09-15 17:56 UTC).
- Sessions run 1–2 completions, so the per-launch "every 3rd" gate fired once per 6.4 completions.
- Retention is the owner's priority; game quality is changing twice this week. The ad schedule is frozen so cohort D1 movement is attributable to the game.
- Whether ad exposure lowers retention cannot be answered from any current source: Firebase Analytics was a stub before 1.2.6, GameAnalytics cannot join users, the owned mirror is disabled in production.

## Rules in force

1. **Install-day protection.** A fresh install sees no automatic ads (interstitial, banner) on its UTC install day. Rewarded ads stay available. Existing installs (save data present before this build) are not protected. The day boundary is UTC to match the providers' cohort days; a session crossing midnight starts serving without a relaunch.
2. **Persisted cadence.** Every committed completion counts once (keyed by completion transaction) toward `interstitialEveryNLevels` (3). Progress persists across launches, saturates at N, and resets only on a confirmed interstitial presentation or a rewarded ad actually starting. Protected completions do not count.
3. **Retained opportunity.** A gate that opens but cannot show (not loaded, provider frequency cap, show failure) keeps its saturated progress; the next Next tap retries. Nothing shows during play or on resume.
4. **Rewarded suppression.** A rewarded ad that starts presenting clears cadence progress and blocks interstitials while open; its dismissal, earned or abandoned, starts a 120 s interstitial cooldown that survives a restart. The provider's 120 s interstitial-to-interstitial cap is unchanged.
5. **Everything else unchanged:** placement on Next, no floor (`interstitialMinLevel` 0), banner exclusion list, hint cap 5/day, claim-x2, entitlements, consent.

## Tracking added so the retention question can be answered

Per install, on every event (runtime identity fields): `ad_policy=install_day_v2`, `ad_policy_cohort` (`new_install` | `existing_install` | `storage_unavailable`), `install_day` (UTC).

`interstitial_gate`: reason vocabulary is now `cadence` (eligible) | `cadence_not_reached` | `min_level` | `ads_disabled` | `no_ads_entitlement` | `install_day` | `storage_unavailable` | `rewarded_cooldown`; plus `cadence_progress`, `days_since_install`.

`ad_shown`: `days_since_install`, `auto_ad_impressions` (lifetime, after this one).

Firebase user properties, refreshed on app open and after each automatic impression: `install_day`, `ad_policy`, `ad_policy_cohort`, `auto_ad_impressions`, `first_auto_ad_day` (-1 until one shows), `days_since_install`.

GameAnalytics custom dimensions, set before the first native session of each launch:
- `custom_01` = `ads_v2_new_install` | `ads_v2_existing_install` | `ads_v2_storage_unavailable`
- `custom_02` = `auto_ads_none` | `auto_ads_first_d0` | `auto_ads_first_d1` | `auto_ads_first_d2_3` | `auto_ads_first_d4plus` (exposure status at launch)

## The read

- **D1 by install-day cohort** (GameAnalytics retention, split `custom_01`): from 1.2.6 onward every `new_install` cohort has an ad-free D0 by construction, so D1 movement week over week is the game, not the schedule. Base: 18–21 % on pre-protection cohorts.
- **Does exposure cost retention:** among users active on D1 (so exposure was possible), compare D3/D7 for `custom_02 = auto_ads_first_d1` versus `auto_ads_none`, and in GA4 the same cut on the `first_auto_ad_day` user property with `install_day` as the cohort. Both are selection-biased toward heavier players in the exposed bucket; read the direction and size, then decide whether a `from_start` day-zero arm is worth a build.

## Not done

- No device run of this branch yet. The install-day block, the cadence persistence and the user-property calls are unit-tested only.
- Provider ingestion of the new fields and dimensions is unverified until a build with Firebase live is in store users' hands.
- No experiment enrollment switch was built. `ftb_interstitial_cadence_v1` (3 vs 1) is deferred until D1 stabilizes from the quality work.
