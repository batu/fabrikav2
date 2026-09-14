# Find games IAP: "Unavailable" purchases were misclassified user cancellations

Date: 2026-09-14. Branch `fix/iap-cancel-classification`, PR #78. Handoff: `docs/handoffs/2026-09-14-iap-purchase-failures.md`.

## Cause (proven on device)

The RevenueCat Capacitor plugin (13.2.3) rejects a failed `purchaseStoreProduct` call through
`PurchasesPlugin.rejectWithErrorContainer`, which calls `call.reject("\(error.message)", "\(error.code)", nsError)`
with **no data payload**. Capacitor's `JSResultError.jsonPayload()` therefore serializes only
`{ message, errorMessage, code }`, and `native-bridge.js` copies those keys onto a `CapacitorException`.

Raw rejection captured on Batu's iPhone 12 (Find the Dog debug build, real `appl_` key, sandbox, user tapped the
sheet's close button), via a hook on `Capacitor.toNative` for the `Purchases` plugin (`relay-rc-reject.jsonl`):

```
{"message":"Purchase was cancelled.","code":"1","errorMessage":"Purchase was cancelled.",
 "__isError":true,"__ctor":"Ge","__oldDetector":false}
```

`code` is the numeric RevenueCat `purchaseCancelledError` (1) as a **string**; `userCancelled` and
`readableErrorCode` are absent. `IapService.isUserCancelled` accepted only `userCancelled === true` or a string code
containing "cancel", so the old detector returned `false` (`__oldDetector`) and every user cancel became
`status: 'failed', failureKind: 'store-error'`: the shop button read "Unavailable", the fail-continue message said
"Purchase unavailable.", and analytics logged `purchase:failed`.

## Field numbers and what can and cannot be attributed

GameAnalytics, 2026-09-01 to 2026-09-13, iOS:

| | FTB | FTD |
|---|---:|---:|
| purchase:initiated | 28 | 65 |
| purchase:sheet_shown | 28 | 65 |
| purchase:failed | 24 | 60 |
| purchase:cancelled | 0 | 0 |
| purchase:fulfilled | 0 | 1 |

- **Zero cancels across 93 opened sheets is impossible under the old code**: the device capture shows a cancel is
  logged as `purchase:failed`. Every one of the 84 failures is consistent with a cancel.
- **The per-failure reason was never stored anywhere.** Both games' `FirebaseAnalyticsSink` is the disabled stub
  (`createFirebaseAnalyticsSink()` returns `createDisabledFirebaseAnalyticsSink()`), the owned analytics mirror is
  not configured in the shipped env (no `VITE_FTD_OWNED_ANALYTICS_MIRROR_URL` in the Sep 10 bundles), and
  GameAnalytics receives the event name plus custom fields that are not queryable on the current plan.
  Checked in Batu's Chrome: Find the Bird's Firebase project has Google Analytics **disabled**; Find the Dog's
  project (`find-the-dog-basegamelab`, GA4 property p553123121) has it enabled but shows **"No data available"**
  for Aug 17 to Sep 13, which matches the stub sink. The handoff's `hidden-object-base` project is the v1 project.
- Therefore: **FTB's 24 and FTD's 60 failures cannot be split into cancel / timeout / store error retroactively.**
  The evidence for "mostly cancels" is structural (zero cancels is not a possible output of the old code) plus
  RevenueCat showing exactly one production transaction in 28 days while ASC lists all 12 products per app
  APPROVED and the field build loaded 12/12 products (sheet_shown == initiated). A timeout or store-error share
  cannot be excluded and will only become visible with this build, whose GameAnalytics ids are
  `purchase:cancelled`, `purchase:failed:store_error`, `purchase:failed:timeout`, `purchase:failed:unavailable`.

## Fix

1. `packages/sdk/src/iap/revenuecat-provider.ts`: `purchaseProduct` catches the plugin rejection and throws
   `RevenueCatPurchaseError` with `userCancelled` derived from every shape the plugin can produce: bridge string
   code `"1"`, numeric code `1`, `readableErrorCode` / `readable_error_code` containing CANCEL, nested `data`,
   message text. Real store errors keep their message and code and stay `store-error`.
2. `packages/sdk/src/iap/service.ts`: `isUserCancelled` also accepts `readableErrorCode` and message text as a
   fallback for a rejection that skipped provider normalization.
3. HUD + GameScene in both games: real failures read "Couldn't complete" / "Purchase couldn't complete. Try again."
   instead of "Unavailable"; cancels still read "Cancelled".
