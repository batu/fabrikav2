# IAP follow-up progress — 2026-09-14

No release is authorized. Nothing has been uploaded, submitted, installed, or
merged in this follow-up session. No RevenueCat or Firebase provider settings
were mutated.

## Checklist

- A: Reproduced in the Dog unit test `delivers a purchase emitted between
  endSession and startSession once after resume`. On the unmodified sink,
  the expected one delivered `purchase:cancelled` event is zero. Command:
  `npx vitest run tests/unit/gameanalytics-sink.test.ts -t 'delivers a purchase emitted between'`.
  Result: 1 failed, 34 skipped. Both sinks now queue between sessions and wait
  for native readiness after resume. Background flushes return without dropping
  the queue or consuming the next session's readiness budget. Unit tests pass;
  merge and device delivery capture remain pending.
- B: Both HUDs hold cancellation/failure feedback for 2.5 seconds, including the
  accessibility label; a fresh purchase tap clears it. Unit tests cover 0.6s,
  2.4s, and the next tap. Device timing evidence and merge remain pending.
- C: The fulfilled branch already called updateHUD, but updateHUD did not update
  the Home balance spans. Both games now refresh Home hints and coins there.
  Unit tests drive a verified purchase through fulfillment and compare Home and
  shop hints. Device evidence and merge remain pending.
- D: Batu chose **both** on 2026-09-14: retain GameAnalytics and wire Firebase
  Analytics. Both games now compose the existing shared Firebase adapter with a
  lazy native plugin transport, canonical name mapping, and sanitized params.
  Native/config gates, dependency declarations, and iOS manifests are updated.
  The iOS package uses AnalyticsWithoutAdIdSupport. Canonical lifecycle events
  project as game_session_start/game_session_end to remain distinct from
  Firebase's automatic sessions. Unit tests pass; native delivery is unverified.
- E: Pending Bird cancel capture. `xcrun devicectl list devices` reported Batu's
  iPhone 12 connected during this session.
- F: Pending clean build installation; phone not modified by this session.
- G: Inventory delivered. Batu authorized deleting old build outputs. Deleted
  three inactive, unpinned scratch outputs after checking metadata, owner PIDs,
  and open files:
  - `find_the_dog-ios-debug-7mwxymhq`
  - `find_the_bird-ios-debug-bhm4lv3a`
  - `mage_master-ios-debug-csv0inpq`
  All were under
  `/Users/base/.local/share/agency/build-outputs/2071f226751e2447/`.
  `df -h /` increased from 26 GiB available to 30 GiB before worktree creation.
  Today’s builds, pinned outputs, release output, and temporary directories
  were retained. No `rm` or stash command was used.

## Workspace

New isolated worktree: `.worktrees/iap-followups`, branch `fix/iap-followups`,
created from `origin/main` using the `find-games` profile. Root, SDK, Dog,
and Bird node_modules are symlinked to the main checkout's node_modules.
Main checkout's unrelated changes were not edited. The scoped profile omitted
games/shared, so it was added to this worktree's sparse checkout for typechecking.

## Checks and review

- SDK: 403 tests passed; npx tsc --noEmit passed.
- Dog: focused analytics/composition/plugin/shop suite passed (75 tests before
  the final additional background-budget test). Final GameAnalytics suite:
  37 tests passed; npx tsc --noEmit passed.
- Bird: focused suite passed (70 tests before the final additional
  background-budget test). Final GameAnalytics suite: 34 tests passed;
  npx tsc --noEmit passed.
- Native-shell manifest tests: 17 passed.
- npx eslint . passed in each game.
- Full game suites were not run; known unrelated failures were not investigated.
- One independent read-only reviewer (iap_review) checked session reliability,
  Firebase mapping, native gating and related tests. It identified retry-budget
  consumption during deliberate background waits. Fixed with an early pause
  guard and an asynchronous-resume regression in both games. No other concrete
  code defect was reported. Parent reviewed HUD timing/balance changes inline.

## Device blocker and next steps

The shared physical-device lock is actively held by the ftb-onboarding-layer
session (attempt 20260914-physical, PID 95584). lsof confirmed the open lock
at /Users/base/dev/appletolye/.twf-device/physical-device.lock. No takeover,
installation, launch, or device capture was attempted.

After that lease is released, use the original handoff section 4. Materialize
the protected per-game GoogleService-Info.plist into this new worktree's ignored
native-resources/ios/App directory (the main checkout has the current files;
do not print or commit their contents). Verify native Firebase events, a GA
purchase event after a StoreKit background/return, both label timings, both
balance pills, and Bird cancellation. Then install clean uninstrumented builds,
append the captures here, and merge only after review and required checks pass.
Do not enter the stored sandbox password without fresh authorization for this
session. No App Store Connect uploads, versions, or submissions.

The local GoogleService-Info.plist files contain IS_ANALYTICS_ENABLED=false.
Firebase's own source documentation lists that as an unread legacy field:
https://github.com/firebase/firebase-ios-sdk/blob/main/docs/FirebaseOptionsPerProduct.md.
It is not the app's FIREBASE_ANALYTICS_COLLECTION_ENABLED setting. Do not
change downloaded configuration based on that legacy field.
