import { describe, expect, it } from 'vitest';
import {
  RevenueCatProvider,
  type RevenueCatCustomerInfo,
  type RevenueCatPurchasesPlugin,
  type RevenueCatStoreProduct,
} from './revenuecat-provider.ts';
import { ftdCatalogProducts } from './ftd-fixture.ts';

const NO_ADS = ftdCatalogProducts[0].productId;
const HINTS_10 = ftdCatalogProducts[2].productId;

function rcProduct(identifier: string, priceString = '$1.99'): RevenueCatStoreProduct {
  return { identifier, title: identifier, description: identifier, price: 1.99, priceString, currencyCode: 'USD' };
}

/** A structural stand-in for RevenueCat's `Purchases` plugin. */
class FakeRcPlugin implements RevenueCatPurchasesPlugin {
  lastPurchasedProduct: RevenueCatStoreProduct | null = null;
  constructor(
    private readonly opts: {
      products?: RevenueCatStoreProduct[];
      offeringProducts?: RevenueCatStoreProduct[];
      getProductsThrows?: boolean;
    } = {},
  ) {}
  configure(): Promise<void> { return Promise.resolve(); }
  getProducts(): Promise<{ products: RevenueCatStoreProduct[] }> {
    if (this.opts.getProductsThrows === true) return Promise.reject(new Error('store unavailable'));
    return Promise.resolve({ products: this.opts.products ?? [] });
  }
  getOfferings(): ReturnType<RevenueCatPurchasesPlugin['getOfferings']> {
    return Promise.resolve({
      all: { default: { availablePackages: (this.opts.offeringProducts ?? []).map((product) => ({ product })) } },
    });
  }
  purchaseStoreProduct(opts: { product: RevenueCatStoreProduct }): ReturnType<RevenueCatPurchasesPlugin['purchaseStoreProduct']> {
    this.lastPurchasedProduct = opts.product;
    return Promise.resolve({
      productIdentifier: opts.product.identifier,
      transaction: { transactionIdentifier: 'txn', purchaseToken: 'token' },
      customerInfo: { allPurchasedProductIdentifiers: [opts.product.identifier], nonSubscriptionTransactions: [{ productIdentifier: opts.product.identifier }] },
    });
  }
  restorePurchases(): Promise<{ customerInfo: RevenueCatCustomerInfo }> {
    return Promise.resolve({ customerInfo: { allPurchasedProductIdentifiers: [NO_ADS], nonSubscriptionTransactions: [{ productIdentifier: NO_ADS }] } });
  }
  addCustomerInfoUpdateListener(): Promise<void> { return Promise.resolve(); }
  removeCustomerInfoUpdateListener(): Promise<void> { return Promise.resolve(); }
}

describe('RevenueCatProvider — production seam mapping', () => {
  it('maps RevenueCat products/transactions/customerInfo onto SDK shapes', async () => {
    const plugin = new FakeRcPlugin({ products: [rcProduct(NO_ADS), rcProduct(HINTS_10)] });
    const provider = new RevenueCatProvider({ plugin, catalogProducts: () => ftdCatalogProducts });
    await provider.configure({ apiKey: 'appl_live_key' });

    const products = await provider.getProducts([NO_ADS, HINTS_10]);
    expect(products.map((p) => p.productId).sort()).toEqual([HINTS_10, NO_ADS].sort());

    const transaction = await provider.purchaseProduct(NO_ADS);
    expect(transaction.productIdentifier).toBe(NO_ADS);
    expect(transaction.purchaseToken).toBe('token');
    expect(transaction.customerInfo.nonSubscriptionTransactions).toEqual([{ productIdentifier: NO_ADS }]);

    const restored = await provider.restorePurchases();
    expect(restored.allPurchasedProductIdentifiers).toContain(NO_ADS);
  });
});

describe('RevenueCatProvider — sandbox test-store alias seam', () => {
  it('falls back to catalog display + routes the charge through the kind-matched alias product', async () => {
    // Sandbox key (test_) + no real products → the alias path engages.
    const plugin = new FakeRcPlugin({
      products: [],
      offeringProducts: [rcProduct('lifetime', '$0.00'), rcProduct('consumable', '$0.00')],
    });
    const provider = new RevenueCatProvider({ plugin, catalogProducts: () => ftdCatalogProducts });
    await provider.configure({ apiKey: 'test_sandbox_key' });

    // Display metadata comes from the catalog fallback (all 12 products, real prices).
    const display = await provider.getProducts(ftdCatalogProducts.map((p) => p.productId));
    expect(display).toHaveLength(12);
    expect(display.find((p) => p.productId === NO_ADS)?.priceString).toBe('$7.99');

    // An entitlement is charged via the 'lifetime' alias; a consumable via 'consumable'.
    await provider.purchaseProduct(NO_ADS);
    expect(plugin.lastPurchasedProduct?.identifier).toBe('lifetime');
    await provider.purchaseProduct(HINTS_10);
    expect(plugin.lastPurchasedProduct?.identifier).toBe('consumable');
  });

  it('a getProducts throw on a non-sandbox key propagates (no silent fallback)', async () => {
    const plugin = new FakeRcPlugin({ getProductsThrows: true });
    const provider = new RevenueCatProvider({ plugin, catalogProducts: () => ftdCatalogProducts });
    await provider.configure({ apiKey: 'appl_live_key' });
    await expect(provider.getProducts([NO_ADS])).rejects.toThrow('store unavailable');
  });
});
