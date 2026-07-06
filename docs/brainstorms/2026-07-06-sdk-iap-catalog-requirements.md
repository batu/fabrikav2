---
title: "packages/sdk — iap: product-catalog schema + RevenueCat purchase/restore + fulfillment (requirements)"
date: 2026-07-06
trello: https://trello.com/c/GE3h3u1F
card: GE3h3u1F
depends_on: Fw1NtsCr
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika
---

# packages/sdk: iap — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. **No code is
written at this stage.** This doc front-loads what the `worked` stage needs: (1) an
evidence-mapped decomposition of FTD's 1,056-line shop backend into a *game-agnostic*
`@fabrikav2/sdk/iap` subtree, (2) the exact game→SDK seam that lets the catalog schema
validate FTD's real product list while carrying zero FTD-specific grant semantics, and
(3) the AC test plan (catalog fixture, purchase/restore state machines, fulfill-once
idempotency, dismissed-mid-purchase guard).

The card is a **generalize** (research `04` claim 6): FTD is the *sole* IAP implementor in
v1 — research `07` verifies "no shared IAP-restore machine in `@fabrika/core`; FTD is sole
implementor; promote-to-core candidate." So unlike audio (4 divergent copies to unify) there
is only one source of truth to lift. The whole risk is **de-coupling**, not reconciliation:
FTD's shop code is already clean and well-tested, but every layer reaches for FTD-specific
concepts (`hints`, `coins`, `noAds`, `continueLevel`, `gameState`, DOM `#shop-restore-btn`).
The job is to draw the seam so those concepts stay in the game and the SDK ships the
mechanism.

## Goal

Stand up one `@fabrikav2/sdk` subpath, `./iap`, with four extraction units mapped 1:1 to
FTD's three shop files plus the restore state machine embedded in `HUD.ts`:

| SDK unit (new) | Lifted from (READ-ONLY v1) | Lines | Verdict |
|---|---|---|---|
| `src/iap/catalog.ts` — game-agnostic catalog schema + validators | `games/find_the_dog/src/shop/ProductCatalog.ts` | 172 | **GENERALIZE** (strip FTD grant fields; keep id/productId/tier/kind/badges/visible + validators) |
| `src/iap/service.ts` — `IapService` w/ provider seam | `games/find_the_dog/src/shop/IapService.ts` | 617 | **GENERALIZE + re-seam** (extract `PurchaseProvider` port; RevenueCat impl + `FakePurchaseProvider`; drop `*ForTest` fields) |
| `src/iap/fulfillment.ts` — fulfill-once + unfulfilled-retry | `games/find_the_dog/src/shop/PurchaseFulfillment.ts` | 267 | **GENERALIZE** (opaque grant `TGrant`; keep ledger-dedup + restore-retry mechanics) |
| `src/iap/restore-machine.ts` — restore state machine **CONTRACT ONLY** | `games/find_the_dog/src/ui/HUD.ts` lines 964–1147 (research `07` R28–R43) | ~180 | **EXTRACT as pure transitions** (no DOM; UI control is a later ui-package card, consumes via interface) |

Acceptance (card AC): catalog schema validates FTD's actual catalog (its 13-product list
copied into a test fixture); purchase + restore state machines unit-tested incl.
dismissed-mid-purchase guard (R37 `shouldResume`) and fulfill-once idempotency.
Verification: `npm run typecheck --workspace=packages/sdk && npm run test:unit --workspace=packages/sdk`.

## Constraints (inherited, non-negotiable)

- **v1 is READ-ONLY.** Read from `/Users/base/dev/appletolye/fabrika`; never edit it.
- **Files touched: `packages/sdk/**` (the `iap/` subtree only).**
- **Sandbox-mode default** (decisions doc §"SDK test credentials"): the RevenueCat provider
  defaults to sandbox/test purchases; FTD's `isRevenueCatTestStoreKey` (`test_` prefix) alias
  path carries as the sandbox seam. Real marble_run app IDs are a Blocked-on-Batu item only
  where sandbox is impossible — **not** needed for this card (unit tests use the fake provider,
  no live store). Residual risk (untagged events polluting FTD prod) is analytics-card scope,
  N/A here.
