/**
 * RevenueCatProvider — the production `PurchaseProvider` adapter. This is the ONE
 * place RevenueCat shapes are touched; the rest of the iap subtree is
 * provider-agnostic.
 *
 * The RevenueCat plugin (`@revenuecat/purchases-capacitor`'s `Purchases`) is NOT a
 * dependency of this monorepo — it arrives with a game's native shell. Rather than
 * import it (which would break `tsc`/vitest without the native package), the game
 * INJECTS the plugin and this adapter types it structurally via
 * `RevenueCatPurchasesPlugin` — exactly the surface v1 used (a `Pick` of 7
 * methods), described locally. This mirrors the haptics carry's optional-peer-dep
 * shim approach.
 *
 * It also carries v1's sandbox/test-store alias path (the seam the decisions doc
 * mandates): when a `test_` key yields no real products, display metadata falls
 * back to the catalog and the charge is routed through the store's `lifetime` /
 * `consumable` alias products from the current offerings.
 */
import type { CatalogProduct } from './catalog.ts';
import {
  isSandboxApiKey,
  type CustomerInfoLike,
  type PurchaseProvider,
  type PurchaseTransaction,
  type StoreProduct,
} from './service.ts';

/** Minimal structural view of a RevenueCat `PurchasesStoreProduct`. */
export interface RevenueCatStoreProduct {
  identifier: string;
  title: string;
  description: string;
  price: number;
  priceString: string;
  currencyCode: string;
}

export interface RevenueCatCustomerInfo {
  allPurchasedProductIdentifiers: string[];
  nonSubscriptionTransactions: { productIdentifier: string }[];
}

export interface RevenueCatOfferings {
  all: Record<string, { availablePackages: { product: RevenueCatStoreProduct }[] }>;
}

export interface RevenueCatPurchaseResult {
  productIdentifier: string;
  transaction: { transactionIdentifier: string | null; purchaseToken: string | null };
  customerInfo: RevenueCatCustomerInfo;
}

/** The 7-method structural surface v1 used (`Pick<PurchasesPlugin, …>`). */
export interface RevenueCatPurchasesPlugin {
  configure(opts: { apiKey: string }): Promise<void>;
  getProducts(opts: { productIdentifiers: string[]; type?: string }): Promise<{ products: RevenueCatStoreProduct[] }>;
  getOfferings(): Promise<RevenueCatOfferings>;
  purchaseStoreProduct(opts: { product: RevenueCatStoreProduct }): Promise<RevenueCatPurchaseResult>;
  restorePurchases(): Promise<{ customerInfo: RevenueCatCustomerInfo }>;
  addCustomerInfoUpdateListener(cb: (info: RevenueCatCustomerInfo) => void): Promise<void>;
  removeCustomerInfoUpdateListener(cb: (info: RevenueCatCustomerInfo) => void): Promise<void>;
}

export interface RevenueCatProviderOptions<TPayload> {
  plugin: RevenueCatPurchasesPlugin;
  /** The catalog — needed to build display fallbacks and route sandbox aliases. */
  catalogProducts: () => CatalogProduct<TPayload>[];
}

/** RevenueCat's non-subscription product category value. */
const NON_SUBSCRIPTION = 'NON_SUBSCRIPTION';

function toStoreProduct(product: RevenueCatStoreProduct): StoreProduct {
  return {
    productId: product.identifier,
    title: product.title,
    description: product.description,
    price: product.price,
    priceString: product.priceString,
    currencyCode: product.currencyCode,
  };
}

function toCustomerInfoLike(info: RevenueCatCustomerInfo): CustomerInfoLike {
  return {
    allPurchasedProductIdentifiers: info.allPurchasedProductIdentifiers,
    nonSubscriptionTransactions: info.nonSubscriptionTransactions.map((transaction) => ({
      productIdentifier: transaction.productIdentifier,
    })),
  };
}

