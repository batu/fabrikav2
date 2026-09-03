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

  it('uses RevenueCat on native Android and never disguises fake commerce as iOS', () => {
    const android = createSdkContext({
      buildEnv: 'production',
      platform: 'android',
      isNativePlatform: true,
      env: { VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(27)}` },
    });
    expect(android.selection.iap).toBe('revenuecat');
    expect(android.iapComposition.platform()).toBe('android');

    const web = createSdkContext({ buildEnv: 'development', platform: 'web', isNativePlatform: false, env: {} });
    expect(web.iapComposition.platform()).toBe('web');
    expect(web.iapComposition.isNativePlatform()).toBe(false);
  });

  it('fails closed for production native Android without a valid public key', () => {
    expect(() => createSdkContext({
      buildEnv: 'production', platform: 'android', isNativePlatform: true, env: {},
    })).toThrow('VITE_REVENUECAT_ANDROID_API_KEY');
    expect(() => createSdkContext({
      buildEnv: 'production', platform: 'android', isNativePlatform: true,
      env: { VITE_REVENUECAT_ANDROID_API_KEY: 'test_placeholder_key' },
    })).toThrow('valid RevenueCat Android public key');
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