4. `GameAnalyticsEvents.ts` in both games: `purchase_failed` maps to `purchase:failed:<failure_kind|reason>` so
   the split is readable from the event list alone (Batu's item 5).

Tests: `revenuecat-provider.test.ts` (bridge shape, documented `PurchasesError` shape, store error, unrelated codes,
nested data), `service.test.ts` (raw bridge cancel vs store error through the service), `gameanalytics-sink.test.ts`
in both games (new ids). packages/sdk 403/403; Dog and Bird suites green except pre-existing failures that fail
identically at base 81d4d9be7 (Dog `reveal-pickup-*` 52, Bird `native-shell-manifest` 1).

## Device evidence (iPhone 12, iOS 26.6.1, Find the Dog debug build of this branch, sandbox environment)

Lane: `tools/native-shell/install.mjs --game find_the_dog --env-file ~/fabrika-keys/find-the-dog.env.ios.local`,
then `inject.html` (console + eval relay, `relay.py` on the Mac) injected into the shell's `index.html`, rebuilt and
reinstalled; XCUITest driver `PurchaseFlowTests.swift` (scratch copy of `tools/verify-device/runner`) taps
"Open shop", the `10 Hints` product, and the StoreKit sheet's `Close` (springboard) or `Purchase` button.

| Flow | Result |
|---|---|
| Cancel (sheet close) | GameAnalytics request body on device: `purchase:initiated`, `purchase:sheet_shown`, **`purchase:cancelled`**; no `purchase:failed`. Raw rejection logged as above. Repeated 3x (runs 7, 9, 10). |
| Interrupted (app killed while the sandbox password prompt was up, relaunched) | App relaunches to Home, hint balance unchanged (3), no pending-purchase fulfillment, no `purchase:failed` / `purchase:fulfilled`; shop shows the product purchasable again. |
| Complete (sandbox) | Batu authorized entering the stored Apple ID password (12:45 UTC). XCUITest typed it on the sandbox sheet and tapped Confirm; the bridge hook logged `RC_RESOLVE purchaseStoreProduct` with the customer info, the wallet went from 3 to 13 hints, transaction id `2000001235965576` was added to `ftd_wallet_processed_purchase_ids`, and `find_the_dog_pending_purchases_v1` is `[]` (`05-sandbox-purchase-complete.png`). No charge (sandbox). Finding: no GameAnalytics purchase events reached the network for this flow because the SDK logged `Could not add design event: Session has not started yet` after the app returned from the password sheet, so `purchase:fulfilled` can be dropped when a purchase spans a backgrounding. Not fixed here; follow-up. Also the Home hint pill stays stale (3) behind the open shop until `updateHUD` runs, while the shop header pill shows 13. |

Screenshots: `01-sandbox-sheet-10-hints.png`, `02-post-cancel-0.6s.png`, `03-sandbox-password-prompt.png`,
`04-buy-attempt-bird-foregrounded.png` (first buy attempt: Find the Bird came to the foreground and the sheet was
cancelled; a second run after terminating Bird reached the password prompt).

Note: the "Cancelled" button label is visible for under a second; `applyShopPurchaseButtonState` re-renders the
control on the next refresh tick. Not changed in this PR.

## Done after the PR (Batu: "all but 1, you do", 12:40 UTC)

- Firebase: Google Analytics enabled on `find-the-bird-basegamelab` (property under "Default Account for Firebase"; dashboard renders with zeros). Still inert until the stub sink is replaced.
- RevenueCat, via new v2 secret keys `offerings-tidy-2026-09-14` (Project configuration read & write; stored at `~/.config/base-game-lab/revenuecat/find-the-{dog,bird}-v2-secret`, 0600):
  - FTD `default` offering (`ofrnge96bb3d071`): the App Store product attached to all 10 packages (Test Store attachment kept), plus new packages `custom_com.baseardahan.hiddenobj.hints10x` / `hints25x`; all 12 App Store products now served.
  - FTB `default` offering created (`ofrng6fb29d4014`, current) with 12 packages, one per App Store product (`$rc_lifetime` = noads).
  - Note: attach is `POST /packages/{id}/actions/attach_products`; `PATCH /offerings/{id}` is not allowed on v2 (the first offering becomes current automatically).

## Not done / open

- Find the Bird was not exercised on the device; it shares `packages/sdk` and its HUD/GameScene code is identical
  to Dog's at the changed lines (diffed).
- GameAnalytics drops purchase events when the purchase spans a backgrounding (session not restarted); see the Complete row.
- The phone still carries the instrumented Dog debug build (console relay + ATS exception); reinstall the store build or run install.mjs without the relay before any measurement.
- Store ship: see the session report for the version plan; ASC state at 12:25 UTC: Dog 1.0.10 (40) READY_FOR_SALE,
  Bird 1.2.4 (39) WAITING_FOR_REVIEW.
- Follow-up read date: 7 days after the fixed builds are live, expect `purchase:cancelled` > 0 and
  `purchase:failed:*` a small fraction of `purchase:sheet_shown`.
