# Find The Dog iOS — monetization repair and measurement (2026-09-08)

Branch `fix/ftd-ads-lifecycle` (worktree `.worktrees/ftd-ads-lifecycle`, base `origin/main` f61ac4a84 = PR #61). Brief: `docs/handoffs/2026-09-08-dog-ios-monetization-repair.md`. Nothing in this directory is merged, released or live.

## Index

| File | What |
|---|---|
| `telemetry-contract.md` | Event/state contract by format and placement; native-impression rule; paid-value verification status |
| `audience-decision-memo.md` | Priority 1 decision memo (recommendation: prepare mixed-audience Option B; keep child treatment live; gates listed) |
| `scorecard.md` + `scorecard/` | Dog-only economics: AdMob ad unit × country and ad unit × date (Sep 1–7), AppsFlyer raw pulls, Meta insights, missing-data list |
| `baseline-tests.log` | Baseline at f61ac4a84 before any edit |
| `post-change-tests.log` | Dog unit/typecheck/lint, SDK suite, Bird + marble_run + shell_template siblings after the change |
| `npm-ci.log`, `cap-add-ios.log`, `device-install*.log`, `device/attempt-*.log` | Worktree install and device build/install attempts (each attempt's cause of failure is in the log header) |
| `device/ad-closer-run-N.log`, `device/ad-closer-N.xcresult`, `device/runN-attachments/` | XCUITest ad-closer runs (screenshots + journal attachment) |
| `device/syslog-raw.log` | `idevicesyslog` capture for the whole device session (large; grep `[ad-closer]`) |
| `device/journal-run*.txt` | Drive journals pulled from the app container (`devicectl device copy from … appDataContainer`) |

## Provenance

- Shipped 1.0.6 (26) = `e5a2ed5e8` (PR #60) is on `origin/main`; the audit's "main lacks the rewarded fixes" divergence was the local `main` checkout being behind origin (local-only commits `2135e9d24`, `890ac405c`, `eacedc028`). This branch starts from `origin/main` f61ac4a84, which contains #55–#61, so the shipped rewarded-terminal implementation is preserved unchanged.
- The AdMob iOS revenue micros patch was applied in the 1.0.6 (26) build's install (`store-review/find-games/ios-submission-20260906/npm-ci.log:6`). The main checkout's `node_modules` is unpatched; this worktree's is patched.
- PR #61 (reveal/pickup experiment) is untouched; its 52 unit-test failures at baseline are pre-existing (`TypeError: Cannot read properties of undefined (reading 'clear')` in a non-DOM test environment) and unchanged after this work.

## State by deliverable

### Implemented (source-ready, committed on the branch)

- `packages/sdk/src/ads/AdMobProvider.ts`: one-hour full-screen cache lifetime (Google guidance), rewarded preload preserves loaded inventory, banner desired-state tracking (hide during pending load wins; async failure clears state), `hideBanner` never initializes the SDK, resume re-arm replaces expired ads, `onAdEvent` lifecycle seam with per-load correlation ids.
- `games/find_the_dog/src/ads/adMobComposition.ts` + `SdkContext.ts`: app-resume seam wired to the game lifecycle authority (exhausted interstitial retry budget recovers on foreground); banner `ad_shown` only from the native impression; `ad_show_failed` with native reason; owned `ad_revenue_paid` from the native paid callback; AppsFlyer forwarding unchanged.
- `games/find_the_dog/src/ads/Service.ts`: wrapper banner cache removed (it masked async native failures).
- `GameScene.ts`: request acceptance no longer emits banner `ad_shown`; a refused request emits `ad_show_failed{reason:request_rejected}`.
- Analytics: new `ad_lifecycle` owned event (registry entry, `stage` dashboard dimension), `AnalyticsService.adLifecycle`.
- Device proof tooling: `src/testing/AdLifecycleDrive.ts` (harness-only, shell-gated), `tools/verify-device/runner … AdCloserTests.swift`, env policy key `VITE_FTD_AD_LIFECYCLE_DRIVE` (73-key contract).
- Not changed: audience/privacy flags, cadence defaults, floors, hints, progression, wallets, experiments, Remote Config.

### Verified

- Unit: SDK 392/392 (17 new), Dog 373 passing + 52 pre-existing PR #61 failures (8 new tests), Bird 429/429, marble_run + shell_template typecheck, Dog typecheck + lint, game-env 61/61. See `post-change-tests.log`.
- Effective live Remote Config on the device (drive journal, fetch `success`): `interstitial_every_n_levels=3`, `interstitial_min_interval_s=120`, `interstitial_min_level=0`, `level_end_claim_x2_enabled=true`, `hint_rw_enabled=true`, all sourced `remote` and equal to the defaults.
- Device build identity: branch build installed on Batu's iPhone 12 (iOS 26.6.1), bundle `com.baseardahan.hiddenobj`, `build-info.json` sha per attempt log; test-ad mode (Google sample units), AppsFlyer/GameAnalytics/Adjust disabled in the device env so no production analytics or attribution rows were emitted.
- Device run results: see "Device runs" below (updated as runs complete).

### Blocked / unverified (explicit)

- **Backend receipt of `af_ad_revenue`**: AppsFlyer shows zero such rows in production for Sep 1–7 despite 523 impressions; the device build deliberately had AppsFlyer off. Needs a TestFlight build of this branch with an AppsFlyer test device.
- **No-fill → connectivity restored → resume recovery on the physical device**: no way to cut the phone's network from this Mac without a human; covered by unit tests only.
- **One-hour expiry on device**: cannot be observed inside a 400 s run; unit-tested with the injected clock.
- **No-ads entitled path on device**: Batu's device owns No-Ads, so run 4 (before the drive lifted the entitlement) is evidence that an entitled player triggers no ad requests; the lifted-entitlement runs exercise the ad paths.
- AdMob serving-restriction / ATT / app-version cuts, GameAnalytics DAU/retention, RevenueCat net IAP: see `scorecard.md` §7.

### Audience decision implemented (second PR, after owner review)

Owner decision: **general audience for Find The Dog and Find The Bird** (Option C; Option B was recommended and overruled, risk recorded in `audience-decision-memo.md`). Implemented: `AdMobProvider.audience` (`child` default for other consumers, `general` for both Find games), no child/under-age tags, no forced NPA, General content rating kept, ATT requested on iOS after consent, `NSUserTrackingUsageDescription` + `NSPrivacyTracking=true` + `googleads.g.doubleclick.net` tracking domain in both native shells. Tests: SDK 396/396 (4 new audience tests), Dog and Bird SdkContext assert `audience === 'general'`, native-shell 17/17 with the identity pin updated. Device: see `device/attempt-15-general-audience.log` and `device/screenshots/att-prompt*.png` when present.

### Approval needed (nothing done)

- Audience treatment: `audience-decision-memo.md` §4 gates (legal judgment, bridge API migration, consent tests, label update, product decision).
- Privacy nutrition label vs. actual tracking behaviour (ASC edit).
- Merge of this PR; any TestFlight/App Store build; any Remote Config change.

### Deferred (proposed, not implemented)

- Back-to-back rewarded → Next → interstitial suppression: on the device the claim-x2 rewarded ad and a cadence-eligible interstitial on Next are both possible in one completion (see GameScene `onClaimX2` and the `shouldTry` gate). Proposed narrow rule: skip the Next interstitial when a rewarded ad was granted in the same completion transaction (do not advance `levelsCompletedThisSession` differently). Not implemented because it changes ad pressure semantics and incidence is unmeasured until `ad_lifecycle` ships.
- `ad_offer_shown` / `ad_offer_tapped` game-level events (telemetry-contract.md).
- Bird also composes `AdMobProvider` without the resume seam; same wiring applies but is out of scope here.

## Device runs

| Run | Build | Outcome |
|---|---|---|
| 1 | 485450fe52 (harness flag not exported → no harness) | runner killed by dense AX interrogation (`signal kill`); no drive |
| 2 | same | XCUITest passed 397 s; no drive in build |
| 3 | 485450fe52 harness on, drive flag folded to `undefined` (exact env allowlist) | XCUITest passed; no drive |
| 4 | 485450fe52 harness + drive | drive ran: effective RC captured; device is No-Ads entitled → no ad requests; claim tap did not advance the overlay (kit `collect` reset) |
| 5 | 7214730547 + entitlement lift (settings only) + claim retries | ads on: **banner `ad_shown` from the native impression (twice)**, rewarded `loaded`, interstitial `load_requested`→`loaded`; claim tap needs a second click after the reveal; WebContent recycled under memory pressure on the 3rd rapid level load (drive restarted); claim-x2 absent because `setWallet({noAds:false})` is a no-op |
| 6 | 7214730547 + private No-Ads lift + 2-completion drive with in-memory cadence override | claim-x2 still absent (gate diagnostics added for run 7); **Next blocked by the in-app rate prompt** (tick screenshot `run6-attachments`), no ad show attempted; closer test failed on a vanished marker (`continueAfterFailure` added) |
| 7 | build 11 (7214730547 dirty, 13:41:48Z): baseline restore, rate prompt suppressed, private No-Ads lift, cadence override | interstitial `load_requested`→`loaded` and rewarded `loaded` on every boot; banner `ad_shown` again; claim-x2 rendered once (13:45:56Z) and its rewarded tap fired, but the WebContent process was recycled 14 times in five minutes (`device/webcontent-exits.txt`, `Received memory pressure event` ×594 in the capture) and the drive restarted each time — **no full-screen show / impression / reward / dismissal was observed**. The `claimX2Gate` diagnostics show `GameState.load()` on scene restart re-reads the persisted No-Ads flag, undoing the in-memory lift on an entitled device |
| 12–13 | restore-only mode | `device/attempt-13b-restore.log`: level index 1, coins 45, hints 3, `ftd_wallet_no_ads_entitlement=1`, `adsEnabled=false`, `ratePromptEnabled=true`, rate prompt neither shown nor declined — the owner's state from the run-4 start snapshot is back. Residual side effects that could not be reverted: cumulative counters (`coinsGranted`, `levelCompleteCoinGrants`, `rewardProgressCount` 1→13), `_totalLevelsCompleted` (the rate prompt will now offer itself on the owner's next completion), per-level best times, and any achievement progress from the ~13 drive completions |
| 14 | final phone state | harness-free, drive-free branch build installed (`attempt-14-final-phone-state.log`: 0 harness/drive chunks), AdMob **test mode on** so the QA phone makes no production ad requests. The App Store build must be reinstalled from the store by the owner (over-install keeps the data container) |

### Device-lane findings worth keeping

- Native JS console never reaches `idevicesyslog` (Capacitor uses `print`); the working channels are the `addrive:` accessibility marker read by XCUITest (same as the insitu tour) and a localStorage journal pulled with `devicectl device copy from … --domain-type appDataContainer`.
- Dense XCUITest accessibility queries starve the WKWebView main thread (run 1 was killed); one `staticTexts`/`buttons` query per ~1.2 s is survivable.
- `games/find_the_dog/vite.config.ts` folds every non-canonical `VITE_*` to `undefined` in native builds, and the copied `.env.ios.local` overrides the shell for canonical keys; `VITE_FTD_SIM_AUTOPLAY` has the same dead-in-native-builds property today.
- Under the drive + test runner an iPhone 12 recycles the WebContent process around level restarts with test ads loaded; whether production players see the same reload is **unverified** and worth a Crashlytics/`app_foreground`-with-cold-state check, not an assumption.
- A programmatic `.click()` on the completion overlay's CLAIM during its reveal animation is ignored; the second tap after ~20 s works.
