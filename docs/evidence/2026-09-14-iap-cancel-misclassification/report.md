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
| Complete (sandbox) | Sheet reached and `Purchase` tapped; the sandbox asks for the password of the phone's Apple ID (`03-sandbox-password-prompt.png`). Not entered by the agent. **Pending Batu** (asked on Telegram); the relay keeps recording. |

Screenshots: `01-sandbox-sheet-10-hints.png`, `02-post-cancel-0.6s.png`, `03-sandbox-password-prompt.png`,
`04-buy-attempt-bird-foregrounded.png` (first buy attempt: Find the Bird came to the foreground and the sheet was
cancelled; a second run after terminating Bird reached the password prompt).

Note: the "Cancelled" button label is visible for under a second; `applyShopPurchaseButtonState` re-renders the
control on the next refresh tick. Not changed in this PR.

## Not done / open

- Find the Bird was not exercised on the device; it shares `packages/sdk` and its HUD/GameScene code is identical
  to Dog's at the changed lines (diffed).
- Sandbox complete-purchase proof needs Batu's Apple ID password on the phone.
- Firebase: Batu must enable Google Analytics on `find-the-bird-basegamelab` (Firebase mutation; not done). Even
  then nothing reaches Firebase Analytics until the stub sink is replaced, which this PR does not do.
- RevenueCat tidy-ups (FTB has no offering; FTD default offering points at Test Store products) are dashboard
  mutations awaiting Batu's go; they do not affect purchases (`getProducts` by id).
- Store ship: see the session report for the version plan; ASC state at 12:25 UTC: Dog 1.0.10 (40) READY_FOR_SALE,
  Bird 1.2.4 (39) WAITING_FOR_REVIEW.
- Follow-up read date: 7 days after the fixed builds are live, expect `purchase:cancelled` > 0 and
  `purchase:failed:*` a small fraction of `purchase:sheet_shown`.