- Advance exactly one column; no PRs (conductor merges); no secrets.
- **UI guardrail #2 (zero literal colors/copy/asset paths in `packages/ui`) is N/A here** — this
  is `packages/sdk`, no rendering surface. BUT note the corollary that *does* bind this card:
  the restore machine's user-facing **copy strings** (`'✓ No Ads restored.'`,
  `'Store is still loading.'`, …) must be **injected**, not baked into the SDK — they are the
  ui-package's concern later. The SDK ships state → *state-key*, the caller maps state-key →
  copy. (FTD's `restoreStatusText` hardcodes English; that string table does NOT carry.)

---

## Part 1 — Catalog schema: what "game-agnostic" means

FTD's `ShopCatalogProduct` (ProductCatalog.ts:8–21) mixes two things:

```ts
// UNIVERSAL (every game's store has these)          // FTD-SPECIFIC (grant payload)
id, title, productId, displayPrice, visible,          hintAmount, coinAmount,
kind, group, purchaseType, description                grantsNoAds
```

The universal fields describe *a thing you can buy*; the FTD-specific fields describe *what
buying it gives you in FTD*. The generalization splits them:

### Proposed SDK schema (worked stage)

```ts
export type ProductKind = 'entitlement' | 'consumable';
// 'entitlement'  = non-consumable, restore-recoverable (FTD noAds, noAdsPremium's no-ads half)
// 'consumable'   = one-shot grant, NOT restore-recoverable (FTD hint/coin packs, ego offer)
// FTD's 'mixed' (noAdsPremium, egoOffer) is expressed as kind:'entitlement'|'consumable'
//   + the game's grant map; the SDK does not need a third kind (see §restore below).

export interface CatalogProduct<TPayload = unknown> {
  id: string;                 // stable game-facing key (FTD 'no-ads', 'hint-pack-10')
  productId: string;          // store SKU (from remote config / injected reader)
  title: string;
  description: string;
  kind: ProductKind;
  group: string;              // free-form grouping key (FTD 'entitlements'|'hints'|'coins'|'failOffer')
  tier: number;               // ordering within a group (NEW — card asks for 'tiers'; FTD implied it by array order)
  badges: string[];           // semantic badge KEYS only, e.g. ['best-value'] (NEW — card asks for 'badges';
                              //   ui-package maps key→copy/style; NO literal copy in the catalog)
  displayPrice: string;       // fallback price string; live price comes from the store product
  visible: boolean;
  payload: TPayload;          // OPAQUE to the SDK — the game's grant descriptor (FTD: {hints,coins,noAds,...})
}

export interface Catalog<TPayload = unknown> { products: CatalogProduct<TPayload>[]; }
```

**Why `payload` opaque, not typed grant fields.** FTD's `hintAmount`/`coinAmount`/`grantsNoAds`
are exactly why its catalog can't be reused. The SDK stores whatever the game hands it and
never reads it; the game's `grantForCatalogProduct` (Part 3) is the only code that
interprets `payload`. This is the same "inject the policy" move the haptics card made with
`isEnabled`. A game with no coins just uses a different `TPayload`.

**Validators carry as-is** (pure, game-agnostic already): `duplicateCatalogProductIds`,
`assertUniqueCatalogProductIds` (ProductCatalog.ts:108–124) move verbatim — they operate on
`productId` only. `buildShopCatalog` (visible filter) → generic `visibleProducts(catalog)`.

**`tier` + `badges` are net-new** (card requirement, no FTD source). Keep them minimal:
`tier: number` (sort key) and `badges: string[]` (opaque keys). Do **not** invent a badge
taxonomy or styling — that's ui-package scope. They exist so the schema can *carry* the
concepts; the fixture below sets `tier` by array position and `badges: []` for all FTD
products (FTD had none).

### AC: the FTD fixture

The card mandates "catalog schema validates FTD's actual catalog." Concretely
(`src/iap/catalog.test.ts`):

- A fixture `ftdCatalog` reproduces FTD's **13 products** exactly (from `buildFullShopCatalog`,
  ProductCatalog.ts:46–102): `no-ads`, `no-ads-premium`, `hint-pack-{10,25,50}`,
  `coin-pack-{1000,5000,10000,25000,50000,100000}`, `ego-offer-level-continue-5-hints`.
  FTD's `kind`→SDK `kind` mapping: `noAds`/`noAdsPremium`→`entitlement`;
  `hintPack`/`coinPack`/`egoOffer`→`consumable`. `payload` carries FTD's
  `{hints,coins,noAds,continueLevel}` per product.
