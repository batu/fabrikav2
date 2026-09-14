import { describe, expect, it, vi } from 'vitest';
import {
  RevenueCatPurchaseError,
  isRevenueCatUserCancelledError,
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
      purchaseRejectsWith?: unknown;
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
    if (this.opts.purchaseRejectsWith !== undefined) return Promise.reject(this.opts.purchaseRejectsWith);
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
  it('emits verified revenue only after RevenueCat purchase success', async () => {
    const plugin = new FakeRcPlugin({ products: [rcProduct(NO_ADS)] });
    const verified = vi.fn();
    const provider = new RevenueCatProvider({ plugin, catalogProducts: () => ftdCatalogProducts, onVerifiedPurchase: verified });
    await provider.configure({ apiKey: 'appl_live_key' });
    await provider.getProducts([NO_ADS]);
    await provider.purchaseProduct(NO_ADS);
    expect(verified).toHaveBeenCalledWith({ productId: NO_ADS, revenue: 1.99, currency: 'USD', transactionId: 'txn' });
  });
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

/** Exact shape the Capacitor iOS bridge hands JS for a RevenueCat rejection:
 *  `PurchasesPlugin.rejectWithErrorContainer` → `call.reject(message, "\(code)", nsError)`
 *  → `JSResultError.jsonPayload()` `{ message, errorMessage, code }` → native-bridge
 *  copies those keys onto a `CapacitorException`. No `userCancelled`, no
 *  `readableErrorCode`, and `code` is the numeric RevenueCat code as a STRING. */
function bridgeRejection(message: string, code: string): Error {
  return Object.assign(new Error(message), { errorMessage: message, code });
}

describe('RevenueCatProvider — purchase rejection classification', () => {
  async function providerWith(purchaseRejectsWith: unknown) {
    const plugin = new FakeRcPlugin({ products: [rcProduct(NO_ADS)], purchaseRejectsWith });
    const provider = new RevenueCatProvider({ plugin, catalogProducts: () => ftdCatalogProducts });
    await provider.configure({ apiKey: 'appl_live' });
    await provider.getProducts([NO_ADS]);
    return provider;
  }

  it('classifies the iOS bridge shape of a user cancel (string code "1", no userCancelled)', async () => {
    const provider = await providerWith(bridgeRejection('Purchase was cancelled.', '1'));
    const err = await provider.purchaseProduct(NO_ADS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RevenueCatPurchaseError);
    expect((err as RevenueCatPurchaseError).userCancelled).toBe(true);
    expect((err as RevenueCatPurchaseError).message).toBe('Purchase was cancelled.');
    expect((err as RevenueCatPurchaseError).code).toBe('1');
  });

  it('classifies the documented PurchasesError shape of a user cancel', async () => {
    const provider = await providerWith({
      code: 1,
      message: 'Purchase was cancelled.',
      readableErrorCode: 'PURCHASE_CANCELLED_ERROR',
      userCancelled: true,
      underlyingErrorMessage: '',
    });
    const err = await provider.purchaseProduct(NO_ADS).catch((e: unknown) => e);
    expect((err as RevenueCatPurchaseError).userCancelled).toBe(true);
    expect((err as RevenueCatPurchaseError).readableErrorCode).toBe('PURCHASE_CANCELLED_ERROR');
  });

  it('keeps a real store error as a non-cancel with its message and code', async () => {
    const provider = await providerWith(bridgeRejection('There was a problem with the App Store.', '2'));
    const err = await provider.purchaseProduct(NO_ADS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RevenueCatPurchaseError);
    expect((err as RevenueCatPurchaseError).userCancelled).toBe(false);
    expect((err as RevenueCatPurchaseError).message).toBe('There was a problem with the App Store.');
    expect((err as RevenueCatPurchaseError).code).toBe('2');
  });

  it('does not treat unrelated codes or messages as cancels', () => {
    expect(isRevenueCatUserCancelledError(bridgeRejection('The product is not available for purchase.', '5'))).toBe(false);
    expect(isRevenueCatUserCancelledError(new Error('network down'))).toBe(false);
    expect(isRevenueCatUserCancelledError('1')).toBe(false);
    expect(isRevenueCatUserCancelledError({ code: 10 })).toBe(false);
  });

  it('reads a cancel nested under a bridge data payload', () => {
    expect(isRevenueCatUserCancelledError({ message: 'x', code: 'PLUGIN', data: { readableErrorCode: 'PURCHASE_CANCELLED' } })).toBe(true);
  });
});
