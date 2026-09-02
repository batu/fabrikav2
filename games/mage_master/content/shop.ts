import { assertValidCatalog, type CatalogProduct } from "@fabrikav2/sdk/iap";
import { copy, fill } from "../design/copy.ts";

/** What a gem pack grants. The SDK carries this payload opaquely. */
export interface GemGrant {
  readonly gems: number;
}

export type GemProduct = CatalogProduct<GemGrant>;

/** Catalog group the packs share; the shop renders one section for it. */
export const GEM_GROUP = "gems";

const SKU_PREFIX = "com.basegamelab.mage_master.gems";

function gemPack(id: string, sku: string, tier: number, gems: number, displayPrice: string, badges: string[]): GemProduct {
  return {
    id,
    productId: `${SKU_PREFIX}.${sku}`,
    title: fill("shop.pack", { gems }),
    description: copy["shop.packDesc"],
    // Gems are spent, so a pack is never restore-recoverable.
    kind: "consumable",
    group: GEM_GROUP,
    tier,
    badges,
    displayPrice,
    visible: true,
    payload: { gems },
  };
}

/** The three gem packs, cheapest first. Prices are sandbox display strings; a real store has none. */
export const GEM_PACKS: readonly GemProduct[] = [
  gemPack("gems_small", "small", 0, 60, "$0.99", []),
  gemPack("gems_medium", "medium", 1, 200, "$2.99", []),
  gemPack("gems_large", "large", 2, 600, "$6.99", ["best"]),
];

// A malformed catalog must fail at boot, not at the first tap on Buy.
assertValidCatalog({ products: [...GEM_PACKS] });

/** Gems a store product grants, or 0 when the id is not one of ours. */
export function gemsForProductId(productId: string): number {
  return GEM_PACKS.find((pack) => pack.productId === productId)?.payload.gems ?? 0;
}
