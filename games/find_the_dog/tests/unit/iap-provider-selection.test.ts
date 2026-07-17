import { describe, expect, it, vi } from 'vitest';
import { createSdkContext } from '../../src/sdk/SdkContext';

describe('FTD IAP provider selection', () => {
  it('uses seeded Fake on web and configured RevenueCat on native iOS', async () => {
    const webLoader = vi.fn();
    const web = createSdkContext({
      buildEnv: 'development',
      platform: 'web',
      isNativePlatform: false,
      env: {},
      revenueCatLoader: webLoader,
    });
    expect(web.selection.iap).toBe('fake');
    expect(webLoader).not.toHaveBeenCalled();

    const configure = vi.fn(async () => undefined);
    const nativeLoader = vi.fn(async () => ({
      Purchases: {
        configure,
        getProducts: vi.fn(async () => ({ products: [] })),
        getOfferings: vi.fn(async () => ({ all: {} })),
        purchaseStoreProduct: vi.fn(),
        restorePurchases: vi.fn(async () => ({ customerInfo: { allPurchasedProductIdentifiers: [], nonSubscriptionTransactions: [] } })),
        addCustomerInfoUpdateListener: vi.fn(async () => 'listener-1'),
        removeCustomerInfoUpdateListener: vi.fn(async () => undefined),
      },
    }));
    const native = createSdkContext({
      buildEnv: 'development',
      platform: 'ios',
      isNativePlatform: true,
      env: { VITE_REVENUECAT_IOS_API_KEY: 'test_ftd_key' },
      revenueCatLoader: nativeLoader,
    });
    const provider = await native.iapComposition.provider();
    await provider.configure({ apiKey: native.iapComposition.apiKey()! });

    expect(native.selection.iap).toBe('revenuecat');
    expect(nativeLoader).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledWith({ apiKey: 'test_ftd_key' });
  });

  it('falls back to Fake and emits a release-blocker diagnostic when native key is absent', () => {
    const warn = vi.fn();
    const context = createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      isNativePlatform: true,
      env: {},
      logger: { warn },
    });
    expect(context.selection.iap).toBe('fake');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RELEASE BLOCKER'));
  });
});
