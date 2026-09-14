# Handoff: Find the Bird between-level instrumentation, the parts not done

Date: 2026-09-14. For: a fresh agent, any provider. The human will not restate context.
Repo: `/Users/base/dev/appletolye/fabrikav2`. Branch `ftb-between-level-instrumentation` (PR #79, head d6d0c39a4, carries today's main). Work on a new branch off it, or off main once #79 lands. Leave the pre-existing dirty files on `main` alone.

**Not releasing yet.** No store submission, no TestFlight upload, no App Store Connect version creation, no Remote Config writes. Batu decides that separately. Everything below is code, proof, and documentation.

## 1. What is already done (do not redo)

- Six events (`level_complete_shown`, `level_complete_action`, `interstitial_gate`, `ad_lifecycle`, `next_level_ready`, `level_abandoned`) are in `games/find_the_bird/src/analytics/CanonicalAnalyticsEvents.ts`, `AnalyticsService.ts`, `GameAnalyticsEvents.ts`/`GameAnalyticsSink.ts`, helpers in `BetweenLevelFlow.ts`, seam `src/ads/adMobComposition.ts`, wiring in `src/ui/LevelCompleteOverlay.ts`, `src/scenes/GameScene.ts`, `src/sdk/SdkContext.ts`. Tests: `tests/unit/between-level-analytics.test.ts` (34). `npm run test:unit` 500/500.
- Device proof and GameAnalytics arrival: `docs/evidence/2026-09-14-ftb-between-level-instrumentation/` (`report.html`, `README.md`, `device/`). Portal stream `find-the-bird-ads`, post p_565d69.
- Remote Config answer: FTB production does not read it. `SdkContext.ts` ignores `VITE_FTD_DISABLE_REMOTE_CONFIG`; `src/analytics/firebaseApp.ts` returns `null`.
- `interstitial_gate` has a `first_session` reason for PR #76's session ad policy (`src/ads/sessionAdPolicy.ts`).

## 2. Work remaining, in order

### 2.1 Find the Dog parity (code, its own PR)
Port the same six events to `games/find_the_dog`. FTD already has `ad_lifecycle` (`src/ads/adMobComposition.ts`, contract entry with `gameAnalyticsName: 'Firebase only'`); its GA mapping drops custom fields because `GameAnalyticsEvents.ts` has no `ad:lifecycle` reverse mapping. Fix that the way FTB does (`gameAnalyticsDesignEventId`, `canonicalEventIdForDesignEvent`, `gameAnalyticsDesignEventValue`). FTD's `level_abandoned` is contract-only; FTD has no `sessionAdPolicy`, so its gate reasons stop at `ads_disabled` unless #76's policy is ported too (check `git log origin/main -- games/find_the_dog/src/ads` first). Diff FTB against FTD file by file; the two trees are siblings, and the level-complete overlay wrapper and GameScene gate code are near-identical. Definition of done: same tests green in FTD, contract superset test passes, no parallel analytics path.

### 2.2 Make FTB read Firebase Remote Config (code only, no config writes)
Port `games/find_the_dog/src/analytics/firebaseApp.ts` (env-driven `initializeApp`, FTD commit 12d018d08) into FTB and honour `VITE_FTD_DISABLE_REMOTE_CONFIG` in `SdkContext.ts` like FTD does (`parseBooleanEnv`, line ~314 in FTD). The custody env `/Users/base/fabrika-keys/find-the-bird.env.ios.local` already carries `VITE_FIREBASE_*` and the flag set to `false`. Unit-test the provider with an injected app; on the phone, confirm `__FIND_DOG_HARNESS__.remoteConfigSnapshot()` reports a fetch state other than `fetch-failed` against the existing template (`src/config/remoteConfigTemplate.ts`). Do not change any value in the Firebase console. This unblocks running the §6 experiment as a config experiment later.

### 2.3 Prove a real interstitial close tap on the phone
Open gap: the captured `ad_lifecycle dismissed` came when the XCUITest session ended, not from a close tap. Lane and traps are in memory `ftb-phone-relay-drive-lane` and the evidence `device/` folder (`inject.html`, `relay.py`, `drive.js`, `AdCloserLiteTests.swift`). Known facts: any XCUITest that queries the WKWebView accessibility tree each cycle is signal-killed within a minute; the runner bundle cannot reach the Mac over LAN; page JS freezes while the native interstitial is up. Options to try, cheapest first: (a) a runner that sleeps until a fixed wall-clock offset agreed with the drive, then does at most 5 `app.buttons` queries 3 s apart; (b) `XCUIDevice`-level coordinate taps only after a screenshot confirms the close control position (never blind, never on the creative); (c) USB the phone so `pymobiledevice3` tunnel + `developer dvt` input is available. Success: `ad_lifecycle dismissed` within 30 s of `shown`, `next_level_ready.gap_ms` under 30 s, screenshots before/after the tap.

### 2.4 Release-lane hygiene (no shipping)
`/Users/base/store-review/find-games/ios-submission-20260914` belongs to the IAP-cancel lane (`.worktrees/iap-cancel-fix`, ca47f3425; Bird 1.2.5 (40), Dog 1.0.11 (41) exported). Its `build-ios.py` was overwritten at 12:28 and reconstructed from `ios-submission-20260910/build-ios.py`; the header says so. Diff the reconstruction's archive command against `bird/archive-result.json` and `dog/archive-result.json` (the recorded commands) and fix any mismatch. When Batu says go later, Bird ships as 1.2.6 (41) from a clean detached worktree at the merge commit (`git worktree add --detach`, symlink `node_modules`, copy the custody env in, copy `native-resources/ios/App/GoogleService-Info.plist` from the main checkout, `npm run build:ios`, `npx cap add ios`, `npm run ios:sync`). Prepare nothing in ASC.

### 2.5 The funnel report (blocked until a store build with the events has 24 h of users)
Query recipe: handoff `2026-09-14-ftb-between-level-instrumentation.md` §5.4. Working method today: `browser-harness` on Batu's Chrome Explore tab for game 351396, `cdp("Network.enable")`, reload, `drain_events()`, take the `authorization` header from a `Network.requestWillBeSent` to `/api/querytool/v2/games/351396`, POST from inside the page with `js(fetch(...))`. The token is a short-lived JWT: keep it inside the harness process, never print or persist it. Cuts to post to `find-the-bird-ads`: users per step levels 1–5; the 3 → 4 step split by `interstitial_gate.reason` (`first_session` vs `cadence`), `ad_lifecycle.stage` reached, `level_complete_action.action`, `next_level_ready.gap_ms`; then pick the arm per the proposal in `report.html`.

## 3. Constraints
- No store or Remote Config mutations. Reads are fine.
- Never `rm`; use version folders. Never reset files you did not author; other agents own the dirty files on `main` and the `.worktrees/*`.
- Money from meters only; report any paid call.
- Device work is device work: no simulator or browser proxy for the close-tap proof.
- Batu's phone save: back up localStorage before `resetSave`, restore after (see the drive scripts).

## 4. Definition of done
2.1 merged as its own PR with green tests; 2.2 on a branch with a device readback showing Remote Config fetched; 2.3 with screenshots and the event sequence; 2.4 verified with the diff noted in the lane directory; 2.5 stays open and says so until a release exists. Report each item as done, changed, or blocked with the artifact that proves it.
