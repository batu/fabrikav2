/**
 * Game-agnostic product catalog schema — generalized from v1
 * `games/find_the_dog/src/shop/ProductCatalog.ts` (READ-ONLY).
 *
 * FTD's `ShopCatalogProduct` mixed two concerns: universal fields that describe
 * *a thing you can buy* (id, productId, title, price, kind, …) and FTD-specific
 * fields that describe *what buying it grants in FTD* (hintAmount, coinAmount,
 * grantsNoAds). The generalization splits them: the universal fields stay typed,
 * and the game's grant descriptor moves into an OPAQUE `payload` the SDK stores
 * but never reads. The game's own `grantForProduct` (see fulfillment.ts) is the
 * only code that interprets `payload`, exactly the "inject the policy" move the
 * haptics carry made with `isEnabled`.
 *
 * The pure validators (`duplicateCatalogProductIds` / `assertUniqueCatalogProductIds`)
 * carry verbatim — they already operate on `productId` only and are game-agnostic.
 */

/**
 * `kind` describes RESTORE behavior, not payment mechanics:
 *   - 'entitlement' — non-consumable, restore-recoverable (e.g. no-ads).
 *   - 'consumable'  — one-shot grant, NOT restore-recoverable (hint/coin packs).
 *
 * FTD's `mixed` purchaseType (no-ads-premium, ego-offer = a non-consumable
 * entitlement plus a consumable payload) needs no third kind: `kind` selects the
 * restore-recoverable half and the consumable half lives in the opaque `payload`.
 * The game's restore-grant mapper returns null for consumables so restore never
 * double-grants hints/coins.
 */
export type ProductKind = 'entitlement' | 'consumable';

export interface CatalogProduct<TPayload = unknown> {
  /** Stable game-facing key (FTD 'no-ads', 'hint-pack-10'). */
  id: string;
  /** Store SKU (from remote config / an injected reader in the game). */
  productId: string;
  title: string;
  description: string;
  kind: ProductKind;
  /** Free-form grouping key (FTD 'entitlements' | 'hints' | 'coins' | 'failOffer'). */
  group: string;
  /** Ordering within a group. FTD implied this by array position; made explicit here. */
  tier: number;
  /**
   * Semantic badge KEYS only (e.g. ['best-value']). The ui-package maps a key to
   * copy/style; NO literal copy or color lives in the catalog (UI guardrail #2
   * corollary). FTD had none, so its fixture products carry `[]`.
   */
  badges: string[];
  /** Fallback price string; the live price comes from the store product. */
  displayPrice: string;
  visible: boolean;
  /** OPAQUE to the SDK — the game's grant descriptor (FTD: { hints, coins, noAds, continueLevel }). */
  payload: TPayload;
}

export interface Catalog<TPayload = unknown> {
  products: CatalogProduct<TPayload>[];
}

/** Products the store should render, filtered on `visible`. */
export function visibleProducts<TPayload>(
  catalog: Catalog<TPayload>,
): CatalogProduct<TPayload>[] {
  return catalog.products.filter((product) => product.visible);
}

/**
 * Store SKUs that appear on more than one product. A duplicate `productId` makes a
 * purchase ambiguous (which grant does it map to?) so fulfillment refuses to grant
 * it. Carried verbatim from FTD — sorted for stable error messages/assertions.
 */
export function duplicateCatalogProductIds<TPayload>(
  products: readonly CatalogProduct<TPayload>[],
): string[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    counts.set(product.productId, (counts.get(product.productId) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([productId]) => productId)
    .sort();
}

export function assertUniqueCatalogProductIds<TPayload>(
  products: readonly CatalogProduct<TPayload>[],
): void {
  const duplicates = duplicateCatalogProductIds(products);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate catalog product IDs: ${duplicates.join(', ')}`);
  }
}

/**
 * Runtime shape check for a catalog: every product must have a non-empty `id` and
 * `productId`, a non-negative `tier`, and a valid `kind`. Returns a list of human
 * problem strings (empty = valid) so callers can assert on it in tests or fail a
 * boot-time config load loudly. Deterministic; no side effects.
 */
export function validateCatalog<TPayload>(catalog: Catalog<TPayload>): string[] {
  const problems: string[] = [];
  catalog.products.forEach((product, index) => {
    const where = `product[${index}]${product.id ? ` (${product.id})` : ''}`;
    if (product.id.trim().length === 0) problems.push(`${where}: empty id`);
    if (product.productId.trim().length === 0) problems.push(`${where}: empty productId`);
    if (!Number.isFinite(product.tier) || product.tier < 0) {
      problems.push(`${where}: tier must be a finite non-negative number (got ${String(product.tier)})`);
    }
    if (product.kind !== 'entitlement' && product.kind !== 'consumable') {
      problems.push(`${where}: invalid kind ${String(product.kind)}`);
    }
  });
  return problems;
}

export function assertValidCatalog<TPayload>(catalog: Catalog<TPayload>): void {
  const problems = validateCatalog(catalog);
  if (problems.length > 0) {
    throw new Error(`Invalid catalog:\n  ${problems.join('\n  ')}`);
  }
}
