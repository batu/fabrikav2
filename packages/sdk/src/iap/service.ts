/**
 * IapService — game-agnostic purchase/restore service, generalized + re-seamed
 * from v1 `games/find_the_dog/src/shop/IapService.ts` (617 lines, READ-ONLY).
 *
 * Two changes from the v1 source, no more:
 *  1. RevenueCat is hidden behind a first-class `PurchaseProvider` port (v1's
 *     `RevenueCatPurchasesPort` was already a `Pick<PurchasesPlugin, …>`; here it
 *     is promoted to an interface with a RevenueCat impl and a scriptable Fake).
 *     The RevenueCat-test-store alias plumbing that v1 kept *inside* the service
 *     is a provider concern and lives in `RevenueCatProvider` (see
 *     revenuecat-provider.ts) — the service is now provider-agnostic.
 *  2. The ~80 lines of `*ForTest` fields + `setStateForTest` are GONE. Behavior in
 *     tests comes from a real `FakePurchaseProvider` implementing the same port.
 *
 * The genuinely-hard logic — the single-flight guard, the user-cancel
 * classification, and the load-bearing late-settle restore machine — is carried
 * VERBATIM. It is subtle and battle-tested; do not "simplify" it.
 */
import { assertUniqueCatalogProductIds, type CatalogProduct } from './catalog.ts';
import { withTimeout } from './withTimeout.ts';

export type IapServiceState =
  | 'idle'
  | 'unsupported-platform'
  | 'missing-api-key'
  | 'initializing'
  | 'ready'
  | 'load-failed';

export type IapPurchaseStatus = 'purchased' | 'cancelled' | 'unavailable' | 'failed';
export type IapRestoreStatus = 'restored' | 'unavailable' | 'failed';

/**
 * Minimal structural view of a RevenueCat `CustomerInfo` — only the two fields
 * fulfillment verification reads. Declaring it locally (rather than importing the
 * native `@revenuecat/purchases-capacitor` type) keeps `tsc` + vitest running
 * WITHOUT the native package installed; the RevenueCat adapter maps the real
 * shape onto this.
 */
export interface CustomerInfoLike {
  allPurchasedProductIdentifiers: string[];
  nonSubscriptionTransactions: { productIdentifier: string }[];
}

/** Store-resolved product metadata (live price etc.), provider-neutral. */
export interface StoreProduct {
  productId: string;
  title: string;
  description: string;
  price: number;
  priceString: string;
  currencyCode: string;
}

/** Outcome of a successful native purchase, provider-neutral. */
export interface PurchaseTransaction {
  /** Store product id that actually transacted (may differ from the catalog id
   *  under the sandbox test-store alias). */
  productIdentifier: string;
  /** StoreKit/Play transaction id, if any. */
  transactionId: string | null;
  /** Play purchase token / sandbox `test_` token, if any. */
  purchaseToken: string | null;
  customerInfo: CustomerInfoLike;
}

/**
 * The provider seam. RevenueCat is one implementation; `FakePurchaseProvider` is
 * the test double. `purchaseProduct` takes the CATALOG product id — the provider
 * owns the mapping to the concrete store product it charges (including any
 * sandbox alias), so the service never touches provider-specific product objects.
 */
export interface PurchaseProvider {
  configure(opts: { apiKey: string }): Promise<void>;
  getProducts(productIds: readonly string[]): Promise<StoreProduct[]>;
  purchaseProduct(productId: string): Promise<PurchaseTransaction>;
  restorePurchases(): Promise<CustomerInfoLike>;
  addCustomerInfoUpdateListener(cb: (info: CustomerInfoLike) => void): Promise<void>;
  removeCustomerInfoUpdateListener(cb: (info: CustomerInfoLike) => void): Promise<void>;
}

export interface IapCatalogProductSnapshot<TPayload = unknown> {
  product: CatalogProduct<TPayload>;
  storeProduct: StoreProduct | null;
}

export interface IapSnapshot<TPayload = unknown> {
  state: IapServiceState;
  products: IapCatalogProductSnapshot<TPayload>[];
  pendingPurchaseProductIds: string[];
  purchaseInProgress: boolean;
  restoreInProgress: boolean;
  nativeOperationInProgress: boolean;
  lastErrorMessage: string | null;
}