- Assert every fixture product satisfies the schema (typechecks + a runtime `validateCatalog`
  that rejects missing `productId`, negative `tier`, empty `id`).
- Assert `assertUniqueCatalogProductIds(ftdCatalog.products)` does **not** throw (FTD's real
  product ids are unique) — and that a deliberately-duplicated fixture DOES throw.
- Assert `visibleProducts` filters on `visible` (13 products, one flipped `visible:false` → 12).

This fixture is the regression anchor: if the schema can't represent FTD's real store, the
generalization failed.

---

## Part 2 — IapService: the provider seam

FTD's `IapService` (617 lines) is **already** decoupled from RevenueCat at the type level —
`RevenueCatPurchasesPort` (IapService.ts:97–100) is a `Pick<PurchasesPlugin, ...>` of exactly
7 methods, and `IapServiceDependencies` (65–74) injects platform/keys/catalog/timeouts. The
one thing it does *badly* for reuse: the **test double is threaded through the class** as
~10 `*ForTest` fields (`purchaseResultsByProductIdForTest`, `pendingRestoreForTest`,
`restoreResultForTest`, …) mutated by `setStateForTest` (288–304) and branched on inside
`purchase()`/`restore()`. That's ~80 lines of test-only code living in the production class.

### The re-seam (worked stage)

Promote the port to a first-class **provider interface** and move the test behavior OUT of
the class into a real fake that implements the same interface:

```ts
export interface PurchaseProvider {
  configure(opts: { apiKey: string }): Promise<void>;
  getProducts(...): Promise<StoreProduct[]>;
  getOfferings(): Promise<...>;
  purchaseStoreProduct(...): Promise<PurchaseTransaction>;
  restorePurchases(): Promise<CustomerInfoLike>;
  addCustomerInfoUpdateListener(cb): Promise<...>;
  removeCustomerInfoUpdateListener(...): Promise<void>;
}

export class RevenueCatProvider implements PurchaseProvider { /* IapService.ts:136–148 body */ }
export class FakePurchaseProvider implements PurchaseProvider { /* scriptable: seed products,
    per-productId purchase results + delays, pending/hang, restore result, late-settle */ }
```

`IapService` keeps its state machine (`idle | unsupported-platform | missing-api-key |
initializing | ready | load-failed | purchase-failed | restore-failed`, IapService.ts:12–20)
and its genuinely-hard logic **verbatim** — that logic is the value and is correct:

- **purchase()** single-flight guard (`activePurchaseProductId !== null || restoreInProgress`
  → `unavailable`, lines 328–337); user-cancel classification (`isUserCancelled`, 154–159);
  timeout wrap (`withTimeout(..., purchaseTimeoutMs)`).
- **restore()** the load-bearing late-settle machine (415–473): the native
  `restorePurchases` promise is bounded by `RESTORE_SETTLE_TIMEOUT_MS` **separately** from the
  user-facing `operationTimeoutMs`, so a hung native bridge still clears `restoreInProgress`
  (otherwise every Buy button is permanently disabled — comment 91–96). `completedRestoreResult`
  + `consumeCompletedRestoreResult` capture a result that lands *after* the user-facing timeout.
  **This is subtle and battle-tested — carry it exactly; do not "simplify" it.**
- **customerInfo listener** (registerCustomerInfoListener, 492–508) for deferred non-consumable
  entitlements (Ask-to-Buy no-ads approved later). Carries; the handler is injected (already is).
- **sandbox/test-store alias path** (loadStoreProducts 557–592, `isRevenueCatTestStoreKey`,
  `testStoreAliasProductForCatalogProduct` 611–617): this IS the sandbox-mode seam the decisions
  doc mandates. Carries as-is; exercised by the fake provider with a `test_`-prefixed key.

**Net:** the class shrinks (test fields leave), the hard concurrency/timeout logic is untouched,
and testing is via a real `FakePurchaseProvider` injected through `dependencies.purchases` —
which FTD's DI already supports (line 71). `setStateForTest` and the `*ForTest` fields do NOT
carry.

### AC: purchase state machine tests (`src/iap/service.test.ts`)