function displayPriceValue(displayPrice: string): number {
  const parsed = Number(displayPrice.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function catalogFallbackProduct<TPayload>(product: CatalogProduct<TPayload>): RevenueCatStoreProduct {
  return {
    identifier: product.productId,
    title: product.title,
    description: product.description,
    price: displayPriceValue(product.displayPrice),
    priceString: product.displayPrice,
    currencyCode: 'USD',
  };
}

export class RevenueCatProvider<TPayload = unknown> implements PurchaseProvider {
  private apiKey: string | null = null;
  /** Concrete store products to CHARGE, keyed by CATALOG productId. Under the
   *  sandbox alias path this points at the `lifetime`/`consumable` alias product. */
  private purchaseProductByCatalogId = new Map<string, RevenueCatStoreProduct>();
  private readonly listenerWrappers = new Map<
    (info: CustomerInfoLike) => void,
    (info: RevenueCatCustomerInfo) => void
  >();

  constructor(private readonly options: RevenueCatProviderOptions<TPayload>) {}

  async configure(opts: { apiKey: string }): Promise<void> {
    this.apiKey = opts.apiKey;
    await this.options.plugin.configure(opts);
  }

  async getProducts(productIds: readonly string[]): Promise<StoreProduct[]> {
    const apiKey = this.apiKey;
    const sandbox = apiKey !== null && isSandboxApiKey(apiKey);
    try {
      const { products } = await this.options.plugin.getProducts({
        productIdentifiers: [...productIds],
        type: NON_SUBSCRIPTION,
      });
      if (products.length > 0 || !sandbox) {
        this.purchaseProductByCatalogId = new Map(products.map((product) => [product.identifier, product]));
        return products.map(toStoreProduct);
      }
    } catch (err) {
      if (!sandbox) throw err;
    }
    return this.loadSandboxAliasProducts();
  }

  async purchaseProduct(productId: string): Promise<PurchaseTransaction> {
    const product = this.purchaseProductByCatalogId.get(productId);
    if (product === undefined) {
      throw new Error(`RevenueCatProvider: no store product for '${productId}'`);
    }
    const result = await this.options.plugin.purchaseStoreProduct({ product });
    return {
      productIdentifier: result.productIdentifier,
      transactionId: result.transaction.transactionIdentifier,
      purchaseToken: result.transaction.purchaseToken,
      customerInfo: toCustomerInfoLike(result.customerInfo),
    };
  }

  async restorePurchases(): Promise<CustomerInfoLike> {
    const { customerInfo } = await this.options.plugin.restorePurchases();
    return toCustomerInfoLike(customerInfo);
  }

  async addCustomerInfoUpdateListener(cb: (info: CustomerInfoLike) => void): Promise<void> {
    const wrapper = (info: RevenueCatCustomerInfo): void => cb(toCustomerInfoLike(info));
    this.listenerWrappers.set(cb, wrapper);
    await this.options.plugin.addCustomerInfoUpdateListener(wrapper);
  }

  async removeCustomerInfoUpdateListener(cb: (info: CustomerInfoLike) => void): Promise<void> {
    const wrapper = this.listenerWrappers.get(cb);
    if (wrapper === undefined) return;
    this.listenerWrappers.delete(cb);
    await this.options.plugin.removeCustomerInfoUpdateListener(wrapper);
  }

  /**
   * Sandbox seam: the RevenueCat test store exposes generic `lifetime` /
   * `consumable` alias products rather than the app's real SKUs. Display metadata
   * falls back to the catalog; each catalog product is routed to the alias product
   * matching its kind so a sandbox purchase actually charges.
   */
  private async loadSandboxAliasProducts(): Promise<StoreProduct[]> {
    const catalog = this.options.catalogProducts();
    const aliasById = await this.loadAliasProducts();
    this.purchaseProductByCatalogId = new Map(
      catalog.map((product) => {
        const aliasId = product.kind === 'entitlement' ? 'lifetime' : 'consumable';
        const alias = aliasById.get(aliasId) ?? catalogFallbackProduct({ ...product, productId: aliasId });
        return [product.productId, alias];
      }),
    );
    return catalog.map((product) => toStoreProduct(catalogFallbackProduct(product)));
  }

  private async loadAliasProducts(): Promise<Map<string, RevenueCatStoreProduct>> {
    try {
      const offerings = await this.options.plugin.getOfferings();
      const products = Object.values(offerings.all).flatMap((offering) =>
        offering.availablePackages.map((pkg) => pkg.product),
      );
      return new Map(products.map((product) => [product.identifier, product]));
    } catch {
      return new Map();
    }
  }
}
