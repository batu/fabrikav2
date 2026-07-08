import type { CustomerInfo } from './IapService';
import type { IapPurchaseResult, IapRestoreResult } from './IapService';
import { duplicateCatalogProductIds, type ShopCatalogProduct } from './ProductCatalog';

export interface PurchaseGrant {
  noAds: boolean;
  hints: number;
  coins: number;
  continueLevel: boolean;
}

export type PurchaseFulfillmentStatus =
  | 'fulfilled'
  | 'duplicate'
  | 'unknown-product'
  | 'ambiguous-product'
  | 'unverified-purchase';

/** Outcomes that may reach the `purchase:unfulfilled` sink. Excludes 'fulfilled'
 * (delivered) and 'duplicate' (expected; never reported — see
 * reportUnfulfilledPurchase's early-return). Derived from the canonical
 * PurchaseFulfillmentStatus so the sink and the analytics params can't drift
 * from it, and so adding a status forces a conscious decision here. */
export type PurchaseUnfulfilledOutcome = Exclude<PurchaseFulfillmentStatus, 'fulfilled' | 'duplicate'>;

export interface PurchaseFulfillmentResult {
  status: PurchaseFulfillmentStatus;
  productId: string;
  purchaseId: string;
  grant: PurchaseGrant | null;
}

export interface PurchaseFulfillmentWallet {
  applyPurchaseGrantOnce(purchaseId: string, grant: PurchaseGrant, source: 'iap'): PurchaseGrant | null;
}

/** Narrow port so PurchaseFulfillment stays decoupled from the concrete
 * Firebase-backed AnalyticsService. Mirrors the PurchaseFulfillmentWallet
 * pattern. */
export interface PurchaseAnalyticsSink {
  purchaseUnfulfilled(p: {
    product_id: string;
    purchase_id: string;
    outcome: PurchaseUnfulfilledOutcome;
  }): void;
}

/** Restore retry hook. The caller closes over the purchase and binds this to
 * iapService.restore() + re-fulfillment, so this module does not depend on
 * IapService. Returns null if the retry could not produce a fulfillment. */
export type PurchaseRestoreRetry = () => Promise<PurchaseFulfillmentResult | null>;

/** Build the standard restore-retry closure for a paid purchase: call restore(),
 * and if it returns a fresh customerInfo, re-run fulfillment against THAT
 * (not the stale purchase.customerInfo that already failed verification).
 * `restore` is injected (not the whole IapService) so this module stays
 * decoupled from IapService at runtime — only the IapRestoreResult TYPE is
 * imported (type-only, no cycle). Used by both the HUD shop-purchase path and
 * the GameScene ego-offer continue path so the two can't silently diverge on
 * money-path recovery logic. */
export function makePurchaseRestoreRetry(
  purchase: IapPurchaseResult,
  deps: {
    restore: () => Promise<IapRestoreResult>;
    products: () => readonly ShopCatalogProduct[];
    wallet: PurchaseFulfillmentWallet;
  },
): PurchaseRestoreRetry {
  return async (): Promise<PurchaseFulfillmentResult | null> => {
    const restore = await deps.restore();
    if (restore.status !== 'restored' || restore.customerInfo === null) return null;
    return fulfillVerifiedPurchaseOnce(
      { ...purchase, customerInfo: restore.customerInfo },
      deps.products(),
      deps.wallet,
    );
  };
}

export interface RestoreEntitlementWallet {
  grantNoAdsEntitlement(): void;
}

export const EMPTY_PURCHASE_GRANT: PurchaseGrant = {
  noAds: false,
  hints: 0,
  coins: 0,
  continueLevel: false,
};

export function purchaseLedgerId(result: IapPurchaseResult): string | null {
  if (result.status !== 'purchased') return null;
  return result.purchaseToken ?? result.purchaseId;
}

export function grantForCatalogProduct(product: ShopCatalogProduct): PurchaseGrant {
  if (product.kind === 'noAds') {
    return { ...EMPTY_PURCHASE_GRANT, noAds: true };
  }
  if (product.kind === 'noAdsPremium') {
    return { ...EMPTY_PURCHASE_GRANT, noAds: true, hints: product.hintAmount };
  }
  if (product.kind === 'hintPack') {
    return { ...EMPTY_PURCHASE_GRANT, hints: product.hintAmount };
  }
  if (product.kind === 'coinPack') {
    return { ...EMPTY_PURCHASE_GRANT, coins: product.coinAmount };
  }
  return { ...EMPTY_PURCHASE_GRANT, hints: product.hintAmount, coins: product.coinAmount, continueLevel: true };
}

export function restoreGrantForCatalogProduct(product: ShopCatalogProduct): PurchaseGrant | null {
  if (product.kind === 'noAds' || product.kind === 'noAdsPremium') {
    // No-Ads Premium has a non-consumable No-Ads component plus consumable
    // hints. Restore recovers only No-Ads; it must not duplicate hints.
    return { ...EMPTY_PURCHASE_GRANT, noAds: true };
  }
  return null;
}

