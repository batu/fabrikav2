import { describe, expect, it } from 'vitest';
import { IapService, type IapServiceDependencies, type StoreProduct } from './service.ts';
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

describe('IapService.purchase — late-settle serialization (AUDIT #4)', () => {
  const NO_ADS_TXN = {
    productIdentifier: NO_ADS,
    transactionId: 'txn-1',
    purchaseToken: 'token-1',
    customerInfo: { allPurchasedProductIdentifiers: [NO_ADS], nonSubscriptionTransactions: [{ productIdentifier: NO_ADS }] },
  };

  it('holds the lock past the caller timeout and a retry cannot double-charge (AC1); the late success is banked, not discarded (AC2)', async () => {
    const { service, provider } = await readyService(
      { purchaseDelayMs: { [NO_ADS]: 40 }, purchaseResults: { [NO_ADS]: NO_ADS_TXN } },
      { purchaseTimeoutMs: () => 10 },
    );

    // Caller-facing timeout fires before the native purchase settles.
    const first = await service.purchase(NO_ADS);
    expect(first.status).toBe('failed');
    // The lock is HELD through native settlement — the timer did not release it.
    expect(service.snapshot().purchaseInProgress).toBe(true);

    // A retry while the native call is still live is rejected — no second charge.
    const retry = await service.purchase(NO_ADS);
    expect(retry.status).toBe('unavailable');
    expect(retry.errorMessage).toBe('native store operation already in progress');
    expect(provider.purchaseCalls).toEqual([NO_ADS]);

    // After the native promise settles the lock releases and the result is banked.
    await wait(60);
    expect(service.snapshot().purchaseInProgress).toBe(false);

    // The next purchase() of the same product returns the banked outcome without a
    // fresh native call — the discarded-first-transaction bug is closed.
    const banked = await service.purchase(NO_ADS);
    expect(banked.status).toBe('purchased');
    expect(banked.purchaseId).toBe('txn-1');
    expect(provider.purchaseCalls).toEqual([NO_ADS]);
  });

  it('banks a late native FAILURE that lands after the caller timeout (AC2/AC3)', async () => {
    const { service, provider } = await readyService(
      { purchaseDelayMs: { [NO_ADS]: 40 }, purchaseErrors: { [NO_ADS]: new Error('late boom') } },
      { purchaseTimeoutMs: () => 10 },
    );

    const first = await service.purchase(NO_ADS);
    expect(first.status).toBe('failed');
    expect(service.snapshot().purchaseInProgress).toBe(true);

    await wait(60);
    // Lock released after settlement even on a rejection (AC3).
    expect(service.snapshot().purchaseInProgress).toBe(false);

    const banked = await service.purchase(NO_ADS);
    expect(banked.status).toBe('failed');
    expect(banked.errorMessage).toBe('late boom');
    expect(provider.purchaseCalls).toEqual([NO_ADS]);
  });

  it('keeps late results per-SKU — a banked SKU A result does not block or leak into SKU B (AC4)', async () => {
    const HINTS_TXN = {
      productIdentifier: HINTS_10,
      transactionId: 'txn-h',
      purchaseToken: null,
      customerInfo: { allPurchasedProductIdentifiers: [], nonSubscriptionTransactions: [{ productIdentifier: HINTS_10 }] },
    };
    const { service, provider } = await readyService(
      {
        purchaseDelayMs: { [NO_ADS]: 40 },
        purchaseResults: { [NO_ADS]: NO_ADS_TXN, [HINTS_10]: HINTS_TXN },
      },
      { purchaseTimeoutMs: () => 10 },
    );

    // SKU A times out on the caller side, then settles late and is banked.
    expect((await service.purchase(NO_ADS)).status).toBe('failed');
    await wait(60);
    expect(service.snapshot().purchaseInProgress).toBe(false);

    // A different SKU is charged normally and is NOT served the banked A result.
    const other = await service.purchase(HINTS_10);
    expect(other.status).toBe('purchased');
    expect(other.productId).toBe(HINTS_10);
    expect(provider.purchaseCalls).toEqual([NO_ADS, HINTS_10]);

    // The banked A result is still deliverable to a later A purchase.
    const bankedA = await service.purchase(NO_ADS);
    expect(bankedA.status).toBe('purchased');
    expect(bankedA.purchaseId).toBe('txn-1');
    expect(provider.purchaseCalls).toEqual([NO_ADS, HINTS_10]);
  });

  it('preserves separate unconsumed late results when two SKUs time out sequentially (AC4)', async () => {
    const HINTS_TXN = {
      productIdentifier: HINTS_10,
      transactionId: 'txn-h',
      purchaseToken: null,
      customerInfo: { allPurchasedProductIdentifiers: [], nonSubscriptionTransactions: [{ productIdentifier: HINTS_10 }] },
    };
    const { service, provider } = await readyService(
      {
        purchaseDelayMs: { [NO_ADS]: 40, [HINTS_10]: 40 },
        purchaseResults: { [NO_ADS]: NO_ADS_TXN, [HINTS_10]: HINTS_TXN },
      },
      { purchaseTimeoutMs: () => 10 },
    );

    expect((await service.purchase(NO_ADS)).status).toBe('failed');
    await wait(60);
    expect((await service.purchase(HINTS_10)).status).toBe('failed');
    await wait(60);

    expect((await service.purchase(NO_ADS)).purchaseId).toBe('txn-1');
    expect((await service.purchase(HINTS_10)).purchaseId).toBe('txn-h');
    expect(provider.purchaseCalls).toEqual([NO_ADS, HINTS_10]);
  });

  it('releases the purchase lock when a provider throws synchronously', async () => {
    const { service, provider } = await readyService({});
    provider.purchaseProduct = (): Promise<never> => {
      throw new Error('sync provider failure');
    };

    const result = await service.purchase(NO_ADS);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('sync provider failure');
    expect(service.snapshot().purchaseInProgress).toBe(false);
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