export interface IapPurchaseResult {
  status: IapPurchaseStatus;
  productId: string;
  storeProductId?: string;
  purchaseId: string | null;
  purchaseToken: string | null;
  customerInfo: CustomerInfoLike | null;
  errorMessage: string | null;
}

export interface IapRestoreResult {
  status: IapRestoreStatus;
  customerInfo: CustomerInfoLike | null;
  ownedProductIds: string[];
  errorMessage: string | null;
}

export interface IapServiceDependencies<TPayload = unknown> {
  isNativePlatform: () => boolean;
  platform: () => 'android' | 'ios' | 'web';
  /** Store API key for the current platform, or null when unconfigured. A `test_`
   *  prefix selects the RevenueCat sandbox store (see `isSandboxApiKey`). */
  apiKey: () => string | null;
  catalogProducts: () => CatalogProduct<TPayload>[];
  provider: () => PurchaseProvider | Promise<PurchaseProvider>;
  operationTimeoutMs: () => number;
  purchaseTimeoutMs?: () => number;
}

export const DEFAULT_OPERATION_TIMEOUT_MS = 15_000;
export const DEFAULT_PURCHASE_TIMEOUT_MS = 60_000;
/** Generous bound for the native restorePurchases promise to settle after the
 * user-facing operation timeout has fired. Used only to guarantee the
 * `restoreInProgress` flag is cleared (and any late result captured) even when
 * the native bridge hangs — without this, a never-settling native restore
 * permanently disables every Buy button (nativeOperationInProgress stays true). */
export const RESTORE_SETTLE_TIMEOUT_MS = 60_000;

/**
 * The sandbox seam mandated by the decisions doc: a `test_`-prefixed key targets
 * the RevenueCat sandbox/test store. Exposed so callers can default to sandbox and
 * so the RevenueCat adapter can branch on it.
 */
