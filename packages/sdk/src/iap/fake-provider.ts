/**
 * FakePurchaseProvider — a real, scriptable `PurchaseProvider` implementation for
 * unit tests. It replaces the ~80 lines of `*ForTest` fields that v1 threaded
 * through the production `IapService`: instead of the service branching on test
 * state, tests inject this provider and drive `IapService` through its true init
 * → ready → purchase/restore path.
 *
 * Every behavior a test needs is a config knob:
 *  - `products` seed what `getProducts` returns (→ the service reaches `ready`).
 *  - `purchaseResults` / `purchaseErrors` / `hangingPurchaseProductIds` script per
 *    product what `purchaseProduct` does (resolve, throw, or never settle).
 *  - `restoreCustomerInfo` / `restoreError` / `hangRestore` script `restorePurchases`.
 *  - `purchaseDelayMs` / `restoreDelayMs` add latency for late-settle tests.
 */
import type {
  CustomerInfoLike,
  PurchaseProvider,
  PurchaseTransaction,
  StoreProduct,
} from './service.ts';

export interface FakePurchaseProviderConfig {
  products?: StoreProduct[];
  /** Per catalog productId → the transaction a successful purchase yields. */
  purchaseResults?: Record<string, PurchaseTransaction>;
  /** Per catalog productId → an error to throw instead of resolving. Pass
   *  `{ userCancelled: true }` to exercise the cancel classification. */
  purchaseErrors?: Record<string, unknown>;
  /** Catalog productIds whose purchase never settles (simulates a hung bridge). */
  hangingPurchaseProductIds?: string[];
  /** Per catalog productId → delay before resolving/throwing (ms). */
  purchaseDelayMs?: Record<string, number>;
  restoreCustomerInfo?: CustomerInfoLike;
  restoreError?: unknown;
  /** When true, `restorePurchases` never settles (simulates a hung bridge). */
  hangRestore?: boolean;
  restoreDelayMs?: number;
}

export class FakePurchaseProvider implements PurchaseProvider {
  configureCalls = 0;
  configuredApiKey: string | null = null;
  purchaseCalls: string[] = [];
  restoreCalls = 0;
  readonly listeners = new Set<(info: CustomerInfoLike) => void>();

  constructor(private config: FakePurchaseProviderConfig = {}) {}

  /** Replace the config mid-test (e.g. seed a fresh customerInfo for a restore
   * retry). Merged shallowly. */
  setConfig(patch: FakePurchaseProviderConfig): void {
    this.config = { ...this.config, ...patch };
  }

  /** Fire the registered customerInfo-update listeners (deferred-entitlement path). */
  emitCustomerInfo(info: CustomerInfoLike): void {
    for (const listener of this.listeners) listener(info);
  }

  configure(opts: { apiKey: string }): Promise<void> {
    this.configureCalls += 1;
    this.configuredApiKey = opts.apiKey;
    return Promise.resolve();
  }

  getProducts(productIds: readonly string[]): Promise<StoreProduct[]> {
    const requested = new Set(productIds);
    const products = (this.config.products ?? []).filter((product) => requested.has(product.productId));
    return Promise.resolve(products);
  }

  async purchaseProduct(productId: string): Promise<PurchaseTransaction> {
    this.purchaseCalls.push(productId);
    const delayMs = this.config.purchaseDelayMs?.[productId] ?? 0;
    if (this.config.hangingPurchaseProductIds?.includes(productId)) {
      return new Promise<PurchaseTransaction>(() => undefined);
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const error = this.config.purchaseErrors?.[productId];
    if (error !== undefined) throw error;
    const result = this.config.purchaseResults?.[productId];
    if (result === undefined) {
      throw new Error(`FakePurchaseProvider: no scripted result for '${productId}'`);
    }
    return result;
  }

  async restorePurchases(): Promise<CustomerInfoLike> {
    this.restoreCalls += 1;
    if (this.config.hangRestore === true) {
      return new Promise<CustomerInfoLike>(() => undefined);
    }
    if (this.config.restoreDelayMs !== undefined && this.config.restoreDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.restoreDelayMs));
    }
    if (this.config.restoreError !== undefined) throw this.config.restoreError;
    if (this.config.restoreCustomerInfo === undefined) {
      throw new Error('FakePurchaseProvider: no scripted restoreCustomerInfo');
    }
    return this.config.restoreCustomerInfo;
  }

  addCustomerInfoUpdateListener(cb: (info: CustomerInfoLike) => void): Promise<void> {
    this.listeners.add(cb);
    return Promise.resolve();
  }

  removeCustomerInfoUpdateListener(cb: (info: CustomerInfoLike) => void): Promise<void> {
    this.listeners.delete(cb);
    return Promise.resolve();
  }
}
