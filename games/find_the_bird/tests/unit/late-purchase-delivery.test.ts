import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakePurchaseProvider } from '@fabrikav2/sdk/iap';

// Durability detection has separate storage-fallback/volatile-IAP coverage.
vi.mock('../../src/platform/storageFallback', () => ({ runtimeStorageDurability: 'durable' }));
vi.mock('../../src/config/RemoteConfigService', async () => {
  const { REMOTE_CONFIG_DEFAULTS } = await import('../../src/config/remoteConfigSchema');
  return { remoteConfigService: {
    value: (key: keyof typeof REMOTE_CONFIG_DEFAULTS) => REMOTE_CONFIG_DEFAULTS[key],
    snapshot: () => ({ values: REMOTE_CONFIG_DEFAULTS }),
  } };
});
import { FindTheDogIapService, ftdDefaultStoreProduct } from '../../src/shop/IapService';
import { buildFullShopCatalog } from '../../src/shop/ProductCatalog';
import { fulfillVerifiedPurchaseOnce } from '../../src/shop/PurchaseFulfillment';
import { GameState } from '../../src/core/GameState';

const pendingKey = 'find_the_bird_pending_purchases_v1';
const walletKey = 'ftd_wallet_purchase_checkpoint_v1';
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('late store result through the game wallet', () => {
  it('delivers once without a second tap and recovers after a wallet write failure', async () => {
    const products = buildFullShopCatalog().products;
    const product = products.find((p) => p.kind === 'coinPack')!;
    expect(product).toBeDefined();
    const provider = new FakePurchaseProvider({
      products: products.map(ftdDefaultStoreProduct),
      purchaseDelayMs: { [product.productId]: 60_100 },
      purchaseResults: { [product.productId]: {
        productIdentifier: product.productId, transactionId: 'late-store-id', purchaseToken: null,
        customerInfo: { allPurchasedProductIdentifiers: [product.productId], nonSubscriptionTransactions: [{ productIdentifier: product.productId }] },
      } },
    });
    const composition = { isNativePlatform: () => true, platform: () => 'ios' as const,
      apiKey: () => 'test_key', provider: () => provider };
    const wallet = new GameState();
    const before = wallet.coinBalance;
    const service = new FindTheDogIapService(composition);
    const deliver = (purchase: Parameters<typeof fulfillVerifiedPurchaseOnce>[0]) => {
      const result = fulfillVerifiedPurchaseOnce(purchase, products, wallet);
      return result.status === 'fulfilled' || result.status === 'duplicate';
    };
    service.setOnCompletedPurchase(deliver);
    service.configureComposition(composition);
    service.init(); await service.initPromiseValue;
    const first = service.purchase(product.productId);
    await vi.advanceTimersByTimeAsync(60_001);
    expect((await first).failureKind).toBe('timeout');
    const setItem = localStorage.setItem.bind(localStorage);
    const fail = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === walletKey) throw new Error('quota exceeded');
      setItem(key, value);
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(wallet.coinBalance).toBe(before);
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toHaveLength(1);
    expect(provider.purchaseCalls).toEqual([product.productId]);
    fail.mockRestore();

    // A new service and wallet represent a fresh process after the failed grant.
    const restoredWallet = new GameState();
    const restored = new FindTheDogIapService(composition);
    restored.setOnCompletedPurchase((purchase) => {
      const result = fulfillVerifiedPurchaseOnce(purchase, products, restoredWallet);
      return result.status === 'fulfilled' || result.status === 'duplicate';
    });
    restored.init(); await restored.initPromiseValue;
    expect(restoredWallet.coinBalance).toBe(before + product.coinAmount);
    expect(new GameState().coinBalance).toBe(restoredWallet.coinBalance);
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toEqual([]);
    restored.reconcilePendingPurchases();
    expect(restoredWallet.coinBalance).toBe(before + product.coinAmount);
    expect(provider.purchaseCalls).toEqual([product.productId]);
  });

  it('grants an ordinary purchase to its waiting caller without firing late delivery', async () => {
    const products = buildFullShopCatalog().products;
    const product = products.find((p) => p.kind === 'coinPack')!;
    const provider = new FakePurchaseProvider({
      products: products.map(ftdDefaultStoreProduct),
      purchaseResults: { [product.productId]: {
        productIdentifier: product.productId, transactionId: 'ordinary-store-id', purchaseToken: null,
        customerInfo: { allPurchasedProductIdentifiers: [product.productId], nonSubscriptionTransactions: [{ productIdentifier: product.productId }] },
      } },
    });
    const service = new FindTheDogIapService({ isNativePlatform: () => true, platform: () => 'ios',
      apiKey: () => 'test_key', provider: () => provider });
    const delivered = vi.fn(() => true);
    service.setOnCompletedPurchase(delivered);
    service.init(); await service.initPromiseValue;
    const purchase = await service.purchase(product.productId);
    expect(purchase.status).toBe('purchased');
    const wallet = new GameState();
    expect(fulfillVerifiedPurchaseOnce(purchase, products, wallet).status).toBe('fulfilled');
    expect(new GameState().hasProcessedPurchaseId('ordinary-store-id')).toBe(true);
    expect(delivered).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toEqual([purchase]);
    expect(service.acknowledgePurchase({ ...purchase, purchaseId: 'another-transaction' })).toBe(false);
    expect(service.acknowledgePurchase(purchase)).toBe(true);
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toEqual([]);
    expect((await service.purchase(product.productId)).status).toBe('purchased');
    expect(provider.purchaseCalls).toHaveLength(2);
  });
});

