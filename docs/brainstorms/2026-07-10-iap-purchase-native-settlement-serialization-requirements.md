---
title: "packages/sdk — iap: keep purchase serialization through native settlement (requirements)"
date: 2026-07-10
trello: https://trello.com/c/9SQPxvlw
card: 9SQPxvlw
stage: todo → brainstormed
status: requirements-locked
task_class: iap-contract
contract_owner: packages/sdk/src/iap/service.ts
---

# packages/sdk: iap — keep purchase serialization through native settlement

Requirements/approach artifact for the `todo → brainstormed` transition. **No code is written
at this stage.** This doc front-loads what the later stages need: (1) a precise trace of the
race, (2) the reframe — the fix already lives in this file's sibling `restore()` path, so the
job is *mirror the proven pattern*, not invent one, (3) requirements as testable outcomes
mapping 1:1 to the card's acceptance criteria, and (4) blindspots the plan/worked stages must
resolve before touching code.

## The headline that reframes the card

`IapService.purchase()` (`service.ts:230-289`) and `IapService.restore()` (`service.ts:297-363`)
are sibling native operations behind the same single-flight lock. **`restore()` was already
hardened against exactly this race; `purchase()` was not.** The card is not a design problem —
it is: *carry `restore()`'s late-settle discipline onto the purchase path.*

Compare the two today:

| Concern | `restore()` (hardened) | `purchase()` (racy) |
|---|---|---|
| Caller-facing wait | `withTimeout(restorePromise, operationTimeoutMs, …)` — a **view** onto the native promise | `withTimeout(provider.purchaseProduct(…), purchaseTimeoutMs, …)` — the **only** handle on the native promise |
| Native promise lifetime | Kept alive independently; bounded separately by `RESTORE_SETTLE_TIMEOUT_MS` | Not tracked separately; abandoned when the caller timeout wins |
| Lock release | Deferred to a `.then/.catch` on the native promise that flips `restoreInProgress=false` **after** native settles (`:334,342`) | `finally` clears `activePurchaseProductId` the instant the caller `await` unwinds — **including on timeout** (`:283-288`) |
| Late result | Captured into `completedRestoreResult`, drained by `consumeCompletedRestoreResult()` (`:291-295, 311-312, 331-341`) | **Discarded** — no capture path exists |

So a purchase timeout releases the lock while native work is still in flight; a retry passes the
`activePurchaseProductId === null` guard (`:237`) and calls `provider.purchaseProduct()` a
**second time** for the same SKU. That is the reproduction the card cites: *two purchase calls
for one SKU under a deferred provider.*

## Precise trace of the race (acceptance criterion #1)

1. `purchase('coins')` sets `activePurchaseProductId = 'coins'` (`:256`).
2. `await withTimeout(provider.purchaseProduct('coins'), purchaseTimeoutMs, 'purchaseProduct')`
   (`:258-262`). `withTimeout` rejects when the timer wins; **it does not cancel the native
   promise** — `provider.purchaseProduct` keeps running (see `FakePurchaseProvider`
   `hangingPurchaseProductIds` / `purchaseDelayMs`, `fake-provider.ts:74-86`).
3. The timeout rejection lands in `catch` → returns `{status:'failed'}`; `finally` clears
   `activePurchaseProductId` (`:283-288`).
4. Caller retries `purchase('coins')`. Guard at `:237` sees the lock free → a **second**
   `provider.purchaseProduct('coins')` fires. Two native charges are now in flight for one op.
5. Whichever native promise settles first has its transaction **thrown away** — nothing holds
   a reference to reconcile it. AC#2 violation stacked on AC#1.

## Prior-art ledger

