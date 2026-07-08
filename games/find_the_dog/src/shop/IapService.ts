import {
  FakePurchaseProvider,
  IapService as SdkIapService,
  ownedProductIdsFromCustomerInfo,
  type CatalogProduct,
  type CustomerInfoLike,
  type IapPurchaseResult,
  type IapRestoreResult,
  type IapServiceState,
  type PurchaseTransaction,
  type StoreProduct,
} from '@fabrikav2/sdk/iap';
import { buildShopCatalog, type ShopCatalogProduct } from './ProductCatalog';

export type {
  IapPurchaseResult,
  IapRestoreResult,
  IapServiceState,
};
export type CustomerInfo = CustomerInfoLike;

export interface IapStoreProductSnapshot {
  productId: string;
  title: string;
  description: string;
  price: number;
  priceString: string;
  currencyCode: string;
}

export interface IapCatalogProductSnapshot extends ShopCatalogProduct {
  storeProduct: IapStoreProductSnapshot | null;
}

export interface IapSnapshot {
  state: IapServiceState;
  products: IapCatalogProductSnapshot[];
  pendingPurchaseProductIds: string[];
  purchaseInProgress: boolean;
  restoreInProgress: boolean;
  nativeOperationInProgress: boolean;
  lastErrorMessage: string | null;
}

export interface IapTestState {
  state: IapServiceState;
  products?: IapStoreProductSnapshot[];
  purchaseResultsByProductId?: Record<string, IapPurchaseResult>;
  purchaseDelayMsByProductId?: Record<string, number>;
  pendingPurchaseProductIds?: string[];
  restoreResult?: IapRestoreResult;
  pendingRestore?: boolean;
  keepRestoreInProgressAfterTestResult?: boolean;
  completedRestoreResult?: IapRestoreResult;
  lastErrorMessage?: string | null;
}

interface FtdIapGrant {
  readonly source: ShopCatalogProduct;
}

const SANDBOX_API_KEY = 'test_find_the_dog_sandbox';

function catalogProduct(product: ShopCatalogProduct, tier: number): CatalogProduct<FtdIapGrant> {
  return {
    id: product.id,
    productId: product.productId,
    title: product.title,
    description: product.description,
    kind: product.purchaseType === 'nonConsumable' ? 'entitlement' : 'consumable',
    group: product.group,
    tier,
    badges: [],
    displayPrice: product.displayPrice,
    visible: product.visible,
    payload: { source: product },
  };
}

function defaultStoreProduct(product: ShopCatalogProduct): StoreProduct {
  return {
    productId: product.productId,
    title: product.title,
    description: product.description,
    price: Number(product.displayPrice.replace(/[^0-9.]/g, '')) || 0,
    priceString: product.displayPrice,
    currencyCode: 'USD',
  };
}

function toCustomerInfo(productId: string): CustomerInfoLike {
  return {
    allPurchasedProductIdentifiers: [productId],
    nonSubscriptionTransactions: [{ productIdentifier: productId }],
  };
}

function toPurchaseTransaction(result: IapPurchaseResult): PurchaseTransaction {
  const storeProductId = result.storeProductId ?? result.productId;
  return {
    productIdentifier: storeProductId,
    transactionId: result.purchaseId,
    purchaseToken: result.purchaseToken,
    customerInfo: result.customerInfo ?? toCustomerInfo(storeProductId),
  };
}

export class FindTheDogIapService {
  private readonly fakeProvider = new FakePurchaseProvider();
  private service = this.createSdkService();
  private initPromise: Promise<void> | null = null;

  get initPromiseValue(): Promise<void> | null {
    return this.initPromise;
  }

  init(): void {
    if (this.initPromise === null) {
      this.configureFakeProducts();
      this.initPromise = this.service.init();
    }
  }

  setOnCustomerInfoUpdate(handler: ((customerInfo: CustomerInfoLike) => void) | null): void {
    this.service.setOnCustomerInfoUpdate(handler);
  }

  setStateForTest(state: IapTestState): void {
    const purchaseResults: Record<string, PurchaseTransaction> = {};
    for (const [productId, result] of Object.entries(state.purchaseResultsByProductId ?? {})) {
      if (result.status === 'purchased') purchaseResults[productId] = toPurchaseTransaction(result);
    }
    this.fakeProvider.setConfig({
      products: state.products?.map((product) => ({ ...product })) ?? this.defaultStoreProducts(),
      purchaseResults,
      purchaseDelayMs: state.purchaseDelayMsByProductId,
      restoreCustomerInfo: state.restoreResult?.customerInfo ?? undefined,
      restoreError: state.restoreResult?.status === 'failed'
        ? new Error(state.restoreResult.errorMessage ?? 'restore failed')
        : undefined,
      hangRestore: state.pendingRestore,
    });
    if (this.initPromise === null) this.init();
  }

  snapshot(): IapSnapshot {
    const snapshot = this.service.snapshot();
    return {
      ...snapshot,
      products: snapshot.products.map(({ product, storeProduct }) => ({
        ...product.payload.source,
        storeProduct: storeProduct === null ? null : { ...storeProduct },
      })),
    };
  }

  async purchase(productId: string): Promise<IapPurchaseResult> {
    return this.service.purchase(productId);
  }

  async restore(): Promise<IapRestoreResult> {
    return this.service.restore();
  }

  consumeCompletedRestoreResult(): IapRestoreResult | null {
    return this.service.consumeCompletedRestoreResult();
  }

  private createSdkService(): SdkIapService<FtdIapGrant> {
    return new SdkIapService<FtdIapGrant>({
      isNativePlatform: () => true,
      platform: () => 'ios',
      apiKey: () => SANDBOX_API_KEY,
      catalogProducts: () => buildShopCatalog().products.map(catalogProduct),
      provider: () => this.fakeProvider,
      operationTimeoutMs: () => 15_000,
      purchaseTimeoutMs: () => 60_000,
    });
  }

  private defaultStoreProducts(): StoreProduct[] {
    return buildShopCatalog().products.map(defaultStoreProduct);
  }

  private configureFakeProducts(): void {
    this.fakeProvider.setConfig({ products: this.defaultStoreProducts() });
  }
}

export { ownedProductIdsFromCustomerInfo };
export const iapService = new FindTheDogIapService();
