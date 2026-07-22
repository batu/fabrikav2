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
import { isTimeoutError, withTimeout } from '../with-timeout.ts';

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
 * Classification of a `failed` purchase: OUR `withTimeout` firing (`timeout`)
 * vs the store/provider rejecting (`store-error`). The 2026-06 UA test lost
 * 124/124 purchase attempts with no way to tell these apart — analytics must
 * carry the distinction, so the service classifies at the throw site where the
 * error type is still known.
 */
export type IapFailureKind = 'timeout' | 'store-error';

/**
 * Observability events for the purchase pipeline. Emitted synchronously via the
 * optional `onEvent` dependency; a throwing listener is swallowed (telemetry
 * must never break a purchase). `purchase_dispatched` fires immediately before
 * the provider purchase call — i.e. when the native payment sheet is requested —
 * so a funnel can separate "user tapped" from "sheet actually dispatched".
 */
export type IapServiceEvent =
  | { type: 'state_changed'; state: IapServiceState; reason: string | null }
  | { type: 'purchase_dispatched'; productId: string };

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
  /** Present only when `status === 'failed'`: timeout vs store rejection. */
  failureKind?: IapFailureKind;
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
  /** Optional purchase-pipeline observer (analytics). Must not throw; a throw is
   *  swallowed so telemetry can never break a purchase or init. */
  onEvent?: (event: IapServiceEvent) => void;
}