export function isSandboxApiKey(apiKey: string): boolean {
  return apiKey.startsWith('test_');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUserCancelled(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const maybe = err as { userCancelled?: unknown; code?: unknown };
  if (maybe.userCancelled === true) return true;
  return typeof maybe.code === 'string' && maybe.code.toLowerCase().includes('cancel');
}

export function ownedProductIdsFromCustomerInfo(customerInfo: CustomerInfoLike): string[] {
  return Array.from(new Set([
    ...customerInfo.allPurchasedProductIdentifiers,
    ...customerInfo.nonSubscriptionTransactions.map((transaction) => transaction.productIdentifier),
  ]));
}

function restoredResultFromCustomerInfo(customerInfo: CustomerInfoLike): IapRestoreResult {
  return {
    status: 'restored',
    customerInfo,
    ownedProductIds: ownedProductIdsFromCustomerInfo(customerInfo),
    errorMessage: null,
  };
}

function resolveProvider(
  value: PurchaseProvider | Promise<PurchaseProvider>,
  timeoutMs: number,
): PurchaseProvider | Promise<PurchaseProvider> {
  return value instanceof Promise
    ? withTimeout(value, timeoutMs, 'purchase provider load')
    : value;
}

export class IapService<TPayload = unknown> {
  private state: IapServiceState = 'idle';
  private initPromise: Promise<void> | null = null;
  private catalogProducts: CatalogProduct<TPayload>[] = [];
  private storeProductsById: Map<string, StoreProduct> = new Map();
  private provider: PurchaseProvider | null = null;
  private lastErrorMessage: string | null = null;
  private activePurchaseProductId: string | null = null;
  private restoreInProgress = false;
  private completedRestoreResult: IapRestoreResult | null = null;
  /** customerInfo-update handler set before init(). When set, init registers a
   * provider listener that calls it on every CustomerInfo change so deferred
   * non-consumable entitlements (e.g. an Ask-to-Buy no-ads purchase approved
   * later) are recovered. Must NOT re-fulfill consumables — provider listener
   * ids differ from the purchase-path ids, which would double-grant. */
  private customerInfoHandler: ((customerInfo: CustomerInfoLike) => void) | null = null;
  private customerInfoListenerRegistered = false;

  constructor(private readonly dependencies: IapServiceDependencies<TPayload>) {}

  private purchaseTimeoutMs(): number {
    return this.dependencies.purchaseTimeoutMs?.() ?? DEFAULT_PURCHASE_TIMEOUT_MS;
  }

  /** Idempotent. Returns the in-flight (or resolved) init promise so callers —
   * and tests — can await readiness. A prior `load-failed` init is retried on the
   * next call (gated on state, not a promise-null race, so it survives a
   * synchronous provider throw). */
  init(): Promise<void> {
    if (this.initPromise === null || this.state === 'load-failed') {
      this.initPromise = this.initAsync();
    }
    return this.initPromise;
  }

  snapshot(): IapSnapshot<TPayload> {
    return {
      state: this.state,
      products: this.catalogProducts.map((product) => ({
        product,
        storeProduct: this.storeProductsById.get(product.productId) ?? null,
      })),
      pendingPurchaseProductIds: this.activePurchaseProductId === null ? [] : [this.activePurchaseProductId],
      purchaseInProgress: this.activePurchaseProductId !== null,
      restoreInProgress: this.restoreInProgress,
      nativeOperationInProgress: this.activePurchaseProductId !== null || this.restoreInProgress,
      lastErrorMessage: this.lastErrorMessage,
    };
  }

  async purchase(productId: string): Promise<IapPurchaseResult> {
    if (this.state !== 'ready') {
      return { status: 'unavailable', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: this.lastErrorMessage };
    }

    // Single-flight guard: one native store operation at a time. A concurrent
    // purchase, or a purchase during restore, is rejected — not queued.
    if (this.activePurchaseProductId !== null || this.restoreInProgress) {
      return {
        status: 'unavailable',
        productId,
        purchaseId: null,
        purchaseToken: null,
        customerInfo: null,
        errorMessage: 'native store operation already in progress',
      };
    }

    if (!this.storeProductsById.has(productId)) {
      return { status: 'unavailable', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: 'product metadata unavailable' };
    }
    const provider = this.provider;
    if (provider === null) {
      return { status: 'unavailable', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: 'IAP not initialized' };
    }

    this.activePurchaseProductId = productId;
    try {
      const transaction = await withTimeout(
        provider.purchaseProduct(productId),
        this.purchaseTimeoutMs(),
        'purchaseProduct',
      );
      return {
        status: 'purchased',
        productId,
        storeProductId: transaction.productIdentifier,
        purchaseId: transaction.transactionId,
        purchaseToken: transaction.purchaseToken,
        customerInfo: transaction.customerInfo,
        errorMessage: null,
      };
    } catch (err) {
      const message = errorMessage(err);
      this.lastErrorMessage = message;
      return {
        status: isUserCancelled(err) ? 'cancelled' : 'failed',
        productId,
        purchaseId: null,
        purchaseToken: null,
        customerInfo: null,
        errorMessage: message,
      };
    } finally {
      // Clear even on throw so a failed purchase never wedges the service.
      if (this.activePurchaseProductId === productId) {
        this.activePurchaseProductId = null;
      }
    }
  }

  consumeCompletedRestoreResult(): IapRestoreResult | null {
    const result = this.completedRestoreResult;
    this.completedRestoreResult = null;
    return result;
  }

  async restore(): Promise<IapRestoreResult> {
    if (this.state !== 'ready') {
      return { status: 'unavailable', customerInfo: null, ownedProductIds: [], errorMessage: this.lastErrorMessage };
    }

    if (this.activePurchaseProductId !== null || this.restoreInProgress) {
      return {
        status: 'unavailable',
        customerInfo: null,
        ownedProductIds: [],
        errorMessage: 'native store operation already in progress',
      };
    }

    const completedRestoreResult = this.consumeCompletedRestoreResult();
    if (completedRestoreResult !== null) return completedRestoreResult;

    const provider = this.provider;
    if (provider === null) {
      return { status: 'unavailable', customerInfo: null, ownedProductIds: [], errorMessage: 'IAP not initialized' };
    }

    this.restoreInProgress = true;
    let releaseRestoreLockInFinally = true;
    let returnedBeforeNativeSettled = false;
    try {
      const restorePromise = provider.restorePurchases();
      releaseRestoreLockInFinally = false;
      // Bound the native promise so the flag-clearing handler always runs even
      // if the bridge hangs. The user-facing result below still uses the faster
      // operationTimeoutMs; this settle bound only guarantees the lock releases
      // and any late result is captured for the next restore() call.
      void withTimeout(restorePromise, RESTORE_SETTLE_TIMEOUT_MS, 'restorePurchases settle').then(
        (customerInfo) => {
          if (returnedBeforeNativeSettled) {
            this.completedRestoreResult = restoredResultFromCustomerInfo(customerInfo);
          }
          this.restoreInProgress = false;
        },
        (err) => {
          const message = errorMessage(err);
          if (returnedBeforeNativeSettled) {
            this.lastErrorMessage = message;
            this.completedRestoreResult = { status: 'failed', customerInfo: null, ownedProductIds: [], errorMessage: message };
          }
          this.restoreInProgress = false;
        },
      );
      const customerInfo = await withTimeout(
        restorePromise,
        this.dependencies.operationTimeoutMs(),
        'restorePurchases',
      );
      return restoredResultFromCustomerInfo(customerInfo);
    } catch (err) {
      const message = errorMessage(err);
      if (this.restoreInProgress) {
        returnedBeforeNativeSettled = true;
      }
      this.lastErrorMessage = message;
      return { status: 'failed', customerInfo: null, ownedProductIds: [], errorMessage: message };
    } finally {
      if (releaseRestoreLockInFinally) {
        this.restoreInProgress = false;
      }
    }
  }

  /** Set the customerInfo-update handler. Call before init() so the listener is
   * registered during init. A late set (after init) registers immediately. */
  setOnCustomerInfoUpdate(handler: ((customerInfo: CustomerInfoLike) => void) | null): void {
    this.customerInfoHandler = handler;
    if (handler !== null && this.provider !== null) {
      this.registerCustomerInfoListener(this.provider);
    }
  }

  private registerCustomerInfoListener(provider: PurchaseProvider): void {
    const handler = this.customerInfoHandler;
    if (handler === null) return;
    if (this.customerInfoListenerRegistered) return;
    this.customerInfoListenerRegistered = true;
    const callback = (customerInfo: CustomerInfoLike): void => {
      try {
        handler(customerInfo);
      } catch (err: unknown) {
        console.warn('[iap] customerInfo update handler failed', err);
      }
    };
    void provider.addCustomerInfoUpdateListener(callback).catch((err: unknown): void => {
      console.warn('[iap] addCustomerInfoUpdateListener failed; deferred entitlements will rely on launch restore', err);
      this.customerInfoListenerRegistered = false;
    });
  }

  private async initAsync(): Promise<void> {
    if (!this.dependencies.isNativePlatform()) {
      this.state = 'unsupported-platform';
      return;
    }
    const platform = this.dependencies.platform();
    if (platform === 'web') {
      this.state = 'unsupported-platform';
      return;
    }
    const apiKey = this.dependencies.apiKey();
    if (apiKey === null) {
      this.state = 'missing-api-key';
      return;
    }

    this.state = 'initializing';
    try {
      const providerOrPromise = resolveProvider(
        this.dependencies.provider(),
        this.dependencies.operationTimeoutMs(),
      );
      const provider = providerOrPromise instanceof Promise ? await providerOrPromise : providerOrPromise;
      await withTimeout(
        provider.configure({ apiKey }),
        this.dependencies.operationTimeoutMs(),
        'provider configure',
      );
      this.catalogProducts = this.dependencies.catalogProducts();
      assertUniqueCatalogProductIds(this.catalogProducts);
      const productIds = this.catalogProducts.map((product) => product.productId);
      const storeProducts = await withTimeout(
        provider.getProducts(productIds),
        this.dependencies.operationTimeoutMs(),
        'getProducts',
      );
      this.provider = provider;
      this.storeProductsById = new Map(storeProducts.map((product) => [product.productId, product]));
      this.state = 'ready';
      this.lastErrorMessage = null;
      this.registerCustomerInfoListener(provider);
    } catch (err) {
      this.lastErrorMessage = errorMessage(err);
      // A later init() retries because it is gated on this state (matches v1's
      // retry intent).
      this.state = 'load-failed';
    }
  }
}
