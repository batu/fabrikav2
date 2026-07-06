/**
 * Fulfillment — the money-path safety layer, generalized from v1
 * `games/find_the_dog/src/shop/PurchaseFulfillment.ts` (267 lines, READ-ONLY).
 *
 * v1's `PurchaseGrant = { noAds, hints, coins, continueLevel }` was FTD-specific,
 * so its fulfillment couldn't be reused. Here the grant is an opaque `TGrant`: the
 * SDK never constructs or inspects a grant. The game injects two mappers
 * (`grantForProduct`, `restoreGrantForProduct`) and a wallet port; the SDK owns
 * the fulfill-ONCE ledger dedup, the product-level verification, and the
 * unfulfilled-retry mechanics — all carried verbatim, only the grant type widened.
 *
 * The ledger-dedup comment (below, in `fulfillVerifiedPurchaseOnce`) is
 * load-bearing: it documents a real paid-never-granted bug fixed in v1 and why
 * dedup lives in the wallet ledger rather than on transaction-id equality.
 */
import { duplicateCatalogProductIds, type CatalogProduct } from './catalog.ts';
import type { CustomerInfoLike, IapPurchaseResult, IapRestoreResult } from './service.ts';

export type PurchaseFulfillmentStatus =
  | 'fulfilled'
  | 'duplicate'
  | 'unknown-product'
  | 'ambiguous-product'
  | 'unverified-purchase';

/**
 * Outcomes that may reach the `purchaseUnfulfilled` sink. Excludes 'fulfilled'
 * (delivered) and 'duplicate' (expected; never reported). Derived from the
 * canonical status so the sink params can't drift and adding a status forces a
 * conscious decision here.
 */
export type PurchaseUnfulfilledOutcome = Exclude<PurchaseFulfillmentStatus, 'fulfilled' | 'duplicate'>;

export interface PurchaseFulfillmentResult<TGrant> {
  status: PurchaseFulfillmentStatus;
  productId: string;
  purchaseId: string;
  grant: TGrant | null;
}

/** Maps a catalog product to the grant a purchase of it confers. Injected by the
 *  game — the SDK never reads `payload` itself. */
export type GrantForProduct<TGrant, TPayload> = (product: CatalogProduct<TPayload>) => TGrant;

/**
 * Maps a catalog product to the grant a RESTORE of it confers, or null when the
 * product is not restore-recoverable. This is where "entitlement vs consumable"
 * earns its keep: return null for consumables so restore never double-grants
 * (v1: No-Ads Premium restores only its No-Ads half, never its hints).
 */
export type RestoreGrantForProduct<TGrant, TPayload> = (product: CatalogProduct<TPayload>) => TGrant | null;

/**
 * The fulfill-once ledger. `applyPurchaseGrantOnce` returns the grant on first
 * apply and null when `purchaseId` was already applied — that null is what the SDK
 * maps to `status:'duplicate'`. Dedup lives here, in the game's persistent wallet,
 * NOT on transaction-id equality (see `fulfillVerifiedPurchaseOnce`).
 */
export interface FulfillmentWallet<TGrant> {
  applyPurchaseGrantOnce(purchaseId: string, grant: TGrant, source: 'iap'): TGrant | null;
}

/** Wallet for the restore path — applies a recovered entitlement grant. */
export interface RestoreEntitlementWallet<TGrant> {
  grantRestoredEntitlement(grant: TGrant): void;
}

/** Narrow analytics port so fulfillment stays decoupled from any concrete
 *  (e.g. Firebase-backed) analytics service. */
export interface PurchaseAnalyticsSink {
  purchaseUnfulfilled(p: {
    product_id: string;
    purchase_id: string;
    outcome: PurchaseUnfulfilledOutcome;
  }): void;
}

/** Restore-retry hook. Returns null if the retry could not produce a fulfillment. */
export type PurchaseRestoreRetry<TGrant> = () => Promise<PurchaseFulfillmentResult<TGrant> | null>;

/**
 * The dedup ledger key: prefer the Play `purchaseToken`, fall back to the
 * transaction id. Null for a non-purchased result.
 */
