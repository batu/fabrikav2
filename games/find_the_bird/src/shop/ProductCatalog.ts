import { remoteConfigService } from '../config/RemoteConfigService';
import type { RemoteConfigValues } from '../config/remoteConfigSchema';

export type ShopProductKind = 'noAds' | 'noAdsPremium' | 'hintPack' | 'coinPack' | 'egoOffer';
export type ShopPurchaseType = 'nonConsumable' | 'consumable' | 'mixed';
export type ShopProductGroup = 'entitlements' | 'hints' | 'coins' | 'failOffer';

export interface ShopCatalogProduct {
  id: string;
  title: string;
  kind: ShopProductKind;
  group: ShopProductGroup;
  purchaseType: ShopPurchaseType;
  displayPrice: string;
  productId: string;
  hintAmount: number;
  coinAmount: number;
  grantsNoAds: boolean;
  visible: boolean;
  description: string;
}

export interface ShopCatalog {
  products: ShopCatalogProduct[];
}

interface CatalogReader {
  value<TKey extends keyof RemoteConfigValues>(key: TKey): RemoteConfigValues[TKey];
}

const REQUIREMENT_DISPLAY_PRICES = {
  noAds: '$7.99',
  noAdsPremium: '$9.99',
  hintPack10: '$1.99',
  hintPack25: '$4.99',
  hintPack50: '$9.99',
  coinPack1000: '$1.99',
  coinPack5000: '$7.99',
  coinPack10000: '$14.99',
  coinPack25000: '$29.99',
  coinPack50000: '$54.99',
  coinPack100000: '$99.99',
  egoOffer: '$4.99',
} as const;

export function buildFullShopCatalog(reader: CatalogReader = remoteConfigService): ShopCatalog {
  const products: ShopCatalogProduct[] = [
    {
      id: 'no-ads',
      title: 'No Ads',
      kind: 'noAds',
      group: 'entitlements',
      purchaseType: 'nonConsumable',
      displayPrice: REQUIREMENT_DISPLAY_PRICES.noAds,
      productId: reader.value('noAdsProductId'),
      hintAmount: 0,
      coinAmount: 0,
      grantsNoAds: true,
      visible: reader.value('noAdsVisible'),
      description: 'Removes forced and optional ad prompts under the current No-Ads rule.',
    },
    {
      id: 'no-ads-premium',
      title: 'No Ads Premium',
      kind: 'noAdsPremium',
      group: 'entitlements',
      purchaseType: 'mixed',
      displayPrice: REQUIREMENT_DISPLAY_PRICES.noAdsPremium,
      productId: reader.value('noAdsPremiumProductId'),
      hintAmount: reader.value('noAdsPremiumHintAmount'),
      coinAmount: 0,
      grantsNoAds: true,
      visible: reader.value('noAdsPremiumVisible'),
      description: 'No-Ads entitlement plus consumable hints. Restore must not duplicate hints.',
    },
    hintPack('hint-pack-10', '10 Hints', REQUIREMENT_DISPLAY_PRICES.hintPack10, reader.value('hintPack10ProductId'), reader.value('hintPack10HintAmount'), reader.value('hintPack10Visible')),
    hintPack('hint-pack-25', '25 Hints', REQUIREMENT_DISPLAY_PRICES.hintPack25, reader.value('hintPack25ProductId'), reader.value('hintPack25HintAmount'), reader.value('hintPack25Visible')),
    hintPack('hint-pack-50', '50 Hints', REQUIREMENT_DISPLAY_PRICES.hintPack50, reader.value('hintPack50ProductId'), reader.value('hintPack50HintAmount'), reader.value('hintPack50Visible')),
    coinPack('coin-pack-1000', '1,000 Coins', REQUIREMENT_DISPLAY_PRICES.coinPack1000, reader.value('coinPack1000ProductId'), reader.value('coinPack1000CoinAmount'), reader.value('coinPack1000Visible')),
    coinPack('coin-pack-5000', '5,000 Coins', REQUIREMENT_DISPLAY_PRICES.coinPack5000, reader.value('coinPack5000ProductId'), reader.value('coinPack5000CoinAmount'), reader.value('coinPack5000Visible')),
    coinPack('coin-pack-10000', '10,000 Coins', REQUIREMENT_DISPLAY_PRICES.coinPack10000, reader.value('coinPack10000ProductId'), reader.value('coinPack10000CoinAmount'), reader.value('coinPack10000Visible')),
    coinPack('coin-pack-25000', '25,000 Coins', REQUIREMENT_DISPLAY_PRICES.coinPack25000, reader.value('coinPack25000ProductId'), reader.value('coinPack25000CoinAmount'), reader.value('coinPack25000Visible')),
    coinPack('coin-pack-50000', '50,000 Coins', REQUIREMENT_DISPLAY_PRICES.coinPack50000, reader.value('coinPack50000ProductId'), reader.value('coinPack50000CoinAmount'), reader.value('coinPack50000Visible')),
    coinPack('coin-pack-100000', '100,000 Coins', REQUIREMENT_DISPLAY_PRICES.coinPack100000, reader.value('coinPack100000ProductId'), reader.value('coinPack100000CoinAmount'), reader.value('coinPack100000Visible')),
    {
      id: 'ego-offer-level-continue-5-hints',
      title: 'Level Continue Bundle',
      kind: 'egoOffer',
      group: 'failOffer',
      purchaseType: 'mixed',
      displayPrice: REQUIREMENT_DISPLAY_PRICES.egoOffer,
      productId: reader.value('egoOfferProductId'),
      hintAmount: reader.value('egoOfferHintAmount'),
      coinAmount: reader.value('egoOfferCoinAmount'),
      grantsNoAds: false,
      visible: reader.value('egoOfferEnabled'),
      description: 'Fail-screen offer: continue the current level and add hints plus coins on purchase success.',
    },
  ];

  return { products };
}

export function buildShopCatalog(reader: CatalogReader = remoteConfigService): ShopCatalog {
  return { products: buildFullShopCatalog(reader).products.filter((product) => product.visible) };
}

export function duplicateCatalogProductIds(products: readonly ShopCatalogProduct[]): string[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    counts.set(product.productId, (counts.get(product.productId) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([productId]) => productId)
    .sort();
}

export function assertUniqueCatalogProductIds(products: readonly ShopCatalogProduct[]): void {
  const duplicates = duplicateCatalogProductIds(products);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate shop product IDs from Remote Config: ${duplicates.join(', ')}`);
  }
}

function hintPack(
  id: string,
  title: string,
  displayPrice: string,
  productId: string,
  hintAmount: number,
  visible: boolean,
): ShopCatalogProduct {
  return {
    id,
    title,
    kind: 'hintPack',
    group: 'hints',
    purchaseType: 'consumable',
    displayPrice,
    productId,
    hintAmount,
    coinAmount: 0,
    grantsNoAds: false,
    visible,
    description: `${hintAmount} consumable hints.`,
  };
}

function coinPack(
  id: string,
  title: string,
  displayPrice: string,
  productId: string,
  coinAmount: number,
  visible: boolean,
): ShopCatalogProduct {
  return {
    id,
    title,
    kind: 'coinPack',
    group: 'coins',
    purchaseType: 'consumable',
    displayPrice,
    productId,
    hintAmount: 0,
    coinAmount,
    grantsNoAds: false,
    visible,
    description: `${coinAmount.toLocaleString('en-US')} consumable coins.`,
  };
}
