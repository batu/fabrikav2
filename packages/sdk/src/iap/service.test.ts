import { describe, expect, it } from 'vitest';
import { IapService, type IapServiceDependencies, type IapServiceEvent, type StoreProduct } from './service.ts';
import { FakePurchaseProvider, type FakePurchaseProviderConfig } from './fake-provider.ts';
import { ftdCatalogProducts, type FtdGrant } from './ftd-fixture.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function storeProductsFor(productIds: readonly string[]): StoreProduct[] {
  return productIds.map((productId) => ({
    productId,
    title: productId,
    description: productId,
    price: 1.99,
    priceString: '$1.99',
    currencyCode: 'USD',
  }));
}

const NO_ADS = ftdCatalogProducts[0].productId;
const HINTS_10 = ftdCatalogProducts[2].productId;

function makeDeps(
  providerConfig: FakePurchaseProviderConfig,
  overrides: Partial<IapServiceDependencies<FtdGrant>> = {},
): { deps: IapServiceDependencies<FtdGrant>; provider: FakePurchaseProvider } {
  const provider = new FakePurchaseProvider({
    products: storeProductsFor(ftdCatalogProducts.map((p) => p.productId)),
    ...providerConfig,
  });
  const deps: IapServiceDependencies<FtdGrant> = {
    isNativePlatform: () => true,
    platform: () => 'ios',
    apiKey: () => 'test_sandbox_key',
    catalogProducts: () => ftdCatalogProducts,
    provider: () => provider,
    operationTimeoutMs: () => 5_000,
    purchaseTimeoutMs: () => 5_000,
    ...overrides,
  };
  return { deps, provider };
}

async function readyService(
  providerConfig: FakePurchaseProviderConfig = {},
  overrides: Partial<IapServiceDependencies<FtdGrant>> = {},
): Promise<{ service: IapService<FtdGrant>; provider: FakePurchaseProvider }> {
  const { deps, provider } = makeDeps(providerConfig, overrides);
  const service = new IapService(deps);
  await service.init();
  return { service, provider };
}

describe('IapService.init — state machine', () => {
  it('reaches ready on a native platform with a key and loadable products', async () => {
    const { service, provider } = await readyService();
    expect(service.snapshot().state).toBe('ready');
    expect(provider.configureCalls).toBe(1);
    expect(service.snapshot().products).toHaveLength(12);
  });

  it('is unsupported-platform off-device', async () => {
    const { service } = await readyService({}, { isNativePlatform: () => false });
    expect(service.snapshot().state).toBe('unsupported-platform');
  });

  it('is missing-api-key when no key is configured', async () => {
    const { service } = await readyService({}, { apiKey: () => null });
    expect(service.snapshot().state).toBe('missing-api-key');
  });

  it('is load-failed when the provider throws, and allows a retry', async () => {
    let calls = 0;
    const provider = new FakePurchaseProvider({ products: storeProductsFor([NO_ADS]) });
    const service = new IapService<FtdGrant>({
      ...makeDeps({}).deps,
      provider: () => {
        calls += 1;
        if (calls === 1) throw new Error('provider boom');
        return provider;
      },
    });
    await service.init();
    expect(service.snapshot().state).toBe('load-failed');
    expect(service.snapshot().lastErrorMessage).toContain('provider boom');
    await service.init(); // retry allowed because init nulled the promise on failure
    expect(service.snapshot().state).toBe('ready');
  });
});

