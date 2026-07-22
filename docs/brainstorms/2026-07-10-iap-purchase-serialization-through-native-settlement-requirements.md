---
title: Keep purchase serialization through native settlement
date: 2026-07-10
trello: https://trello.com/c/9SQPxvlw
status: requirements
task-class: iap-contract
owner-card: 9SQPxvlw (AUDIT #4)
contract: packages/sdk/src/iap/service.ts (owner: this card)
---

# Keep purchase serialization through native settlement — requirements

## Problem

`IapService.purchase()` (`packages/sdk/src/iap/service.ts:230-289`) races the native
purchase promise against a JavaScript `withTimeout(...)` and clears the single-flight
lock in a `finally` block. This conflates two independent lifetimes:

- **the caller's wait** — how long the UI is willing to block on a Buy tap, and
- **the native operation's lifetime** — how long the store/StoreKit/Play actually
  takes to settle the charge.

When the caller wait elapses first, `withTimeout` rejects with a `TimeoutError`, the
`catch` returns a `failed` result, and the `finally` immediately releases
`activePurchaseProductId`. The native `purchaseProduct` promise is **still in flight** —
`withTimeout` does not (and cannot) cancel it. Now:

1. A retry (user taps Buy again, or the app auto-retries) passes the single-flight
   guard because the lock is already clear, and issues a **second**
   `provider.purchaseProduct(...)` for the same SKU.
2. When the first native promise finally resolves, its transaction is **discarded** —
   nothing is awaiting it and there is no reconciliation slot for a late purchase
   (unlike restore, which has `completedRestoreResult`).

A deferred-provider reproduction confirmed **two purchase calls for one SKU** from a
single logical purchase intent. The financial risk is a double charge; the correctness
risk is a silently dropped successful transaction.

### Why restore is already safe and purchase is not

The `restore()` path (`service.ts:297-364`) already solved the same class of bug. It:

- starts the native promise, then sets `releaseRestoreLockInFinally = false` so the
  `finally` does **not** clear the lock;
- attaches a **settle handler** bounded by a separate `RESTORE_SETTLE_TIMEOUT_MS`
  (60s) that clears `restoreInProgress` and stashes any late result in
  `completedRestoreResult` for the next `restore()` call;
- awaits a **shorter** user-facing `operationTimeoutMs` for the returned result.

`purchase()` has no equivalent: no separate settle bound, no late-result slot, and a
`finally` that releases the lock the moment the caller wait elapses. This card brings
`purchase()` up to the restore path's proven contract, adapted for a per-SKU charge.

## Goal

A purchase intent for a SKU holds serialization until the underlying native operation
**settles** (resolve or reject), independent of how long the caller is willing to wait.
A late success is reconciled, never discarded; a late failure is observable. No two
overlapping `provider.purchaseProduct` calls can exist for the same active operation.

## Non-goals

- Not changing the `PurchaseProvider` seam's shape unless idempotency support strictly
  requires it (see Open Questions). The provider contract stays owned here regardless.
- Not adding a purchase **queue** — concurrent/duplicate purchases remain *rejected*,
  not serialized-then-run. Only the *timeout-then-retry* overlap is the target.
- Not implementing native/device proof in this stage; that is a later full-pipeline
  stage's job (AC 5). Requirements only here.
- Not touching restore/customer-info/fulfillment behavior beyond keeping them usable
  while a purchase settle is pending.

## Requirements

R1. **Separate the two lifetimes.** The value the caller awaits is bounded by the
    user-facing purchase timeout; the native promise is bounded by a distinct, more
    generous settle timeout. A caller-wait timeout must not, by itself, tear down the
    native operation's bookkeeping.

R2. **Serialize until settlement.** `activePurchaseProductId` (or its successor lock)
    must remain held from the moment the native purchase starts until the native
    promise settles (success, failure, or rejection) OR the settle timeout fires —
    not until the caller wait elapses.

R3. **Reconcile late success.** A native purchase that resolves after the caller wait
    elapsed must be captured in an observable slot (mirroring `completedRestoreResult`)
    so the transaction — and thus the entitlement — is not lost. The next relevant
    query/call surfaces it.

R4. **Observe late failure.** A native purchase that rejects after the caller wait
    elapsed must record `lastErrorMessage`/an observable failure, not vanish.

R5. **No overlapping charges.** Given a timeout on purchase(SKU) followed by a retry of
    purchase(SKU) while the first native promise is still in flight, the retry must be
    rejected (single-flight) rather than issue a second `provider.purchaseProduct` for
    the same active operation. Provider-level request/transaction idempotency should be
    used **where the provider supports it** so that even an unavoidable re-issue cannot
    double-charge — never blindly issue a second charge because the UI wait elapsed.

R6. **Locks always release.** On success, failure, rejection, AND settle-timeout, the
    purchase lock releases. A hung native bridge must not permanently wedge every Buy
    button (the failure mode `withTimeout` exists to prevent). Restore and
    customer-info paths remain usable throughout.

R7. **Separate SKUs are independent.** Serialization is about "one native operation at
    a time," not about a specific SKU — a pending settle for SKU A still blocks SKU B
    (current single-flight semantics preserved), and the reconciliation slot must not
    mis-attribute A's late result to B.

R8. **Contract round-trips.** Operation identity, serialization state, timeout, and
    native settlement must round-trip through `PurchaseProvider` and `IapService`
    without losing a transaction. This file's service remains the single contract owner
    (lesson: contract-ownership); any consumer imports the shape and proves a
    zero-adaptation round trip rather than re-declaring it.

## Acceptance criteria (from card, restated for testability)

- AC1. A timeout followed by retry cannot produce overlapping provider purchase calls
  for the same active operation. *(Test: deferred provider; purchase(SKU) times out;
  retry purchase(SKU); assert `provider.purchaseCalls` contains exactly one entry for
  SKU while the first is unsettled.)*
- AC2. Late native success is observable/reconciled, not discarded. *(Test: after the
  timeout, settle the first native promise successfully; assert the transaction is
  retrievable via the reconciliation slot / next query, entitlement preserved.)*
- AC3. Locks release after settlement on success, failure, and rejection; restore and
  customer-info paths remain usable. *(Test: each terminal outcome + settle-timeout
  clears the lock; a restore() issued after settlement succeeds.)*
- AC4. Deterministic deferred-promise tests cover timeout+retry, late success, late
  failure, and separate SKUs. *(Use `FakePurchaseProvider` deferred/delay/hang knobs
  and fake timers; no real timers, no network.)*
- AC5. Native/device verification is required at later full-pipeline stages; this and
  the planning stage must NOT claim native proof from mocks. Unit tests prove the
  serialization/reconciliation logic; on-device proof is a separate, later artifact.

## Testability notes (for the planning stage)

- `FakePurchaseProvider` already exposes the needed knobs: `purchaseDelayMs`,
  `hangingPurchaseProductIds`, `purchaseResults`, `purchaseErrors`, and a
  `purchaseCalls: string[]` log to assert call count/overlap.
- The restore-path tests in `service.test.ts` / `restore-machine.test.ts` are the
  pattern to mirror for deferred-settle assertions.
- Prefer deterministic fake timers over `setTimeout` sleeps so timeout+retry ordering
  is exact and fast.

## Open questions (resolve in planning)

- Q1. **Reconciliation surface for a late purchase.** Restore uses
  `consumeCompletedRestoreResult()` polled on the next `restore()`. Purchase has no
  natural "next purchase" to piggyback on (the user succeeded/left). Options: (a) a
  `consumeCompletedPurchaseResult()` the UI polls after a timeout; (b) route late
  success through the existing `customerInfo`-update listener / fulfillment path (a
  successful purchase already updates customerInfo); (c) a completion callback.
  Planning must pick one and justify it against how the UI/fulfillment currently reads
  entitlements. Leaning toward (b)/fulfillment reconciliation since a late-settled
  purchase's entitlement should flow through the same path a deferred purchase does.
- Q2. **Provider idempotency.** Does the RevenueCat adapter (`revenuecat-provider.ts`)
  expose or need a request/transaction id to make a re-issued `purchaseProduct`
  idempotent? If the provider gives no idempotency key, R5 is satisfied purely by the
  single-flight-until-settle lock (no second call is ever issued), and provider
  idempotency becomes belt-and-suspenders. Confirm during planning; do not expand the
  provider seam speculatively.
- Q3. **Settle-timeout constant.** Reuse `RESTORE_SETTLE_TIMEOUT_MS` semantics or
  introduce `PURCHASE_SETTLE_TIMEOUT_MS`? A charge may legitimately take longer than a
  restore (deferred/pending StoreKit states); planning should size this deliberately.

## Reuse / precedent

- **In-repo precedent (concrete):** the `restore()` settle-lock pattern in
  `service.ts:317-363` — separate settle bound, late-result slot, lock-until-settle.
  Adapt, don't copy blindly (a charge is not a restore).
- The card references
  `fabrika/docs/solutions/integration-issues/revenuecat-native-operation-serialization-20260522.md`
  as conceptual reuse. That path does **not exist in this repo** (no `fabrika/` tree;
  `docs/solutions/` holds only cameleon lessons + INDEX). Treated as advisory/external;
  the restore path above is the authoritative in-repo template. Flag for planning in
  case the doc lives elsewhere.
