import { expect, it, vi } from 'vitest';
import { FakePurchaseProvider } from '@fabrikav2/sdk/iap';
vi.mock('../../src/platform/storageFallback', () => ({ runtimeStorageDurability: 'volatile' }));
import { FindTheDogIapService, ftdDefaultStoreProduct } from '../../src/shop/IapService';
import { buildFullShopCatalog } from '../../src/shop/ProductCatalog';

it('refuses a native charge when boot selected volatile fallback storage', async () => {
  const products = buildFullShopCatalog().products;
  const provider = new FakePurchaseProvider({ products: products.map(ftdDefaultStoreProduct) });
  const service = new FindTheDogIapService({ isNativePlatform: () => true,
    platform: () => 'ios', apiKey: () => 'test_key', provider: () => provider });
  service.init(); await service.initPromiseValue;
  const purchase = await service.purchase(products[0].productId);
  expect(purchase.status).toBe('unavailable');
  expect(purchase.errorMessage).toContain('durable purchase storage is unavailable');
  expect(provider.purchaseCalls).toEqual([]);
});