export function fulfillVerifiedPurchaseOnce(
  result: IapPurchaseResult,
  products: readonly ShopCatalogProduct[],
  wallet: PurchaseFulfillmentWallet,
): PurchaseFulfillmentResult {
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

  const grant = wallet.applyPurchaseGrantOnce(purchaseId, grantForCatalogProduct(matchingProducts[0]), 'iap');
  if (grant === null) {
    return { status: 'duplicate', productId, purchaseId, grant: null };
  }

  return { status: 'fulfilled', productId, purchaseId, grant };
}

/** Handle a non-fulfilled purchase outcome: emit a `purchase:unfulfilled`
 * analytics event so paid-but-not-delivered purchases are visible to ops
 * (they would otherwise be silent — no grant, no event, no recovery), and
 * for `unverified-purchase` with non-null customerInfo attempt one restore
 * retry before giving up. Returns the original result, or the result from
 * a successful restore retry if one landed. A `duplicate` is expected and
 * not reported as unfulfilled.
 *
 * Critical: consumables (hint/coin packs) that land here have NO client
 * recovery path until PR-6 ships — restore intentionally excludes them —
 * so this telemetry is the only signal support gets for those today. */
export async function reportUnfulfilledPurchase(
  fulfillment: PurchaseFulfillmentResult,
  analyticsSink: PurchaseAnalyticsSink,
  retry?: PurchaseRestoreRetry,
): Promise<PurchaseFulfillmentResult> {
  if (
    fulfillment.status === 'fulfilled'
    || fulfillment.status === 'duplicate'
    || fulfillment.grant !== null
  ) {
    return fulfillment;
  }

  // A transient null customerInfo, or a product mis-categorized in RevenueCat
  // (subscription vs non-subscription), can put a genuinely paid purchase here.
  // One restore fetches a fresh customerInfo and re-runs fulfillment; the
  // wallet ledger makes a double-grant impossible even if the original call
  // later resolves too.
  let resolved: PurchaseFulfillmentResult = fulfillment;
  if (fulfillment.status === 'unverified-purchase' && retry !== undefined) {
    try {
      const retried = await retry();
      if (retried !== null) resolved = retried;
    } catch (err: unknown) {
      // Restore is best-effort, but log so a restore failure on a real-money
      // path is observable — mirrors the sibling catches in IapService.
      console.warn('[iap] restore-retry failed during unfulfilled-purchase handling', err);
    }
  }

  // Emit the analytics event AFTER the retry attempt and ONLY if the purchase
  // is still not delivered. Firing before the retry (the old order) produced a
  // `purchase:unfulfilled` event whose 'unverified-purchase' outcome was
  // indistinguishable from a still-broken purchase even when the retry
  // recovered it — and it co-fired with the caller's `purchase:fulfilled`,
  // crying wolf on the unfulfilled channel ops relies on. A 'duplicate' is
  // expected (the wallet already has it) and is not reported either.
  if (resolved.status !== 'fulfilled' && resolved.status !== 'duplicate') {
    analyticsSink.purchaseUnfulfilled({
      product_id: resolved.productId,
      purchase_id: resolved.purchaseId,
      outcome: resolved.status,
    });
  }

  return resolved;
}

export function restoreNonConsumableEntitlements(
  ownedProductIds: readonly string[],
  products: readonly ShopCatalogProduct[],
  wallet: RestoreEntitlementWallet,
): PurchaseGrant {
  const owned = new Set(ownedProductIds);
  const ambiguous = new Set(duplicateCatalogProductIds(products));
  let aggregate: PurchaseGrant = { ...EMPTY_PURCHASE_GRANT };

  for (const product of products) {
    if (!owned.has(product.productId)) continue;
    if (ambiguous.has(product.productId)) continue;
    const grant = restoreGrantForCatalogProduct(product);
    if (grant === null) continue;
    aggregate = mergeGrants(aggregate, grant);
  }

  if (aggregate.noAds) wallet.grantNoAdsEntitlement();
  return aggregate;
}

function customerInfoIncludesPurchase(
  customerInfo: CustomerInfo,
  productId: string,
): boolean {
  // Verify at PRODUCT level only. Transaction-id equality is impossible on
  // iOS: the purchase result carries the StoreKit transaction id (e.g.
  // '2000001186651627') while customerInfo.nonSubscriptionTransactions
  // carries RevenueCat's internal ids, and purchaseToken is Android-only —
  // so an id-based check rejects every real App Store purchase (paid, never
  // granted; found on-device 2026-06-11, build 5). Double-grant safety does
  // not live here: applyPurchaseGrantOnce dedupes on the per-transaction
  // ledger id from purchaseLedgerId().
  return customerInfo.nonSubscriptionTransactions.some(
    (transaction) => transaction.productIdentifier === productId,
  );
}

function customerInfoIncludesTestStoreAliasPurchase(
  customerInfo: CustomerInfo,
  result: IapPurchaseResult,
): boolean {
  if (result.storeProductId === undefined || result.storeProductId === result.productId) return false;
  if (result.purchaseToken === null || !result.purchaseToken.startsWith('test_')) return false;
  return customerInfo.allPurchasedProductIdentifiers.includes(result.storeProductId);
}

function mergeGrants(left: PurchaseGrant, right: PurchaseGrant): PurchaseGrant {
  return {
    noAds: left.noAds || right.noAds,
    hints: left.hints + right.hints,
    coins: left.coins + right.coins,
    continueLevel: left.continueLevel || right.continueLevel,
  };
}