describe('IapService.purchase — state machine', () => {
  it('returns unavailable when not ready (state gate)', async () => {
    const { deps } = makeDeps({});
    const service = new IapService(deps); // never inited → idle
    const result = await service.purchase(NO_ADS);
    expect(result.status).toBe('unavailable');
  });

  it('threads purchaseId/purchaseToken/customerInfo on a successful purchase', async () => {
    const { service } = await readyService({
      purchaseResults: {
        [NO_ADS]: {
          productIdentifier: NO_ADS,
          transactionId: 'txn-1',
          purchaseToken: 'token-1',
          customerInfo: { allPurchasedProductIdentifiers: [NO_ADS], nonSubscriptionTransactions: [{ productIdentifier: NO_ADS }] },
        },
      },
    });
    const result = await service.purchase(NO_ADS);
    expect(result.status).toBe('purchased');
    expect(result.purchaseId).toBe('txn-1');
    expect(result.purchaseToken).toBe('token-1');
    expect(result.storeProductId).toBe(NO_ADS);
    expect(result.customerInfo?.allPurchasedProductIdentifiers).toContain(NO_ADS);
  });

  it('rejects a concurrent purchase — single-flight guard', async () => {
    const { service } = await readyService({ hangingPurchaseProductIds: [NO_ADS] });
    const pending = service.purchase(NO_ADS); // never settles; holds the lock
    void pending;
    await Promise.resolve();
    const second = await service.purchase(HINTS_10);
    expect(second.status).toBe('unavailable');
    expect(second.errorMessage).toBe('native store operation already in progress');
    expect(service.snapshot().purchaseInProgress).toBe(true);
  });

  it('rejects a purchase while a restore is in progress', async () => {
    const { service } = await readyService({ hangRestore: true });
    const pendingRestore = service.restore(); // never settles; holds the lock
    void pendingRestore;
    await Promise.resolve();
    const result = await service.purchase(NO_ADS);
    expect(result.status).toBe('unavailable');
    expect(result.errorMessage).toBe('native store operation already in progress');
  });

  it('classifies a user cancel vs a generic failure', async () => {
    const { service } = await readyService({
      purchaseErrors: { [NO_ADS]: { userCancelled: true }, [HINTS_10]: new Error('network down') },
    });
    expect((await service.purchase(NO_ADS)).status).toBe('cancelled');
    const failed = await service.purchase(HINTS_10);
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toBe('network down');
    expect(service.snapshot().lastErrorMessage).toBe('network down');
  });

  it('clears the active purchase in finally — a failed purchase does not wedge the service', async () => {
    const { service, provider } = await readyService({
      purchaseErrors: { [NO_ADS]: new Error('boom') },
    });
    expect((await service.purchase(NO_ADS)).status).toBe('failed');
    expect(service.snapshot().purchaseInProgress).toBe(false);
    // A subsequent purchase of another product proceeds normally.
    provider.setConfig({
      purchaseResults: {
        [HINTS_10]: {
          productIdentifier: HINTS_10, transactionId: 't', purchaseToken: null,
          customerInfo: { allPurchasedProductIdentifiers: [], nonSubscriptionTransactions: [{ productIdentifier: HINTS_10 }] },
        },
      },
    });
    expect((await service.purchase(HINTS_10)).status).toBe('purchased');
  });
});

describe('IapService.restore — late-settle machine', () => {
  it('restores owned product ids from customerInfo', async () => {
    const { service } = await readyService({
      restoreCustomerInfo: { allPurchasedProductIdentifiers: [NO_ADS], nonSubscriptionTransactions: [{ productIdentifier: NO_ADS }] },
    });
    const result = await service.restore();
    expect(result.status).toBe('restored');
    expect(result.ownedProductIds).toContain(NO_ADS);
  });

  it('returns unavailable when not ready', async () => {
    const { deps } = makeDeps({});
    const service = new IapService(deps);
    expect((await service.restore()).status).toBe('unavailable');
  });

  it('captures a result that lands AFTER the user-facing timeout (late-settle), and clears the lock', async () => {
    const { service } = await readyService(
      {
        restoreDelayMs: 40,
        restoreCustomerInfo: { allPurchasedProductIdentifiers: [NO_ADS], nonSubscriptionTransactions: [{ productIdentifier: NO_ADS }] },
      },
      { operationTimeoutMs: () => 10 }, // user-facing timeout fires before the native restore settles
    );
    // First call: user-facing timeout fires → failed, but the native restore is
    // still in flight and the lock is held.
    const first = await service.restore();
    expect(first.status).toBe('failed');
    expect(service.snapshot().restoreInProgress).toBe(true);

    // After the native restore settles, the lock clears and the late result is banked.
    await wait(60);
    expect(service.snapshot().restoreInProgress).toBe(false);

    // The next restore() returns the banked late result without a fresh native call.
    const second = await service.restore();
    expect(second.status).toBe('restored');
    expect(second.ownedProductIds).toContain(NO_ADS);
  });
});

