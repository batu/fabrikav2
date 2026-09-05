import { describe, expect, it } from 'vitest';
import { IapService, type IapPurchaseResult, type IapServiceDependencies, type PurchaseTransaction } from './service.ts';
import { FakePurchaseProvider } from './fake-provider.ts';
import { ftdCatalogProducts, type FtdGrant } from './ftd-fixture.ts';
import { localStoragePendingPurchaseStore, type PendingPurchaseStore } from './pending-purchases.ts';

const productId = ftdCatalogProducts[2].productId;
const transaction: PurchaseTransaction = {
  productIdentifier: productId, transactionId: 'store-transaction', purchaseToken: null,
  customerInfo: { allPurchasedProductIdentifiers: [productId], nonSubscriptionTransactions: [] },
};
const result: IapPurchaseResult = { status: 'purchased', productId, storeProductId: productId,
  purchaseId: transaction.transactionId, purchaseToken: null, customerInfo: transaction.customerInfo, errorMessage: null };

function fixture(store: PendingPurchaseStore) {
  const provider = new FakePurchaseProvider({ products: [{ productId, title: 'Hints', description: '', price: 1, priceString: '$1', currencyCode: 'USD' }] });
  let settle!: (value: PurchaseTransaction) => void;
  let charges = 0;
  provider.purchaseProduct = () => { charges++; return new Promise((resolve) => { settle = resolve; }); };
  const deps: IapServiceDependencies<FtdGrant> = {
    isNativePlatform: () => true, platform: () => 'ios', apiKey: () => 'test_key',
    catalogProducts: () => ftdCatalogProducts, provider: () => provider,
    operationTimeoutMs: () => 100, purchaseTimeoutMs: () => 1, pendingPurchaseStore: store,
  };
  return { service: new IapService(deps), deps, settle: () => settle(transaction), charges: () => charges };
}

function memoryStore(initial: IapPurchaseResult[] = []) {
  let raw = JSON.stringify(initial);
  let fail = false;
  const store = localStoragePendingPurchaseStore('purchases', () => ({
    getItem: () => raw,
    setItem: (_key, value) => { if (fail) throw new Error('quota exceeded'); raw = value; },
  }));
  return { store, setFail: (value: boolean) => { fail = value; } };
}

describe('late purchase delivery', () => {
  it('delivers after timeout without another tap and acknowledges only after the wallet succeeds', async () => {
    const { store } = memoryStore();
    const f = fixture(store);
    const delivered: string[] = [];
    f.service.setOnCompletedPurchase((purchase) => {
      expect(store.load()).toEqual([purchase]);
      delivered.push(purchase.purchaseId!);
      return true;
    });
    await f.service.init();
    expect((await f.service.purchase(productId)).failureKind).toBe('timeout');
    f.settle();
    await Promise.resolve(); await Promise.resolve();
    expect(delivered).toEqual(['store-transaction']);
    expect(store.load()).toEqual([]);
    expect(f.charges()).toBe(1);
  });

  it('reconstructs pending delivery and retries a rejected wallet without charging again', async () => {
    const { store } = memoryStore([result]);
    const f = fixture(store);
    f.service.setOnCompletedPurchase(() => false);
    await f.service.init();
    expect((await f.service.purchase(productId)).status).toBe('unavailable');
    expect(f.charges()).toBe(0);
    const restarted = new IapService(f.deps);
    let deliveries = 0;
    restarted.setOnCompletedPurchase(() => { deliveries++; return true; });
    await restarted.init();
    expect(deliveries).toBe(1);
    restarted.reconcilePendingPurchases();
    expect(deliveries).toBe(1);
    expect(store.load()).toEqual([]);
  });

  it('keeps a write failure in memory and retries persistence before granting', async () => {
    const m = memoryStore();
    const f = fixture(m.store);
    let deliveries = 0;
    f.service.setOnCompletedPurchase(() => { deliveries++; return true; });
    await f.service.init();
    await f.service.purchase(productId);
    m.setFail(true); f.settle();
    await Promise.resolve(); await Promise.resolve();
    expect(deliveries).toBe(0);
    expect(f.service.snapshot().lastErrorMessage).toContain('quota exceeded');
    expect((await f.service.purchase(productId)).status).toBe('unavailable');
    expect(f.charges()).toBe(1);
    m.setFail(false);
    f.service.reconcilePendingPurchases();
    expect(deliveries).toBe(1);
  });

  it('retains the record on wallet exceptions and safely redelivers after acknowledgment failure', async () => {
    const m = memoryStore([result]);
    const f = fixture(m.store);
    f.service.setOnCompletedPurchase(() => { throw new Error('wallet write failed'); });
    await f.service.init();
    expect(m.store.load()).toEqual([result]);
    const ledger = new Set<string>();
    let grants = 0;
    f.service.setOnCompletedPurchase((purchase) => {
      if (!ledger.has(purchase.purchaseId!)) { ledger.add(purchase.purchaseId!); grants++; }
      m.setFail(true); return true;
    });
    expect(m.store.load()).toEqual([result]);
    m.setFail(false);
    f.service.setOnCompletedPurchase((purchase) => ledger.has(purchase.purchaseId!));
    expect(m.store.load()).toEqual([]);
    expect(grants).toBe(1);
  });

  it('fails closed on unreadable records rather than overwriting evidence or charging', async () => {
    const store = localStoragePendingPurchaseStore('key', () => ({ getItem: () => '{broken', setItem: () => { throw new Error('must not write'); } }));
    const f = fixture(store);
    f.service.setOnCompletedPurchase(() => true);
    await f.service.init();
    expect((await f.service.purchase(productId)).status).toBe('unavailable');
    expect(f.charges()).toBe(0);
  });
});
