/**
 * Test fixture reproducing Find The Dog's ACTUAL shop catalog (READ-ONLY v1
 * `games/find_the_dog/src/shop/ProductCatalog.ts` `buildFullShopCatalog`), lifted
 * into the game-agnostic SDK schema. This is the AC regression anchor: if the SDK
 * schema can't represent FTD's real store, the generalization failed.
 *
 * NOTE ON COUNT: the card/brainstorm said "13 products", but the real v1
 * `buildFullShopCatalog` array has exactly TWELVE (2 entitlements + 3 hint packs +
 * 6 coin packs + 1 ego offer). The fixture mirrors the source of truth, not the
 * prose. See the SURPRISES handoff note.
 *
 * FTD's per-product grant descriptor `{ noAds, hints, coins, continueLevel }` is
 * exactly what the SDK carries in the opaque `payload` — so for FTD the payload IS
 * the purchase grant, and the injected grant mappers (below) are one-liners.
 * `hints`/`coins` amounts come from remote config in v1; representative values are
 * used here (schema validation and kind/restore semantics do not depend on the
 * exact numbers).
 */
import type { CatalogProduct } from './catalog.ts';
import type { GrantForProduct, RestoreGrantForProduct } from './fulfillment.ts';

export interface FtdGrant {
  noAds: boolean;
  hints: number;
  coins: number;
  continueLevel: boolean;
}

const EMPTY: FtdGrant = { noAds: false, hints: 0, coins: 0, continueLevel: false };

type FtdProduct = CatalogProduct<FtdGrant>;

function entitlement(
  id: string,
  productId: string,
  title: string,
  description: string,
  displayPrice: string,
  tier: number,
  payload: FtdGrant,
): FtdProduct {
  return { id, productId, title, description, kind: 'entitlement', group: 'entitlements', tier, badges: [], displayPrice, visible: true, payload };
}

function hintPack(id: string, productId: string, tier: number, hints: number, displayPrice: string): FtdProduct {
  return {
    id, productId, title: `${hints} Hints`, description: `${hints} consumable hints.`,
    kind: 'consumable', group: 'hints', tier, badges: [], displayPrice, visible: true,
    payload: { ...EMPTY, hints },
  };
}

function coinPack(id: string, productId: string, tier: number, coins: number, displayPrice: string): FtdProduct {
  return {
    id, productId, title: `${coins.toLocaleString('en-US')} Coins`, description: `${coins.toLocaleString('en-US')} consumable coins.`,
    kind: 'consumable', group: 'coins', tier, badges: [], displayPrice, visible: true,
    payload: { ...EMPTY, coins },
  };
}

export const ftdCatalogProducts: FtdProduct[] = [
  entitlement('no-ads', 'com.fabrika.ftd.noads', 'No Ads', 'Removes forced and optional ad prompts under the current No-Ads rule.', '$7.99', 0, { ...EMPTY, noAds: true }),
  entitlement('no-ads-premium', 'com.fabrika.ftd.noads.premium', 'No Ads Premium', 'No-Ads entitlement plus consumable hints. Restore must not duplicate hints.', '$9.99', 1, { ...EMPTY, noAds: true, hints: 20 }),
  hintPack('hint-pack-10', 'com.fabrika.ftd.hints.10', 0, 10, '$1.99'),
  hintPack('hint-pack-25', 'com.fabrika.ftd.hints.25', 1, 25, '$4.99'),
  hintPack('hint-pack-50', 'com.fabrika.ftd.hints.50', 2, 50, '$9.99'),
  coinPack('coin-pack-1000', 'com.fabrika.ftd.coins.1000', 0, 1000, '$1.99'),
  coinPack('coin-pack-5000', 'com.fabrika.ftd.coins.5000', 1, 5000, '$7.99'),
  coinPack('coin-pack-10000', 'com.fabrika.ftd.coins.10000', 2, 10000, '$14.99'),
  coinPack('coin-pack-25000', 'com.fabrika.ftd.coins.25000', 3, 25000, '$29.99'),
  coinPack('coin-pack-50000', 'com.fabrika.ftd.coins.50000', 4, 50000, '$54.99'),
  coinPack('coin-pack-100000', 'com.fabrika.ftd.coins.100000', 5, 100000, '$99.99'),
  {
    id: 'ego-offer-level-continue-5-hints', productId: 'com.fabrika.ftd.egooffer', title: 'Level Continue Bundle',
    description: 'Fail-screen offer: continue the current level and add hints plus coins on purchase success.',
    kind: 'consumable', group: 'failOffer', tier: 0, badges: [], displayPrice: '$4.99', visible: true,
    payload: { noAds: false, hints: 5, coins: 500, continueLevel: true },
  },
];

/** For FTD the opaque payload IS the purchase grant. */
export const ftdGrantForProduct: GrantForProduct<FtdGrant, FtdGrant> = (product) => ({ ...product.payload });

/** Restore recovers only the No-Ads entitlement half — never consumable hints/coins. */
export const ftdRestoreGrantForProduct: RestoreGrantForProduct<FtdGrant, FtdGrant> = (product) =>
  product.payload.noAds ? { ...EMPTY, noAds: true } : null;
