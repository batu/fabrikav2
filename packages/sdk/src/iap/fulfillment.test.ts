import { describe, expect, it } from 'vitest';
import {
  fulfillPurchaseWithResume,
  fulfillVerifiedPurchaseOnce,
  makePurchaseRestoreRetry,
  reportUnfulfilledPurchase,
  restoreEntitlements,
  type FulfillmentWallet,
  type PurchaseAnalyticsSink,
  type PurchaseUnfulfilledOutcome,
  type RestoreEntitlementWallet,
} from './fulfillment.ts';
import type { CustomerInfoLike, IapPurchaseResult, IapRestoreResult } from './service.ts';
import {
  ftdCatalogProducts,
  ftdGrantForProduct,
  ftdRestoreGrantForProduct,
  type FtdGrant,
} from './ftd-fixture.ts';

const NO_ADS = ftdCatalogProducts[0].productId;
const HINTS_10 = ftdCatalogProducts[2].productId;

class LedgerWallet implements FulfillmentWallet<FtdGrant> {
  readonly ledger = new Set<string>();
  applyPurchaseGrantOnce(purchaseId: string, grant: FtdGrant): FtdGrant | null {
    if (this.ledger.has(purchaseId)) return null;
    this.ledger.add(purchaseId);
    return grant;
  }
}

class RestoreWallet implements RestoreEntitlementWallet<FtdGrant> {
  readonly grants: FtdGrant[] = [];
  grantRestoredEntitlement(grant: FtdGrant): void {
    this.grants.push(grant);
  }
}

function spySink(): PurchaseAnalyticsSink & { calls: { product_id: string; purchase_id: string; outcome: PurchaseUnfulfilledOutcome }[] } {
  const calls: { product_id: string; purchase_id: string; outcome: PurchaseUnfulfilledOutcome }[] = [];
  return { calls, purchaseUnfulfilled: (p) => calls.push(p) };
}

function customerInfoWith(productIds: string[]): CustomerInfoLike {
  return {
    allPurchasedProductIdentifiers: productIds,
    nonSubscriptionTransactions: productIds.map((productIdentifier) => ({ productIdentifier })),
  };
}

function purchased(productId: string, purchaseId: string, customerInfo: CustomerInfoLike | null): IapPurchaseResult {
  return { status: 'purchased', productId, storeProductId: productId, purchaseId, purchaseToken: null, customerInfo, errorMessage: null };
}

describe('fulfillVerifiedPurchaseOnce — fulfill-once idempotency', () => {
  it('fulfills a verified purchase and records the ledger id', () => {
    const wallet = new LedgerWallet();
    const result = fulfillVerifiedPurchaseOnce(purchased(NO_ADS, 'txn-1', customerInfoWith([NO_ADS])), ftdCatalogProducts, wallet, ftdGrantForProduct);
    expect(result.status).toBe('fulfilled');
    expect(result.grant).toEqual({ noAds: true, hints: 0, coins: 0, continueLevel: false });
    expect(wallet.ledger.has('txn-1')).toBe(true);
  });

  it('is idempotent: the same purchaseId a second time returns duplicate with no grant', () => {
    const wallet = new LedgerWallet();
    const purchase = purchased(NO_ADS, 'txn-1', customerInfoWith([NO_ADS]));
    expect(fulfillVerifiedPurchaseOnce(purchase, ftdCatalogProducts, wallet, ftdGrantForProduct).status).toBe('fulfilled');
    const second = fulfillVerifiedPurchaseOnce(purchase, ftdCatalogProducts, wallet, ftdGrantForProduct);
    expect(second.status).toBe('duplicate');
    expect(second.grant).toBeNull();
    expect(wallet.ledger.size).toBe(1);
  });

  it('returns unverified-purchase when customerInfo does not include the product', () => {
    const wallet = new LedgerWallet();
    const result = fulfillVerifiedPurchaseOnce(purchased(NO_ADS, 'txn-1', customerInfoWith([])), ftdCatalogProducts, wallet, ftdGrantForProduct);
    expect(result.status).toBe('unverified-purchase');
    expect(result.grant).toBeNull();
  });

  it('returns unknown-product / ambiguous-product for missing or duplicated catalog ids', () => {
    const wallet = new LedgerWallet();
    const unknown = fulfillVerifiedPurchaseOnce(purchased('com.fabrika.ftd.nope', 'txn-x', customerInfoWith(['com.fabrika.ftd.nope'])), ftdCatalogProducts, wallet, ftdGrantForProduct);
    expect(unknown.status).toBe('unknown-product');

    const ambiguousCatalog = [...ftdCatalogProducts, { ...ftdCatalogProducts[0], id: 'no-ads-dupe' }];
    const ambiguous = fulfillVerifiedPurchaseOnce(purchased(NO_ADS, 'txn-y', customerInfoWith([NO_ADS])), ambiguousCatalog, wallet, ftdGrantForProduct);
    expect(ambiguous.status).toBe('ambiguous-product');
  });
});