export function purchaseLedgerId(result: IapPurchaseResult): string | null {
  if (result.status !== 'purchased') return null;
  return result.purchaseToken ?? result.purchaseId;
}

export function fulfillVerifiedPurchaseOnce<TGrant, TPayload>(
  result: IapPurchaseResult,
  products: readonly CatalogProduct<TPayload>[],
  wallet: FulfillmentWallet<TGrant>,
  grantForProduct: GrantForProduct<TGrant, TPayload>,
): PurchaseFulfillmentResult<TGrant> {
  const purchaseId = purchaseLedgerId(result);
  const productId = result.productId;
  if (purchaseId === null || result.customerInfo === null) {
    return { status: 'unverified-purchase', productId, purchaseId: purchaseId ?? '', grant: null };
  }
  if (
    !customerInfoIncludesPurchase(result.customerInfo, result.storeProductId ?? productId)
    && !customerInfoIncludesTestStoreAliasPurchase(result.customerInfo, result)
  ) {
    return { status: 'unverified-purchase', productId, purchaseId, grant: null };
  }

  const matchingProducts = products.filter((candidate) => candidate.productId === productId);
  if (matchingProducts.length === 0) {
    return { status: 'unknown-product', productId, purchaseId, grant: null };
  }
  if (matchingProducts.length > 1) {
    return { status: 'ambiguous-product', productId, purchaseId, grant: null };
  }

  const grant = wallet.applyPurchaseGrantOnce(purchaseId, grantForProduct(matchingProducts[0]), 'iap');
  if (grant === null) {
    return { status: 'duplicate', productId, purchaseId, grant: null };
  }

  return { status: 'fulfilled', productId, purchaseId, grant };
}

/**
 * Build the standard restore-retry closure for a paid purchase: call restore(),
 * and if it returns a fresh customerInfo, re-run fulfillment against THAT (not the
 * stale purchase.customerInfo that already failed verification). `restore` is
 * injected (not the whole IapService) so this module stays decoupled from the
 * service at runtime — only the `IapRestoreResult` TYPE is imported.
 */
export function makePurchaseRestoreRetry<TGrant, TPayload>(
  purchase: IapPurchaseResult,
  deps: {
    restore: () => Promise<IapRestoreResult>;
    products: () => readonly CatalogProduct<TPayload>[];
    wallet: FulfillmentWallet<TGrant>;
    grantForProduct: GrantForProduct<TGrant, TPayload>;
  },
): PurchaseRestoreRetry<TGrant> {
  return async (): Promise<PurchaseFulfillmentResult<TGrant> | null> => {
    const restore = await deps.restore();
    if (restore.status !== 'restored' || restore.customerInfo === null) return null;
    return fulfillVerifiedPurchaseOnce(
      { ...purchase, customerInfo: restore.customerInfo },
      deps.products(),
      deps.wallet,
      deps.grantForProduct,
    );
  };
}

/**
 * Handle a non-fulfilled outcome: attempt one restore retry for an
 * `unverified-purchase`, then emit a `purchaseUnfulfilled` analytics event ONLY if
 * the purchase is still not delivered. Order matters: firing before the retry (the
 * old v1 order) cried wolf on the unfulfilled channel ops relies on. A 'duplicate'
 * is expected and never reported. Returns the resolved result.
 */
export async function reportUnfulfilledPurchase<TGrant>(
  fulfillment: PurchaseFulfillmentResult<TGrant>,
  analyticsSink: PurchaseAnalyticsSink,
  retry?: PurchaseRestoreRetry<TGrant>,
): Promise<PurchaseFulfillmentResult<TGrant>> {
  if (
    fulfillment.status === 'fulfilled'
    || fulfillment.status === 'duplicate'
    || fulfillment.grant !== null
  ) {
    return fulfillment;
  }

  let resolved: PurchaseFulfillmentResult<TGrant> = fulfillment;
  if (fulfillment.status === 'unverified-purchase' && retry !== undefined) {
    try {
      const retried = await retry();
      if (retried !== null) resolved = retried;
    } catch (err: unknown) {
      console.warn('[iap] restore-retry failed during unfulfilled-purchase handling', err);
    }
  }

  if (resolved.status !== 'fulfilled' && resolved.status !== 'duplicate') {
    analyticsSink.purchaseUnfulfilled({
      product_id: resolved.productId,
      purchase_id: resolved.purchaseId,
      outcome: resolved.status,
    });
  }

  return resolved;
}

