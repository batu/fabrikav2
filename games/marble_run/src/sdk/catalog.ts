/**
 * Marble Run IAP catalog fixture — the minimal marble variant of the reference
 * shape in `@fabrikav2/sdk/iap`'s `ftd-fixture.ts` (which is an AC regression
 * fixture, not a barrel export, so its pattern is copied here rather than
 * imported). Two product families: a single no-ads `entitlement` and three
 * coin-pack `consumable`s. The opaque catalog `payload` IS the grant (the FTD
 * idiom), so the grant mappers are one-liners.
 *
 * Product ids are store-facing (reverse-dns); the catalog `id` is the stable
 * short key the game.config.ts productCatalog list and the shop DOM reference.
 */
import {
  assertValidCatalog,
  type Catalog,
  type CatalogProduct,
  type GrantForProduct,
  type RestoreGrantForProduct,
  type StoreProduct,
} from '@fabrikav2/sdk/iap';

/** What a marble_run product grants. `noAds` is the durable entitlement; `coins`
 *  is the consumable soft-currency amount. */
export interface MarbleGrant {
  readonly noAds: boolean;
  readonly coins: number;
}

const STORE_PREFIX = 'com.fabrika.marble_run';

function entitlement(
  id: string,
  displayPrice: string,
  title: string,
  description: string,
  payload: MarbleGrant,
): CatalogProduct<MarbleGrant> {
  return {
    id,
    productId: `${STORE_PREFIX}.${id}`,
    title,
    description,
    kind: 'entitlement',
    group: 'entitlements',
    tier: 0,
    badges: [],
    displayPrice,
    visible: true,
    payload,
  };
}

function coinPack(
  id: string,
  tier: number,
  displayPrice: string,
  coins: number,
  title: string,
  description: string,
): CatalogProduct<MarbleGrant> {
  return {
    id,
    productId: `${STORE_PREFIX}.${id}`,
    title,
    description,
    kind: 'consumable',
    group: 'coins',
    tier,
    badges: tier === 1 ? ['popular'] : [],
    displayPrice,
    visible: true,
    payload: { noAds: false, coins },
  };
}

/** The no-ads product id, referenced by the interstitial-cadence entitlement gate. */
export const NO_ADS_PRODUCT_ID = 'no_ads';

export const marbleCatalogProducts: CatalogProduct<MarbleGrant>[] = [
  entitlement(
    NO_ADS_PRODUCT_ID,
    '$2.99',
    'Remove Ads',
    'Turn off interstitial ads forever.',
    { noAds: true, coins: 0 },
  ),
  coinPack('coins_small', 0, '$0.99', 500, 'Pouch of Coins', '500 coins'),
  coinPack('coins_medium', 1, '$1.99', 1500, 'Bag of Coins', '1,500 coins'),
  coinPack('coins_large', 2, '$4.99', 5000, 'Chest of Coins', '5,000 coins'),
];

export const marbleCatalog: Catalog<MarbleGrant> = { products: marbleCatalogProducts };

// Fail fast at module eval if the fixture drifts out of schema (AC: catalog valid).
assertValidCatalog(marbleCatalog);

/** The stable catalog `id` list for game.config.ts `productCatalog`. */
export const marbleProductIds: readonly string[] = marbleCatalogProducts.map((p) => p.id);

/** Payload-is-grant (FTD idiom): a purchase grants exactly the product's payload. */
export const marbleGrantForProduct: GrantForProduct<MarbleGrant, MarbleGrant> = (product) => ({
  ...product.payload,
});

/** Restore recovers only the durable entitlement half — never consumable coins. */
export const marbleRestoreGrantForProduct: RestoreGrantForProduct<MarbleGrant, MarbleGrant> = (
  product,
) => (product.payload.noAds ? { noAds: true, coins: 0 } : null);

/**
 * Derive fake `StoreProduct`s from the catalog so the web/CI `FakePurchaseProvider`
 * reports the shop as `ready` with live-looking prices (no real store metadata on
 * web). Native builds get real prices from RevenueCat instead.
 */
export function fakeStoreProductsFromCatalog(): StoreProduct[] {
  return marbleCatalogProducts.map((product) => ({
    productId: product.productId,
    title: product.title,
    description: product.description,
    price: Number(product.displayPrice.replace(/[^0-9.]/g, '')) || 0,
    priceString: product.displayPrice,
    currencyCode: 'USD',
  }));
}
