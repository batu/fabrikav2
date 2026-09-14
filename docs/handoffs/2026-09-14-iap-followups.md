# Handoff: Find games IAP follow-ups after the cancel-misclassification fix

Date: 2026-09-14. For: a fresh agent, any provider. The human will not restate context.
Repo: `/Users/base/dev/appletolye/fabrikav2`. Work in a worktree under `.worktrees/` (another session uses the main checkout and has committed other people's dirty lines before); `main` is at f568d3428. `git worktree add .worktrees/<name> -b <branch> origin/main`, then symlink `node_modules` from the main checkout into the worktree root and into `games/find_the_dog`, `games/find_the_bird`, `packages/sdk` (`npm ci` fails on the lockfile).

**We are NOT releasing yet.** Do not upload, create versions, or submit anything in App Store Connect. The exported IPAs from PR #78 (Dog 1.0.11 build 41, Bird 1.2.5 build 40) sit unused at `/Users/base/store-review/find-games/ios-submission-20260914` and will be rebuilt later from whatever `main` is at ship time.

## 1. What is already done (do not redo)

Read `docs/evidence/2026-09-14-iap-cancel-misclassification/report.md` for the full story. Short form:

- Cause: the Capacitor iOS bridge delivers a RevenueCat cancel as `{message:"Purchase was cancelled.", code:"1"}`, no `userCancelled`; the old detector treated it as a store error. Fixed and merged in PR #78 (`RevenueCatProvider` normalizes, HUD copy "Couldn't complete", GameAnalytics id `purchase:failed:<kind>`). Proven on Batu's iPhone 12: cancel now emits `purchase:cancelled`; sandbox purchase completes and grants; kill-under-sheet leaves nothing pending.
- Google Analytics enabled on the Bird Firebase project `find-the-bird-basegamelab` (Dog's is `find-the-dog-basegamelab`). Both are inert: the games' `FirebaseAnalyticsSink` is a disabled stub.
- RevenueCat: FTD `default` offering serves App Store products on all 12 packages; FTB `default` offering created (12 packages). v2 secret keys at `~/.config/base-game-lab/revenuecat/find-the-{dog,bird}-v2-secret` (project-config read/write). Never print them.
- iOS env files: `~/fabrika-keys/find-the-{dog,bird}.env.ios.local` (pass to `install.mjs --env-file <abs path>`; it deletes its `games/<g>/.env.ios.local` copy on exit, so never keep the only copy inside the game dir).

## 2. Open items, in priority order

### A. GameAnalytics drops purchase events that span a backgrounding (P1, analytics correctness)

Observed on device (report, "Complete" row): after the app returned from the StoreKit sandbox password sheet, the GA JS SDK logged `Warning/GameAnalytics: Could not add design event: Session has not started yet`, and no `purchase:*` event for that flow reached `api.gameanalytics.com`. The session is ended on `app_background` / pagehide and not restarted before the purchase result handlers fire. Consequence in production: `purchase:fulfilled`, and possibly `purchase:cancelled` / `purchase:failed:*` for slow sheets, are silently dropped, which undermines the 7-day re-read the fix depends on.

Where to look: `games/find_the_dog/src/analytics/GameAnalyticsSink.ts` (manual session handling: `setEnabledManualSessionHandling`, `startSession`/`endSession`, and the visibility/pagehide hooks), the same file in `games/find_the_bird`, and `AnalyticsService.ts` app lifecycle events. Fix shape: on foreground/visibility change, start the session before flushing queued design events, or queue events emitted while no session is active and replay them after `startSession`. Unit test in `tests/unit/gameanalytics-sink.test.ts` (both games): emit a design event between `endSession` and `startSession` and assert it is delivered once, after the session starts. Device check: reuse the relay lane in §4 and confirm `purchase:cancelled` appears in the GA request body after a cancel that involved the password sheet (mode `buy`, then close the password prompt).

### B. "Cancelled" / "Couldn't complete" label is visible for under a second (P2, UX)

`purchaseShopProduct` in `games/*/src/ui/HUD.ts` sets `action.textContent` and returns, but the `finally` block schedules `applyShopPurchaseButtonState` on the next `IAP_CONTROL_REFRESH_MS` tick, which rewrites the label back to the price. Measured on device: "Cancelled" gone within 1.2 s. Decide a hold (for example 2.5 s, or until the next tap) and make the refresh respect it; both games identically. Verify with the XCUITest driver: label read at t+0.6 s and t+2.4 s after the sheet closes.

### C. Home hint pill stale behind the open shop (P3, UX)

After a fulfilled hint purchase the shop header pill shows the new balance (13) while the Home pill behind the modal still shows the old value (3) until `updateHUD` runs. Call the HUD balance refresh from the fulfilled branch of `purchaseShopProduct` (Dog and Bird) and confirm with the relay eval: `document.querySelectorAll('[data-economy-target=hints]')` both show the same number.

### D. Firebase Analytics sink is a stub (P3, decision needed)

`createFirebaseAnalyticsSink()` returns the disabled sink in both games, so enabling GA on the Firebase projects changed nothing. Either wire `@capacitor-firebase/analytics` (new dependency; log the canonical events with their params) or record the decision that GameAnalytics is the only product sink and remove the `firebaseName` plumbing. Ask Batu which; do not add the dependency without the answer.

### E. Find the Bird device proof (P3)

The fix was proven on Dog only. Bird shares `packages/sdk` and its HUD/GameScene lines are identical, but nobody has watched Bird cancel on the phone. Run the §4 lane with `--game find_the_bird`, bundle `com.basegamelab.findthebird`, product label `10 Hints `.

### F. Phone hygiene (P3)

Batu's iPhone still carries the instrumented Dog debug build (console relay script in `index.html`, `NSAllowsArbitraryLoads` in Info.plist). Before any measurement or before handing the phone back for normal use, reinstall a clean build (`install.mjs` without the relay) or the App Store build.

### G. Disk (P3)

The Mac hit "No space left on device" once during this work. `~/.local/share/agency/build-outputs` is 41 GB and `/private/tmp/claude-501` is 32 GB. Do not delete anything without Batu's go; list the largest entries and ask.

## 3. Constraints

- No App Store Connect uploads, versions, or submissions. No RevenueCat, Firebase, or store mutations beyond what §2 explicitly calls for; reads are fine.
- Never print keys, tokens, or passwords. Apple ID password lives in `/Users/base/dev/appletolye/.env` (`APPSTORECONNECT_PASSWORD`); only use it to type into the sandbox sheet if Batu says so again for this session.
- Do not change product ids, prices, entitlement ids, or the RevenueCat offerings.
- Never `rm`. Never use bare `git stash`/`git stash pop` (shared stash stack, other sessions).
- Pre-existing test failures unrelated to this work, identical at base: Dog `tests/unit/reveal-pickup-*.test.ts` (52) and Bird `tests/unit/native-shell-manifest.test.ts` (1). Do not chase them.

## 4. Device lane (proven 2026-09-14)

1. Build + install: `node tools/native-shell/install.mjs --game find_the_dog --env-file /Users/base/fabrika-keys/find-the-dog.env.ios.local` (phone UDID `00008101-000410EC3EF9001E`, reachable over Wi-Fi via devicectl; pymobiledevice3 screenshots need USB).
2. Relay: `docs/evidence/2026-09-14-iap-cancel-misclassification/relay.py <log.jsonl>` on the Mac (port 5731; pick a free port and edit `inject.html` to match, then inject `inject.html` into `ios/App/App/public/index.html`, add `NSAllowsArbitraryLoads`, `xcodebuild -configuration Debug` and `devicectl install`). Queue JS with `curl -X POST --data-binary '<js>' http://127.0.0.1:<port>/enqueue`; results land in the log. Hooks worth re-arming after every reload: XHR to `api.gameanalytics.com` (shows event ids) and `Capacitor.toNative` for plugin `Purchases` (shows raw resolve/reject objects).
3. Driver: `docs/evidence/2026-09-14-iap-cancel-misclassification/PurchaseFlowTests.swift` dropped into a copy of `tools/verify-device/runner`, `xcodegen generate`, then `TEST_RUNNER_TARGET_BUNDLE_ID=<bundle> TEST_RUNNER_PURCHASE_MODE=cancel|buy TEST_RUNNER_PRODUCT_LABEL='10 Hints ' xcodebuild test ... -only-testing:VerifyDeviceRunner/PurchaseFlowTests`. Env vars must be exported in the shell, not passed as xcodebuild args. StoreKit sheet buttons live in springboard as "Purchase" and "Close". Terminate Find the Bird first or the runner dies with "signal kill".
4. Verify commands: `cd packages/sdk && npx vitest run && npx tsc --noEmit`; `cd games/find_the_dog && npx vitest run tests/unit/gameanalytics-sink.test.ts && npx tsc --noEmit`; same for `games/find_the_bird`.

## 5. Definition of done

- A: merged fix with unit tests in both games and one device capture showing a GA purchase event delivered after the app returned from a StoreKit sheet.
- B and C: merged, verified on device with the driver (label timings, pill values).
- D: Batu's decision recorded in `docs/solutions/` or the report, and either implemented or the plumbing removed.
- E: Bird cancel capture appended to the evidence dir.
- F: clean build on the phone, stated in the report.
- G: size listing sent to Batu; nothing deleted without his word.
- Everything through PRs on `origin/main`; no store submission.