/**
 * Restore recovers only restore-recoverable entitlements. Iterates owned products,
 * skipping consumables (via `restoreGrantForProduct` returning null) and ambiguous
 * (duplicate-productId) products, and applies each recovered grant to the wallet.
 * Returns whether ANY entitlement was granted — the restore state machine maps
 * that boolean to `restored` vs `empty`.
 */
export function restoreEntitlements<TGrant, TPayload>(
  ownedProductIds: readonly string[],
  products: readonly CatalogProduct<TPayload>[],
  wallet: RestoreEntitlementWallet<TGrant>,
  restoreGrantForProduct: RestoreGrantForProduct<TGrant, TPayload>,
): { granted: boolean } {
  const owned = new Set(ownedProductIds);
  const ambiguous = new Set(duplicateCatalogProductIds(products));
  let granted = false;

  for (const product of products) {
    if (!owned.has(product.productId)) continue;
    if (ambiguous.has(product.productId)) continue;
    if (product.kind !== 'entitlement') continue;
    const grant = restoreGrantForProduct(product);
    if (grant === null) continue;
    wallet.grantRestoredEntitlement(grant);
    granted = true;
  }

  return { granted };
}

/**
 * Purchase-then-fulfill with the R37 dismissed-mid-purchase guard.
 *
 * The money-safety invariant: a purchase can complete AFTER the user dismissed the
 * overlay (money was already taken), so fulfillment MUST run and the grant MUST be
 * applied regardless of whether the UI is still present. Whether to *act on* the
 * grant (e.g. resume the level) is the caller's decision, expressed through the
 * injected `shouldResume` predicate — `el.isConnected` / DOM state never enters the
 * SDK. `resumed` is true only when the purchase was freshly fulfilled AND the
 * caller still wants to resume.
 */
export async function fulfillPurchaseWithResume<TGrant, TPayload>(
  purchase: IapPurchaseResult,
  deps: {
    products: readonly CatalogProduct<TPayload>[];
    wallet: FulfillmentWallet<TGrant>;
    grantForProduct: GrantForProduct<TGrant, TPayload>;
    analyticsSink: PurchaseAnalyticsSink;
    retry?: PurchaseRestoreRetry<TGrant>;
    shouldResume: () => boolean;
  },
): Promise<{ fulfillment: PurchaseFulfillmentResult<TGrant>; resumed: boolean }> {
  const initial = fulfillVerifiedPurchaseOnce(purchase, deps.products, deps.wallet, deps.grantForProduct);
  const fulfillment = await reportUnfulfilledPurchase(initial, deps.analyticsSink, deps.retry);
  const resumed = fulfillment.status === 'fulfilled' && deps.shouldResume();
  return { fulfillment, resumed };
}

function customerInfoIncludesPurchase(customerInfo: CustomerInfoLike, productId: string): boolean {
  // Verify at PRODUCT level only. Transaction-id equality is impossible on iOS:
  // the purchase result carries the StoreKit transaction id (e.g.
  // '2000001186651627') while customerInfo.nonSubscriptionTransactions carries
  // RevenueCat's internal ids, and purchaseToken is Android-only — so an id-based
  // check rejects every real App Store purchase (paid, never granted; found
  // on-device in v1, 2026-06-11). Double-grant safety does not live here:
  // applyPurchaseGrantOnce dedupes on the per-transaction ledger id.
  return customerInfo.nonSubscriptionTransactions.some(
    (transaction) => transaction.productIdentifier === productId,
  );
}

function customerInfoIncludesTestStoreAliasPurchase(
  customerInfo: CustomerInfoLike,
  result: IapPurchaseResult,
): boolean {
  if (result.storeProductId === undefined || result.storeProductId === result.productId) return false;
  if (result.purchaseToken === null || !result.purchaseToken.startsWith('test_')) return false;
  return customerInfo.allPurchasedProductIdentifiers.includes(result.storeProductId);
}
