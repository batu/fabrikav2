import { describe, expect, it, vi } from 'vitest';
import { createSdkContext } from '../../src/sdk/SdkContext';

const REVENUECAT_IOS_PUBLIC_KEY = `appl_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n'}`;

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
      env: { VITE_REVENUECAT_IOS_API_KEY: REVENUECAT_IOS_PUBLIC_KEY },
      revenueCatLoader: nativeLoader,
    });
    const provider = await native.iapComposition.provider();
    await provider.configure({ apiKey: native.iapComposition.apiKey()! });

    expect(native.selection.iap).toBe('revenuecat');
    expect(nativeLoader).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledWith({ apiKey: REVENUECAT_IOS_PUBLIC_KEY });
  });

  it('rejects production native iOS when the owner-controlled RevenueCat key is absent', () => {
    expect(() => createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      isNativePlatform: true,
      env: {},
    })).toThrow('VITE_REVENUECAT_IOS_API_KEY');
  });

  it.each([
    'test_placeholder_key',
    '__SET_IN_LOCAL_ENV__',
    'appl_bad-key',
    ` appl_${'a'.repeat(27)}`,
  ])(
    'rejects malformed RevenueCat key at runtime: %s',
    (apiKey) => {
      expect(() => createSdkContext({
        buildEnv: 'production',
        platform: 'ios',
        isNativePlatform: true,
        env: { VITE_REVENUECAT_IOS_API_KEY: apiKey },
      })).toThrow('valid RevenueCat iOS public key');
    },
  );
});
