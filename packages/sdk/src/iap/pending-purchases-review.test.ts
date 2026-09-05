import { describe, expect, it } from 'vitest';
import { IapService, type IapPurchaseResult } from './service.ts';
import { FakePurchaseProvider } from './fake-provider.ts';
import { ftdCatalogProducts } from './ftd-fixture.ts';
import { localStoragePendingPurchaseStore } from './pending-purchases.ts';

const product = ftdCatalogProducts[2];
const pending: IapPurchaseResult = {
  status: 'purchased', productId: product.productId, storeProductId: product.productId,
  purchaseId: 'pending-native-transaction', purchaseToken: null, errorMessage: null,
  customerInfo: { allPurchasedProductIdentifiers: [product.productId], nonSubscriptionTransactions: [] },
};

describe('pending purchase independent review regressions', () => {
  it.each([
    { purchaseId: null, purchaseToken: null },
    { purchaseId: '', purchaseToken: null },
    { purchaseId: 'valid-store-id', purchaseToken: '' },
    { purchaseId: '   ', purchaseToken: null },
    { customerInfo: undefined },
    { customerInfo: null },
    { storeProductId: '' },
  ])('rejects an unusable record on both load and save without replacing durable evidence: %j', (override) => {
    const invalid = { ...pending, ...override } as IapPurchaseResult;
    let raw = JSON.stringify([invalid]);
    let writes = 0;
    const store = localStoragePendingPurchaseStore('pending', () => ({
      getItem: () => raw,
      setItem: (_key, value) => { writes++; raw = value; },
    }));
    expect(() => store.load()).toThrow(/invalid pending purchase record/);
    raw = JSON.stringify([pending]);
    expect(() => store.save([invalid])).toThrow(/invalid pending purchase record/);
    expect(writes).toBe(0);
    expect(store.load()).toEqual([pending]);
  });

  it.each([
    { productId: pending.productId, purchaseId: 'another-store-transaction' },
    { productId: 'another-sku', purchaseId: pending.purchaseId },
  ])('rejects ambiguous duplicate product/transaction records instead of overwriting them: %j', (second) => {
    const results = [pending, { ...pending, ...second }];
    let writes = 0;
    const store = localStoragePendingPurchaseStore('pending', () => ({
      getItem: () => JSON.stringify(results),
      setItem: () => { writes++; },
    }));
    expect(() => store.load()).toThrow(/duplicate product or transaction/);
    expect(() => store.save(results)).toThrow(/duplicate product or transaction/);
    expect(writes).toBe(0);
  });

  it('accepts the Android purchase token as the usable ledger identity', () => {
    let raw: string | null = null;
    const store = localStoragePendingPurchaseStore('pending', () => ({
      getItem: () => raw,
      setItem: (_key, value) => { raw = value; },
    }));
    const android = { ...pending, purchaseId: null, purchaseToken: 'play-token' };
    store.save([android]);
    expect(store.load()).toEqual([android]);
  });

  it('does not charge again when the first readable retry loads and acknowledges the requested SKU', async () => {
    let failRead = true;
    let raw = JSON.stringify([pending]);
    const store = localStoragePendingPurchaseStore('pending', () => ({
      getItem: () => { if (failRead) throw new Error('storage temporarily unavailable'); return raw; },
      setItem: (_key, value) => { raw = value; },
    }));
    const provider = new FakePurchaseProvider({
      products: [{ productId: product.productId, title: 'Hints', description: '', price: 1, priceString: '$1', currencyCode: 'USD' }],
      purchaseResults: { [product.productId]: { productIdentifier: product.productId, transactionId: 'unexpected-second-charge', purchaseToken: null, customerInfo: pending.customerInfo! } },
    });
    const service = new IapService({
      isNativePlatform: () => true, platform: () => 'ios', apiKey: () => 'test_local',
      catalogProducts: () => [product], provider: () => provider, operationTimeoutMs: () => 100,
      pendingPurchaseStore: store,
    });
    const grants: string[] = [];
    service.setOnCompletedPurchase((purchase) => { grants.push(purchase.purchaseId!); return true; });
    await service.init();
    expect(service.snapshot().lastErrorMessage).toContain('storage temporarily unavailable');
    failRead = false;
    const recovered = await service.purchase(product.productId);
    expect(grants).toEqual(['pending-native-transaction']);
    expect(recovered.purchaseId).toBe('pending-native-transaction');
    expect(provider.purchaseCalls).toEqual([]);
    expect(store.load()).toEqual([]);
  });
});