describe('IapService.onEvent — purchase-pipeline observability', () => {
  it('emits state transitions through init with reasons', async () => {
    const events: IapServiceEvent[] = [];
    await readyService({}, { onEvent: (event) => events.push(event) });
    expect(events).toEqual([
      { type: 'state_changed', state: 'initializing', reason: null },
      { type: 'state_changed', state: 'ready', reason: null },
    ]);
  });

  it('emits load-failed with the error message as reason', async () => {
    const events: IapServiceEvent[] = [];
    const { deps } = makeDeps({}, { onEvent: (event) => events.push(event) });
    const service = new IapService({ ...deps, provider: () => { throw new Error('provider boom'); } });
    await service.init();
    expect(events.at(-1)).toEqual({ type: 'state_changed', state: 'load-failed', reason: 'provider boom' });
  });

  it('emits purchase_dispatched immediately before the provider purchase call', async () => {
    const events: IapServiceEvent[] = [];
    const { service } = await readyService(
      { purchaseErrors: { [NO_ADS]: new Error('store down') } },
      { onEvent: (event) => events.push(event) },
    );
    await service.purchase(NO_ADS);
    expect(events).toContainEqual({ type: 'purchase_dispatched', productId: NO_ADS });
  });

  it('does NOT emit purchase_dispatched when the purchase short-circuits before the provider', async () => {
    const events: IapServiceEvent[] = [];
    const { service } = await readyService({}, { onEvent: (event) => events.push(event) });
    await service.purchase('nonexistent.product');
    expect(events.filter((event) => event.type === 'purchase_dispatched')).toHaveLength(0);
  });

  it('a throwing onEvent listener does not break the purchase', async () => {
    const { service } = await readyService(
      {
        purchaseResults: {
          [NO_ADS]: {
            productIdentifier: NO_ADS, transactionId: 't', purchaseToken: null,
            customerInfo: { allPurchasedProductIdentifiers: [], nonSubscriptionTransactions: [{ productIdentifier: NO_ADS }] },
          },
        },
      },
      { onEvent: () => { throw new Error('listener boom'); } },
    );
    const result = await service.purchase(NO_ADS);
    expect(result.status).toBe('purchased');
  });
});

describe('IapService.purchase — failureKind classification', () => {
  it('classifies OUR timeout as failureKind timeout', async () => {
    const { service } = await readyService(
      { hangingPurchaseProductIds: [NO_ADS] },
      { purchaseTimeoutMs: () => 20 },
    );
    const result = await service.purchase(NO_ADS);
    expect(result.status).toBe('failed');
    expect(result.failureKind).toBe('timeout');
    expect(result.errorMessage).toContain('timed out');
  });

  it('classifies a provider rejection as failureKind store-error', async () => {
    const { service } = await readyService({ purchaseErrors: { [NO_ADS]: new Error('storekit says no') } });
    const result = await service.purchase(NO_ADS);
    expect(result.status).toBe('failed');
    expect(result.failureKind).toBe('store-error');
  });

  it('a user cancel carries no failureKind', async () => {
    const { service } = await readyService({ purchaseErrors: { [NO_ADS]: { userCancelled: true } } });
    const result = await service.purchase(NO_ADS);
    expect(result.status).toBe('cancelled');
    expect(result.failureKind).toBeUndefined();
  });
});