describe('reportUnfulfilledPurchase — retry ordering', () => {
  it('recovers via one restore retry and does NOT cry wolf on the analytics sink', async () => {
    const wallet = new LedgerWallet();
    const sink = spySink();
    const purchase = purchased(NO_ADS, 'txn-1', customerInfoWith([])); // verification fails at first
    const initial = fulfillVerifiedPurchaseOnce(purchase, ftdCatalogProducts, wallet, ftdGrantForProduct);
    expect(initial.status).toBe('unverified-purchase');

    // A restore that now returns a fresh customerInfo INCLUDING the product.
    const restore: () => Promise<IapRestoreResult> = () =>
      Promise.resolve({ status: 'restored', customerInfo: customerInfoWith([NO_ADS]), ownedProductIds: [NO_ADS], errorMessage: null });
    const retry = makePurchaseRestoreRetry(purchase, { restore, products: () => ftdCatalogProducts, wallet, grantForProduct: ftdGrantForProduct });

    const resolved = await reportUnfulfilledPurchase(initial, sink, retry);
    expect(resolved.status).toBe('fulfilled');
    expect(sink.calls).toHaveLength(0); // recovered → no unfulfilled event
  });

  it('emits exactly one unfulfilled event when the retry cannot recover', async () => {
    const wallet = new LedgerWallet();
    const sink = spySink();
    const initial = fulfillVerifiedPurchaseOnce(purchased(NO_ADS, 'txn-1', customerInfoWith([])), ftdCatalogProducts, wallet, ftdGrantForProduct);
    const restore: () => Promise<IapRestoreResult> = () =>
      Promise.resolve({ status: 'failed', customerInfo: null, ownedProductIds: [], errorMessage: 'still broken' });
    const retry = makePurchaseRestoreRetry(purchased(NO_ADS, 'txn-1', customerInfoWith([])), { restore, products: () => ftdCatalogProducts, wallet, grantForProduct: ftdGrantForProduct });

    const resolved = await reportUnfulfilledPurchase(initial, sink, retry);
    expect(resolved.status).toBe('unverified-purchase');
    expect(sink.calls).toEqual([{ product_id: NO_ADS, purchase_id: 'txn-1', outcome: 'unverified-purchase' }]);
  });

  it('never reports a duplicate', async () => {
    const sink = spySink();
    const resolved = await reportUnfulfilledPurchase({ status: 'duplicate', productId: NO_ADS, purchaseId: 'txn-1', grant: null }, sink);
    expect(resolved.status).toBe('duplicate');
    expect(sink.calls).toHaveLength(0);
  });
});

describe('restoreEntitlements — no double-grant of consumables', () => {
  it('grants only restore-recoverable entitlements', () => {
    const wallet = new RestoreWallet();
    const { granted } = restoreEntitlements([NO_ADS], ftdCatalogProducts, wallet, ftdRestoreGrantForProduct);
    expect(granted).toBe(true);
    expect(wallet.grants).toEqual([{ noAds: true, hints: 0, coins: 0, continueLevel: false }]);
  });

  it('does NOT grant consumables (hint/coin packs) on restore', () => {
    const wallet = new RestoreWallet();
    const { granted } = restoreEntitlements([HINTS_10], ftdCatalogProducts, wallet, ftdRestoreGrantForProduct);
    expect(granted).toBe(false);
    expect(wallet.grants).toHaveLength(0);
  });

  it('skips ambiguous (duplicate-productId) products', () => {
    const wallet = new RestoreWallet();
    const ambiguousCatalog = [...ftdCatalogProducts, { ...ftdCatalogProducts[0], id: 'no-ads-dupe' }];
    const { granted } = restoreEntitlements([NO_ADS], ambiguousCatalog, wallet, ftdRestoreGrantForProduct);
    expect(granted).toBe(false);
  });
});

describe('fulfillPurchaseWithResume — R37 dismissed-mid-purchase guard', () => {
  it('applies the grant regardless of UI presence; resumed follows shouldResume', async () => {
    const sink = spySink();

    // Overlay dismissed: shouldResume() === false. Money was taken → grant STILL applied.
    const walletA = new LedgerWallet();
    const dismissed = await fulfillPurchaseWithResume(purchased(NO_ADS, 'txn-A', customerInfoWith([NO_ADS])), {
      products: ftdCatalogProducts, wallet: walletA, grantForProduct: ftdGrantForProduct, analyticsSink: sink, shouldResume: () => false,
    });
    expect(dismissed.fulfillment.status).toBe('fulfilled');
    expect(walletA.ledger.has('txn-A')).toBe(true); // fulfillment independent of UI
    expect(dismissed.resumed).toBe(false);

    // Overlay still present: shouldResume() === true → resume the level.
    const walletB = new LedgerWallet();
    const present = await fulfillPurchaseWithResume(purchased(NO_ADS, 'txn-B', customerInfoWith([NO_ADS])), {
      products: ftdCatalogProducts, wallet: walletB, grantForProduct: ftdGrantForProduct, analyticsSink: sink, shouldResume: () => true,
    });
    expect(present.fulfillment.status).toBe('fulfilled');
    expect(present.resumed).toBe(true);
  });
});