- Not `ready` → `purchase()` returns `unavailable` (state gate, 324–326).
- Concurrent purchase / purchase-during-restore → second call `unavailable`
  ("native store operation already in progress", 328–337). **Single-flight guard.**
- Fake provider returns a transaction → `status:'purchased'` with `purchaseId`/`purchaseToken`
  threaded (365–373).
- Provider throws user-cancel → `status:'cancelled'`; provider throws other → `status:'failed'`
  + `lastErrorMessage` set (374–384).
- `activePurchaseProductId` cleared in `finally` even on throw (385–388) — a failed purchase
  does not wedge the service.

---

## Part 3 — Fulfillment: fulfill-once + the unfulfilled-retry

FTD's `PurchaseFulfillment.ts` is the money-path safety layer. Two mechanics the card names
explicitly (`fulfillVerifiedPurchaseOnce` + `reportUnfulfilledPurchase` retry — research `07`
R48 purchase flow), both carry with the grant type generalized.

### Generalize the grant, keep the ledger

FTD's `PurchaseGrant = { noAds, hints, coins, continueLevel }` (game-specific) → opaque
`TGrant`. The SDK never constructs a grant; the game supplies `grantForCatalogProduct(product):
TGrant` (FTD's version, 96–110) and a **wallet port**:

```ts
export interface FulfillmentWallet<TGrant> {
  applyPurchaseGrantOnce(purchaseId: string, grant: TGrant, source: 'iap'): TGrant | null;
  // returns null when purchaseId already applied → SDK maps to status:'duplicate'
}
```

`fulfillVerifiedPurchaseOnce` (121–152) carries verbatim except `grant` is `TGrant`:

- `purchaseLedgerId` (91–94): `purchaseToken ?? purchaseId` — the dedup key. **Carry the comment**
  (234–248): iOS transaction ids ≠ customerInfo ids, so verification is at PRODUCT level and
  dedup lives in the wallet ledger, not here. This was a real paid-never-granted bug (build 5,
  2026-06-11); the doc comment is load-bearing.
- Verification: `customerInfoIncludesPurchase` (product-level) + `...TestStoreAliasPurchase`
  (sandbox `test_` path) — both carry.
- Status ladder: `unverified-purchase | unknown-product | ambiguous-product | duplicate |
  fulfilled` (12–17) carries as-is; `PurchaseUnfulfilledOutcome` derived type (24) carries.

`reportUnfulfilledPurchase` (165–211) carries: emit `purchase:unfulfilled` to an injected
`AnalyticsSink` port (40–46) **only if still not delivered after** one restore-retry; the
retry (`makePurchaseRestoreRetry`, 61–78) re-runs fulfillment against a *fresh* customerInfo
from `restore()`, and the wallet ledger makes a double-grant impossible even if the original
call later resolves. Analytics sink + wallet are injected ports (already are) — no Firebase
dependency crosses into the SDK.

`restoreNonConsumableEntitlements` (213–232) carries: aggregates entitlement grants across
owned product ids, skipping ambiguous (duplicate-productId) products; calls
`wallet.grantNoAdsEntitlement()` — generalize to `wallet.grantEntitlement(product)` or fold
into the same opaque-grant wallet. This is where "entitlement vs consumable" earns its keep:
**only `kind:'entitlement'` products are restore-recoverable**; consumables return `null` from
`restoreGrantForCatalogProduct` (112–119) so restore never double-grants hints/coins.

### AC: fulfill-once idempotency (`src/iap/fulfillment.test.ts`)

- Fulfill a verified purchase → `status:'fulfilled'`, grant returned, wallet ledger records
  `purchaseId`.
- Fulfill the **same** `purchaseId` again → wallet returns `null` → `status:'duplicate'`,
  grant `null`. **Idempotency proven.** (Uses a fake wallet with a `Set<purchaseId>` ledger.)
- Unverified (customerInfo doesn't include product) → `status:'unverified-purchase'`;
  `reportUnfulfilledPurchase` fires ONE retry; retry with fresh customerInfo → `fulfilled`;
  assert analytics sink NOT called on recovery (the ordering fix, comment 195–208).
- Unknown / ambiguous product ids → respective statuses; consumable through
  `restoreNonConsumableEntitlements` → not granted (no double-grant).

---

## Part 4 — Restore state machine: CONTRACT ONLY (research 07 R28–R43)

The card is explicit: extract the machine as a **contract**; "the UI control is a ui-package
card later, must consume this via interface." FTD's machine lives inside `HUD.ts` (964–1147)
tangled with DOM (`#shop-restore-btn`, `dataset.restoreState`), `showToast`, `updateHUD`,
`adService.hideBanner`. The extractable core is **pure**: transitions over an `IapSnapshot`-like
value.

### States (carry verbatim — research 07 verified this exact set)

```ts
export type RestoreState =
  | 'idle' | 'initializing' | 'busy' | 'unavailable'
  | 'pending' | 'restored' | 'empty' | 'failed';
```

### Pure transitions to extract (no DOM, no globals)

- `restoreStateForSnapshot(snapshot, current, hasActiveRestore): RestoreState` — from FTD's
  `restoreUiStateForIapSnapshot` (986–993): `activeRestore → pending`; sticky terminal
  (`restored`/`empty`/`failed` stay); `nativeOperationInProgress → busy`; `ready → idle`;
  `idle`/`initializing → initializing`; else `unavailable`.
- `restoreResultToState(restore: RestoreResult, snapshot): RestoreState` — from FTD's
  `applyRestoreResult` (1127–1147) **minus its side effects**: `unavailable`/non-`restored`
  branch → `busy|unavailable|failed` by `nativeOperationInProgress`; `restored` →
  `restoreNonConsumableEntitlements(...)` → `grant.noAds ? 'restored' : 'empty'`. The
  toast/HUD/hideBanner side effects are **caller callbacks**, not SDK code.
- `canStartRestore(snapshot, current)` — from FTD's guards in `restorePurchasesFromShop`
  (1103–1104): reject when `nativeOperationInProgress` or state ∈
  `{pending,restored,initializing,busy,unavailable}`.
- **Status-text is a CONTRACT, not code:** the SDK exports the `RestoreState` union and a
  documented state→meaning table; the ui-package supplies the copy (`restoreStatusText`,
  1032–1041, does NOT carry — it hardcodes English). The interface the later ui-card consumes:
  `{ state: RestoreState; canRestore: boolean; startRestore(): Promise<RestoreState> }`.

The late-result poll (`scheduleLateRestoreResultPoll`, 250ms — research `07` notes this is the
4× duplicated poll idiom) is a *timer/DOM* concern → stays in the ui-package; the SDK exposes
`consumeCompletedRestoreResult()` (already on IapService) so the UI can poll. **The SDK ships
the state algebra; the UI ships the clock and the pixels.**

### R37 — the dismissed-mid-purchase guard (`shouldResume`)

The card names "dismissed-mid-purchase guard (R37 `shouldResume`)". Source:
GameScene.ts:2044–2078 (`continueWithEgoOffer`) + LevelFailedOverlay.ts:80–100. The pattern:
a purchase can complete **after the user dismissed the overlay** (or a recovery timer moved it
to background-pending). The guard `shouldResume()` (LevelFailedOverlay.ts:92–94:
`el.isConnected && (pendingKind === kind || (backgroundPendingKind === kind &&
!backgroundPendingSuperseded))`) decides whether to auto-resume the level or just bank the
grant.

**SDK responsibility = the invariant, not the DOM check:** fulfillment MUST run and the grant
MUST be applied *regardless* of whether the UI is still present (money was taken). Whether to
*act on* the grant (resume the level) is the caller's call via an injected
`shouldResume: () => boolean` predicate — same injected-predicate shape as haptics `isEnabled`.
So the SDK's purchase-then-fulfill helper takes `shouldResume` and returns
`{ fulfilled, grant, resumed }`; `el.isConnected`/`backgroundPendingKind` never enter the SDK.

### AC: restore + guard tests (`src/iap/restore-machine.test.ts`)

- Snapshot table-drive: each `IapServiceState` + `nativeOperationInProgress`/`activeRestore`
  combination → expected `RestoreState` (mirrors FTD's branches; ~10 cases).
- Sticky terminals: once `restored`/`empty`/`failed`, a subsequent `ready` snapshot does NOT
  revert to `idle` (986–987).
- `restoreResultToState`: `restored` + owned no-ads → `restored`; `restored` + none →
  `empty`; `failed` result while `restoreInProgress` → `busy` (late-settle path).
- `canStartRestore` rejects in each guarded state.
- **Dismissed-mid-purchase (R37):** purchase completes with `shouldResume: () => false`
  (overlay gone) → assert grant STILL applied (`fulfilled:true`, wallet ledger has it) but
  `resumed:false`; with `shouldResume: () => true` → `resumed:true`. **The money-safety
  invariant: fulfillment is independent of UI presence.**

---

## Prior-art ledger — take / adapt / reject (summary)

| Source (READ-ONLY) | Verdict |
|---|---|
| `ProductCatalog.ts` schema (`ShopCatalogProduct`) | **ADAPT** — split universal fields from FTD grant payload; grant fields → opaque `payload` |
| `ProductCatalog.ts` validators (`duplicate*`/`assertUnique*`) | **TAKE AS-IS** — already game-agnostic |
| `ProductCatalog.ts` `buildFullShopCatalog` product list | **REJECT as code / TAKE as fixture** — FTD's remote-config-bound builder stays in FTD; its 13 products become `catalog.test.ts` fixture |
| `IapService.ts` state machine + purchase/restore/late-settle logic | **TAKE (carry verbatim)** — correct, battle-tested; do not simplify the late-settle |
| `IapService.ts` `RevenueCatPurchasesPort` | **PROMOTE** to first-class `PurchaseProvider` interface (RevenueCat impl + Fake) |
| `IapService.ts` `*ForTest` fields + `setStateForTest` | **REJECT** — replaced by real `FakePurchaseProvider` implementing the port |
| `IapService.ts` sandbox/test-store alias path | **TAKE** — this is the mandated sandbox seam |
| `PurchaseFulfillment.ts` fulfill-once + retry + wallet/analytics ports | **TAKE** — generalize `PurchaseGrant`→`TGrant`; ports already injected |
| `HUD.ts` restore machine (R28–R43) | **EXTRACT pure transitions** — DOM/toast/timer stay in ui-package |
| `HUD.ts` `restoreStatusText` copy | **REJECT** — copy is injected by ui-package (guardrail #2 corollary) |
| `GameScene.ts`/`LevelFailedOverlay.ts` `shouldResume` guard (R37) | **ADAPT** — inject `shouldResume: () => boolean`; SDK guarantees fulfill-regardless-of-UI |

## Surprises / open questions for the worked stage

1. **`mixed` purchaseType collapses cleanly.** FTD's `noAdsPremium` and `egoOffer` are
   `purchaseType:'mixed'` (non-consumable entitlement + consumable payload). In the SDK, `kind`
   describes the *restore behavior* (entitlement = recoverable), and the mixed grant lives in
   the opaque `payload` — no third kind needed. `restoreNonConsumableEntitlements` already
   restores only the no-ads half and never the hints (PurchaseFulfillment.ts:112–119), which is
   exactly the "restore must not duplicate hints" rule (ProductCatalog.ts:74). Confirm this
   mapping holds in the fixture.
2. **RevenueCat type imports.** FTD imports `CustomerInfo`, `PurchasesStoreProduct`, etc. from
   `@revenuecat/purchases-capacitor` (+ `PRODUCT_CATEGORY`/`PRODUCT_TYPE` from an internal-esm
   subpath). The worked stage must decide: make `@revenuecat/purchases-capacitor` an **optional
   peer dep** (like `@capacitor/*` for haptics) and define minimal local `CustomerInfoLike` /
   `StoreProductLike` structural types so unit tests + typecheck run WITHOUT the native package
   installed. Lean local-structural-types (the fake provider needs no real RC types); confirm
   the sdk's tsconfig/vitest can typecheck without the RC dependency present.
3. **`tier`/`badges` have no FTD source** — they're card-requested net-new. Kept minimal
   (sort key + opaque keys). If the worked stage finds the ui-package card needs richer badge
   semantics, that's a follow-up; do not over-design here.
4. **This is `packages/sdk` — no native shell.** Per the sdk README, native-backed SDKs need a
   native shell to verify end-to-end. The unit-testable slice is the state machines + fulfillment
   + catalog validation via the fake provider (no live RevenueCat). Full purchase/restore against
   a real sandbox store is a `Tested inSitu` / device concern, not this card.
