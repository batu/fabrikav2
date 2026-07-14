/**
 * Proof-shell IAP catalog fixture — the minimal three-card variant of the
 * marble_run catalog pattern. The shop is a real shell surface wired to the
 * existing catalog and fake purchase-provider seams with synthetic data:
 * one purchasable sample, one restore-owned entitlement, and one locked
 * sample that ships no store metadata (so its card renders unavailable).
 * Purchases grant nothing here — fulfillment, prices, and entitlement wiring
 * stay out of the experiment scope, and shell currency never mutates.
 *
 * This file is frozen behavior input for BOTH proof games; the scope audit
 * compares its bytes across games/shell_proof_grapes and games/shell_proof_phaser.
 */
import {
  assertValidCatalog,
  type Catalog,
  type CatalogProduct,
  type CustomerInfoLike,
  type PurchaseTransaction,
  type StoreProduct,
} from "@fabrikav2/sdk/iap";

/** Proof products carry no grant: the experiment never fulfills a purchase. */
export type ProofShopPayload = null;

const STORE_PREFIX = "com.fabrika.shellproof";

function product(
  id: string,
  kind: CatalogProduct<ProofShopPayload>["kind"],
  tier: number,
  displayPrice: string,
  title: string,
  description: string,
  group = "items",
): CatalogProduct<ProofShopPayload> {
  return {
    id,
    productId: `${STORE_PREFIX}.${id}`,
    title,
    description,
    kind,
    group,
    tier,
    badges: [],
    displayPrice,
    visible: true,
    payload: null,
  };
}

export const proofCatalogProducts: CatalogProduct<ProofShopPayload>[] = [
  product("item_alpha", "consumable", 0, "$0.99", "Item A", "Sample available item."),
  product("item_beta", "entitlement", 1, "$1.99", "Item B", "Sample owned item."),
  product("item_gamma", "consumable", 2, "$4.99", "Item C", "Sample locked item."),
  // The fail-rescue bundle lives in its own group, so it never appears in the
  // Shop's `items` grid; the Fail surface reads it straight from the IAP seam.
  // It carries store metadata (below), so its card shows a real $4.99 price.
  product("rescue_bundle", "consumable", 0, "$4.99", "Rescue Bundle", "Sample recovery bundle.", "rescue"),
];

const proofCatalog: Catalog<ProofShopPayload> = { products: proofCatalogProducts };

// Fail fast at module eval if the fixture drifts out of schema.
assertValidCatalog(proofCatalog);

/** The sample item whose owned state comes back through the restore seam. */
const OWNED_PRODUCT_ID = "item_beta";
/** The sample item that ships no store metadata, so its card is unavailable. */
const LOCKED_PRODUCT_ID = "item_gamma";

/**
 * Fake store metadata for every product except the locked sample: the shop
 * reaches `ready` with live-looking prices while the locked card stays inert.
 */
export function fakeStoreProductsFromProofCatalog(): StoreProduct[] {
  return proofCatalogProducts
    .filter((catalogProduct) => catalogProduct.id !== LOCKED_PRODUCT_ID)
    .map((catalogProduct) => ({
      productId: catalogProduct.productId,
      title: catalogProduct.title,
      description: catalogProduct.description,
      price: Number(catalogProduct.displayPrice.replace(/[^0-9.]/g, "")) || 0,
      priceString: catalogProduct.displayPrice,
      currencyCode: "USD",
    }));
}

/** Store SKU of the fail-rescue bundle — the one purchasable proof product. */
export const BUNDLE_STORE_PRODUCT_ID = `${STORE_PREFIX}.rescue_bundle`;

/**
 * Scripted purchase results for the fake provider: only the fail-rescue bundle
 * is purchasable. It resolves to a deterministic transaction that grants no
 * entitlement (empty customerInfo) — the proof resumes the level but fulfils
 * nothing. Every other card stays inert (unscripted, never purchased).
 */
export function proofPurchaseResults(): Record<string, PurchaseTransaction> {
  return {
    [BUNDLE_STORE_PRODUCT_ID]: {
      productIdentifier: BUNDLE_STORE_PRODUCT_ID,
      transactionId: "proof-rescue-bundle-tx",
      purchaseToken: null,
      customerInfo: { allPurchasedProductIdentifiers: [], nonSubscriptionTransactions: [] },
    },
  };
}

/** Deterministic restore result: exactly the owned entitlement comes back. */
export function proofRestoreCustomerInfo(): CustomerInfoLike {
  const ownedStoreId = `${STORE_PREFIX}.${OWNED_PRODUCT_ID}`;
  return {
    allPurchasedProductIdentifiers: [ownedStoreId],
    nonSubscriptionTransactions: [{ productIdentifier: ownedStoreId }],
  };
}