function ordinaryPurchaseFixture(wallet = new GameState()) {
  const products = buildFullShopCatalog().products;
  const product = products.find((p) => p.kind === 'coinPack')!;
  const provider = new FakePurchaseProvider({
    products: products.map(ftdDefaultStoreProduct),
    purchaseResults: { [product.productId]: {
      productIdentifier: product.productId, transactionId: 'received-store-id', purchaseToken: null,
      customerInfo: { allPurchasedProductIdentifiers: [product.productId], nonSubscriptionTransactions: [{ productIdentifier: product.productId }] },
    } },
  });
  const composition = { isNativePlatform: () => true, platform: () => 'ios' as const,
    apiKey: () => 'test_key', provider: () => provider, preparePurchase: () => wallet.preparePurchase() };
  const service = new FindTheDogIapService(composition);
  service.setOnCompletedPurchase((purchase) => {
    const delivered = fulfillVerifiedPurchaseOnce(purchase, products, wallet);
    return delivered.status === 'fulfilled' || delivered.status === 'duplicate';
  });
  return { service, wallet, provider, composition, product, products };
}

function failPurchaseWrites(keyToFail: string) {
  const setItem = localStorage.setItem.bind(localStorage);
  return vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === keyToFail) throw new Error('QuotaExceededError');
    setItem(key, value);
  });
}

describe('ordinary received purchase delivery', () => {
  it('recovers an ordinary success after wallet failure and restart without a second charge', async () => {
    const f = ordinaryPurchaseFixture();
    const before = f.wallet.coinBalance;
    f.service.init(); await f.service.initPromiseValue;
    const purchase = await f.service.purchase(f.product.productId);
    expect(purchase.status).toBe('purchased');
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toEqual([purchase]);

    const failure = failPurchaseWrites(walletKey);
    expect(fulfillVerifiedPurchaseOnce(purchase, f.products, f.wallet).status).toBe('delivery-pending');
    f.service.reconcilePendingPurchases();
    expect(f.wallet.coinBalance).toBe(before);
    expect((await f.service.purchase(f.product.productId)).status).toBe('unavailable');
    expect(f.provider.purchaseCalls).toEqual([f.product.productId]);
    failure.mockRestore();

    const restartedWallet = new GameState();
    const restarted = new FindTheDogIapService({ ...f.composition, preparePurchase: () => restartedWallet.preparePurchase() });
    restarted.setOnCompletedPurchase((received) => {
      const grant = fulfillVerifiedPurchaseOnce(received, f.products, restartedWallet);
      return grant.status === 'fulfilled' || grant.status === 'duplicate';
    });
    restarted.init(); await restarted.initPromiseValue;
    restarted.reconcilePendingPurchases();
    expect(restartedWallet.coinBalance).toBe(before + f.product.coinAmount);
    expect(new GameState().hasProcessedPurchaseId(purchase.purchaseId!)).toBe(true);
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toEqual([]);
    expect(f.provider.purchaseCalls).toEqual([f.product.productId]);
  });

  it('refuses a native purchase when the existing wallet checkpoint is malformed', async () => {
    localStorage.setItem(walletKey, '{}');
    const f = ordinaryPurchaseFixture();
    f.service.init(); await f.service.initPromiseValue;
    expect((await f.service.purchase(f.product.productId)).status).toBe('unavailable');
    expect(f.provider.purchaseCalls).toEqual([]);
    expect(localStorage.getItem(walletKey)).toBe('{}');
  });

  it.each([walletKey, pendingKey])('refuses a native purchase when %s is already unwritable', async (key) => {
    const f = ordinaryPurchaseFixture();
    f.service.init(); await f.service.initPromiseValue;
    failPurchaseWrites(key);
    expect((await f.service.purchase(f.product.productId)).status).toBe('unavailable');
    expect(f.provider.purchaseCalls).toEqual([]);
  });

  it('retains a granted purchase if acknowledgement fails and redelivers only a ledger duplicate', async () => {
    const f = ordinaryPurchaseFixture();
    const before = f.wallet.coinBalance;
    f.service.init(); await f.service.initPromiseValue;
    const purchase = await f.service.purchase(f.product.productId);
    expect(fulfillVerifiedPurchaseOnce(purchase, f.products, f.wallet).status).toBe('fulfilled');
    const failure = failPurchaseWrites(pendingKey);
    expect(f.service.acknowledgePurchase(purchase)).toBe(false);
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toEqual([purchase]);
    failure.mockRestore();
    f.service.reconcilePendingPurchases();
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toEqual([]);
    expect(new GameState().coinBalance).toBe(before + f.product.coinAmount);
    expect(f.provider.purchaseCalls).toEqual([f.product.productId]);
  });

  it('retries recording a received success without dispatching again when storage fails after payment starts', async () => {
    const f = ordinaryPurchaseFixture();
    f.service.init(); await f.service.initPromiseValue;
    const waiting = f.service.purchase(f.product.productId);
    const failure = failPurchaseWrites(pendingKey);
    expect((await waiting).status).toBe('unavailable');
    expect((await f.service.purchase(f.product.productId)).status).toBe('unavailable');
    expect(f.provider.purchaseCalls).toEqual([f.product.productId]);
    failure.mockRestore();
    const recovered = await f.service.purchase(f.product.productId);
    expect(recovered.status).toBe('purchased');
    expect(new GameState().hasProcessedPurchaseId('received-store-id')).toBe(true);
    expect(f.provider.purchaseCalls).toEqual([f.product.productId]);
  });
});