| Source | Disposition |
|---|---|
| `service.ts` `restore()` late-settle machine (`:319-362`) | **ADOPT the shape** — separate settle bound, lock-release-after-settle, `completed*Result` capture + `consume*` drain. This is the template. |
| `RESTORE_SETTLE_TIMEOUT_MS` / `DEFAULT_PURCHASE_TIMEOUT_MS` / `DEFAULT_OPERATION_TIMEOUT_MS` (`:126-133`) | **REUSE the pattern** — purchase already has a caller-wait constant (`purchaseTimeoutMs`, 60s). It needs a *separate* native-settle bound analogous to `RESTORE_SETTLE_TIMEOUT_MS`, OR to keep the caller-wait as the settle bound and stop treating its expiry as lock-release. Plan stage decides which; see Open Questions. |
| `consumeCompletedRestoreResult()` drain contract (`:291-295`) | **MIRROR** — a `consumeCompletedPurchaseResult()` (or equivalent reconciliation surface) so a late native success is *observable*, not discarded (AC#2). Must round-trip through `index.ts` exports (contract-ownership: this file owns the shape; UI consumers import it). |
| `FakePurchaseProvider` (`fake-provider.ts`) | **REUSE as-is** — `hangingPurchaseProductIds`, `purchaseDelayMs`, `purchaseResults`, `purchaseErrors`, `purchaseCalls[]` already give deterministic timeout+retry, late-success, late-failure, and separate-SKU control. `purchaseCalls.length` is the AC#1 assertion handle. No new test infra needed. |
| `restore-machine.ts` (pure display-state algebra) | **REFERENCE ONLY** — shows the SDK-ships-algebra / UI-ships-clock split. Any new purchase reconciliation state must respect the same boundary (no copy/toast/timer in the SDK). |
| Provider-level request/transaction idempotency (card's "idempotency where the provider supports it") | **INVESTIGATE at plan stage** — `PurchaseProvider.purchaseProduct(productId)` (`:76`) has no request-id parameter today. See Open Questions; do not widen the port speculatively. |
| `revenuecat-native-operation-serialization-20260522.md` (card-cited learning) | **MISSING from this checkout** — `fabrika/docs/solutions/integration-issues/` does not exist here (only `docs/solutions/{INDEX.md, 2026-07-09-cameleon…}`). Card says "reuse conceptually, do not copy." The concept is already embodied in `restore()`; treat `restore()` as the canonical local prior art. Flagged for plan stage to locate the doc in the read-only `fabrika` source if deeper provider guidance is needed. |

## Requirements (outcomes, not implementation)

R1 — **Serialization survives the caller timeout.** (AC#1, AC#3) The single-flight lock for a
purchase MUST remain held from the moment `purchaseProduct` is issued until the *native* promise
settles (resolve/reject/hang-bound), independent of when the caller-facing wait expires. A retry
issued after a timeout MUST be rejected with `status:'unavailable'` (the existing
"native store operation already in progress" contract) while native work is still in flight —
never issue a second `provider.purchaseProduct` for the same active operation.

R2 — **Separate caller wait from native lifetime.** The user-facing `purchase()` promise MAY
resolve/return on the faster caller-wait timeout so the UI is not blocked, but that return MUST
NOT be interpreted as "operation over." The native promise MUST be retained and bounded by its
own settle timeout (mirroring `RESTORE_SETTLE_TIMEOUT_MS`) so a hung bridge cannot wedge the
lock forever.

R3 — **Late native success/failure is reconciled, not discarded.** (AC#2) When native settles
*after* the caller-facing return, the outcome MUST be captured and made observable through an
explicit drain surface analogous to `consumeCompletedRestoreResult()` — a late success grants
the entitlement, a late failure is recorded. No transaction is silently dropped.

R4 — **Locks release after settlement on every terminal.** (AC#3) On native success, native
failure, native rejection, and settle-timeout, `activePurchaseProductId` MUST end up cleared.
`restore()`, restore-during-purchase and purchase-during-restore mutual exclusion, and the
customer-info listener path MUST remain functionally unchanged (regression guard on the sibling
paths).

R5 — **Idempotency, where the provider supports it.** (card decided direction) The design MUST
NOT "blindly issue a second charge because the UI wait elapsed." R1 achieves this at the service
layer by serialization alone. IF a provider-level request/transaction idempotency key is
introduced, it MUST be owned by the `PurchaseProvider` contract (this card owns
`service.ts`), exported through `index.ts`, and proven with a zero-adaptation round-trip — not
re-declared per consumer. Whether to widen the port now or defer is an Open Question for plan.

R6 — **Deterministic deferred-promise coverage.** (AC#4) New unit tests, using
`FakePurchaseProvider`'s existing knobs, MUST cover: (a) timeout→retry issues exactly one native
purchase call (`purchaseCalls.length === 1`) and the retry is rejected while native is pending;
(b) late native **success** after a timed-out caller return is observable via the drain surface
and grants; (c) late native **failure** after timeout is recorded, lock released; (d) two
**separate SKUs** serialize correctly (second rejected while first pending, then succeeds after
first settles). Tests MUST be deterministic (fake timers / controllable promises), no wall-clock
flake.

R7 — **Contract fidelity.** (lesson: contract-ownership) Any new/changed exported shape
(`IapPurchaseResult` additions, a completed-purchase result type, a drain method,
`PurchaseProvider` widening) lands in `service.ts` and is surfaced from
`packages/sdk/src/index.ts`; consumers import it and prove a zero-adaptation round trip. No
parallel re-declaration of the purchase-result shape.

## Non-goals (right-sizing)

- **No native/device proof at this or the worked stage from mocks.** (AC#5) Native settlement
  verification on a real device belongs to the later full-pipeline evidence stage. The
  worker MUST NOT claim native proof from `FakePurchaseProvider`. This doc, plan, and worked
  stages prove the *state machine* deterministically; the device stage proves the *bridge*.
- **No refactor of `restore()`** beyond what's needed to share a helper (if the plan extracts a
  common late-settle helper, that is in-scope; a speculative rewrite is not).
- **No new UI, copy, toasts, or timers in the SDK** — the SDK ships the algebra + drain surface;
  the UI package owns the poll clock and pixels (per `restore-machine.ts` boundary).
- **No provider-port widening unless plan justifies it** against a concrete RevenueCat idempotency
  capability; serialization (R1) is the primary, sufficient defense against double-charge.

## Open questions for the plan stage

1. **One settle bound or two constants?** Reuse `purchaseTimeoutMs` (60s) as both caller-wait and
   settle bound (simplest, but a 60s hang blocks the lock 60s), or add a distinct
   `PURCHASE_SETTLE_TIMEOUT_MS` mirroring restore? Restore uses distinct constants; symmetry
   argues for the same. Decide with the actual expected native purchase latency.
2. **Drain surface shape.** Does a late purchase reconcile through a `consumeCompletedPurchaseResult()`
   twin, through the existing customer-info-update listener (`:365-390`, which already recovers
   deferred entitlements), or both? Note the listener path deliberately must **not** re-fulfill
   consumables (`:192-196` warns of double-grant via differing listener ids) — the reconciliation
   design must not reintroduce that double-grant.
3. **Does the caller-facing `purchase()` return early at all, or just hold the lock longer?**
   Restore returns early and stashes the late result; purchase *could* simply keep the caller
   awaiting until native settles (no early return) and only decouple the lock from a *retry*.
   The minimal fix satisfying AC#1–#3 may be "hold the lock until native settles; reject retries
   meanwhile" without an early caller return. Plan should pick the smallest shape that passes R6.
4. **Provider idempotency key** — does the RevenueCat adapter expose a transaction/request id we
   can thread to make a re-issued purchase idempotent at the store, as a belt-and-suspenders to
   R1? Locate the missing learning doc in read-only `fabrika` before deciding.

## Acceptance mapping (traceability)

| Card AC | Requirement(s) | Verified at |
|---|---|---|
| #1 timeout+retry → no overlapping provider calls | R1, R6a | worked (unit) |
| #2 late native success observable/reconciled | R3, R6b | worked (unit) |
| #3 locks release on success/failure/rejection; restore/customer-info usable | R4, R6c | worked (unit) |
| #4 deterministic deferred-promise tests (timeout+retry, late success/failure, separate SKUs) | R6 | worked (unit) |
| #5 native/device verification at later stages; no native proof from mocks | Non-goals | device/evidence stage |

## Verification for this artifact

Requirements-only; no code. The claims above were grounded by reading `service.ts` (full),
`fake-provider.ts`, `restore-machine.ts`, and confirming the learning doc's absence in this
checkout (`fabrika/docs/solutions/integration-issues/` not present; `docs/solutions/` holds only
`INDEX.md` + one cameleon doc). Downstream code verification remains: `npm run typecheck -w
@fabrikav2/sdk`, root `npm run test:unit`, `npx eslint packages/sdk`, plus device proof at the
evidence stage.