export const DEFAULT_OPERATION_TIMEOUT_MS = 15_000;
export const DEFAULT_PURCHASE_TIMEOUT_MS = 60_000;

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
  /** A purchase result whose native promise settled AFTER its caller-facing
   * timeout returned. Banked here — never discarded — so the next purchase() of
   * the same product observes the real outcome instead of issuing a second
   * charge. Mirrors `completedRestoreResult` for the restore path. */
  private completedPurchaseResultsByProductId = new Map<string, IapPurchaseResult>();
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

  private emitEvent(event: IapServiceEvent): void {
    try {
      this.dependencies.onEvent?.(event);
    } catch {
      // Telemetry must never break the purchase pipeline.
    }
  }

  private setState(state: IapServiceState, reason: string | null): void {
    if (this.state === state) return;
    this.state = state;
    this.emitEvent({ type: 'state_changed', state, reason });
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

  /** Bank a late-settled purchase result for `productId` (the caller already
   * timed out), or null. Consumed by the next purchase() of that product so a
   * timeout-then-retry observes the real outcome rather than double-charging. */
  consumeCompletedPurchaseResult(productId: string): IapPurchaseResult | null {
    const result = this.completedPurchaseResultsByProductId.get(productId) ?? null;
    if (result === null) return null;
    this.completedPurchaseResultsByProductId.delete(productId);
    return result;
  }

  private purchasedResult(productId: string, transaction: PurchaseTransaction): IapPurchaseResult {
    return {
      status: 'purchased',
      productId,
      storeProductId: transaction.productIdentifier,
      purchaseId: transaction.transactionId,
      purchaseToken: transaction.purchaseToken,
      customerInfo: transaction.customerInfo,
      errorMessage: null,
    };
  }

  private failedPurchaseResult(productId: string, err: unknown, message: string): IapPurchaseResult {
    if (isUserCancelled(err)) {
      return { status: 'cancelled', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: message };
    }
    // A definitive native rejection is a store error; the timeout kind is set at
    // the caller-timeout return site, never here.
    return { status: 'failed', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: message, failureKind: 'store-error' };
  }

  async purchase(productId: string): Promise<IapPurchaseResult> {
    if (this.state !== 'ready') {
      return { status: 'unavailable', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: this.lastErrorMessage };
    }

    // Single-flight guard: one native store operation at a time. A concurrent
    // purchase, or a purchase during restore, is rejected — not queued. The lock
    // is held until the RAW native promise settles (see below), so a retry after a
    // caller timeout lands here and cannot issue a second charge.
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

    // A native purchase that settled after its caller timed out is banked, not
    // discarded: return it here instead of charging again.
    const banked = this.consumeCompletedPurchaseResult(productId);
    if (banked !== null) return banked;

    if (!this.storeProductsById.has(productId)) {
      return { status: 'unavailable', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: 'product metadata unavailable' };
    }
    const provider = this.provider;
    if (provider === null) {
      return { status: 'unavailable', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: 'IAP not initialized' };
    }

    this.activePurchaseProductId = productId;
    this.emitEvent({ type: 'purchase_dispatched', productId });
    let returnedBeforeNativeSettled = false;
    // Observe the RAW native promise, NOT the caller-facing `withTimeout` race. A
    // JavaScript timeout does not cancel the native store operation, so releasing
    // the lock when the timer wins (the old `finally`) let a retry start a second
    // charge while the first was still live. Ownership is released only when the
    // native promise itself settles; a late result is banked for delivery.
    // Normalize even a contract-violating synchronous provider throw into the
    // native promise. That keeps settlement and lock release on the same path.
    const purchasePromise = Promise.resolve().then(() => provider.purchaseProduct(productId));
    void purchasePromise.then(
      (transaction) => {
        if (returnedBeforeNativeSettled) {
          this.completedPurchaseResultsByProductId.set(productId, this.purchasedResult(productId, transaction));
        }
        if (this.activePurchaseProductId === productId) this.activePurchaseProductId = null;
      },
      (err: unknown) => {
        const message = errorMessage(err);
        if (returnedBeforeNativeSettled) {
          this.lastErrorMessage = message;
          this.completedPurchaseResultsByProductId.set(productId, this.failedPurchaseResult(productId, err, message));
        }
        if (this.activePurchaseProductId === productId) this.activePurchaseProductId = null;
      },
    );

    try {
      const transaction = await withTimeout(purchasePromise, this.purchaseTimeoutMs(), 'purchaseProduct');
      return this.purchasedResult(productId, transaction);
    } catch (err) {
      const message = errorMessage(err);
      this.lastErrorMessage = message;
      if (isTimeoutError(err)) {
        // The caller-facing wait elapsed but the native operation is still live.
        // Keep the lock (never released by a timer) so a retry cannot double-charge;
        // the raw-promise observer above will bank the eventual result and release.
        returnedBeforeNativeSettled = true;
        return { status: 'failed', productId, purchaseId: null, purchaseToken: null, customerInfo: null, errorMessage: message, failureKind: 'timeout' };
      }
      // A definitive native rejection: the raw-promise observer already released
      // the lock. Report cancel vs failure to the still-waiting caller.
      return this.failedPurchaseResult(productId, err, message);
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
      // Observe the RAW native promise, not a watchdog race. A JavaScript timer
      // does not cancel restorePurchases(); releasing `restoreInProgress` when a
      // settle bound elapsed (the old behavior) reopened the shared gate while the
      // native restore was still live, letting a purchase overlap it. Ownership is
      // released only when the native promise itself settles; a late result is
      // banked for the next restore() call. A truly hung bridge keeps the gate
      // closed (fail-closed) until the process restarts.
      void restorePromise.then(
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
      this.setState('unsupported-platform', 'not a native platform');
      return;
    }
    const platform = this.dependencies.platform();
    if (platform === 'web') {
      this.setState('unsupported-platform', 'web platform');
      return;
    }
    const apiKey = this.dependencies.apiKey();
    if (apiKey === null) {
      this.setState('missing-api-key', 'no store API key configured');
      return;
    }

    this.setState('initializing', null);
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
      this.lastErrorMessage = null;
      this.setState('ready', storeProducts.length === 0 ? 'ready with zero store products' : null);
      this.registerCustomerInfoListener(provider);
    } catch (err) {
      this.lastErrorMessage = errorMessage(err);
      // A later init() retries because it is gated on this state (matches v1's
      // retry intent).
      this.setState('load-failed', this.lastErrorMessage);
    }
  }
}
