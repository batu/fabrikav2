import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  FakePurchaseProvider,
  IapService,
  type PurchaseTransaction,
  type StoreProduct,
} from "@fabrikav2/sdk/iap";
import { GEM_PACKS, type GemGrant, type GemProduct } from "../../content/shop.ts";

/**
 * The shop runs on the SDK's sandbox provider: no store account, no real money.
 * Every pack is scripted to settle on the spot, so a purchase fulfils in the
 * tick the button is pressed. Shipping real IAP swaps the provider, nothing else.
 */
const SANDBOX_API_KEY = "test_mage_master_sandbox";

function storeProduct(pack: GemProduct): StoreProduct {
  return {
    productId: pack.productId,
    title: pack.title,
    description: pack.description,
    price: Number.parseFloat(pack.displayPrice.replace(/[^\d.]/g, "")),
    priceString: pack.displayPrice,
    currencyCode: "USD",
  };
}

function transaction(productId: string): PurchaseTransaction {
  return {
    productIdentifier: productId,
    transactionId: `sandbox-${productId}`,
    purchaseToken: null,
    customerInfo: {
      allPurchasedProductIdentifiers: [productId],
      nonSubscriptionTransactions: [{ productIdentifier: productId }],
    },
  };
}

/** A ready-to-init service over the sandbox provider. DOM-free, so tests share it. */
export function createGemIapService(): IapService<GemGrant> {
  const provider = new FakePurchaseProvider({
    products: GEM_PACKS.map(storeProduct),
    purchaseResults: Object.fromEntries(GEM_PACKS.map((pack) => [pack.productId, transaction(pack.productId)])),
    // Gem packs are consumables, so a restore owns nothing. Scripting an empty
    // customerInfo makes Restore report "nothing to restore" instead of failing.
    restoreCustomerInfo: { allPurchasedProductIdentifiers: [], nonSubscriptionTransactions: [] },
  });
  return new IapService<GemGrant>({
    // The sandbox provider is not a store, but the service's platform gates
    // exist for the RevenueCat adapter — report native so it reaches `ready`.
    isNativePlatform: () => true,
    platform: () => "ios",
    apiKey: () => SANDBOX_API_KEY,
    catalogProducts: () => [...GEM_PACKS],
    provider: () => provider,
    operationTimeoutMs: () => DEFAULT_OPERATION_TIMEOUT_MS,
  });
}
