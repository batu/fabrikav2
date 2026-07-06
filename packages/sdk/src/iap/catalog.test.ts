import { describe, expect, it } from 'vitest';
import {
  assertUniqueCatalogProductIds,
  duplicateCatalogProductIds,
  validateCatalog,
  visibleProducts,
  type Catalog,
} from './catalog.ts';
import { ftdCatalogProducts, type FtdGrant } from './ftd-fixture.ts';

const ftdCatalog: Catalog<FtdGrant> = { products: ftdCatalogProducts };

describe('catalog schema — FTD regression fixture', () => {
  it('reproduces FTD\'s actual product list (12 products; card said 13 — source has 12)', () => {
    expect(ftdCatalog.products).toHaveLength(12);
  });

  it('maps FTD kinds to the SDK entitlement/consumable split', () => {
    const byKind = (kind: 'entitlement' | 'consumable'): string[] =>
      ftdCatalog.products.filter((p) => p.kind === kind).map((p) => p.id).sort();
    expect(byKind('entitlement')).toEqual(['no-ads', 'no-ads-premium']);
    // Everything else (hints, coins, ego offer) is consumable / non-restore-recoverable.
    expect(byKind('consumable')).toHaveLength(10);
  });

  it('validates: every fixture product satisfies the runtime schema', () => {
    expect(validateCatalog(ftdCatalog)).toEqual([]);
  });

  it('accepts FTD\'s real (unique) product ids', () => {
    expect(() => assertUniqueCatalogProductIds(ftdCatalog.products)).not.toThrow();
    expect(duplicateCatalogProductIds(ftdCatalog.products)).toEqual([]);
  });

  it('rejects a deliberately-duplicated productId', () => {
    const dupe = ftdCatalog.products[3];
    const products = [...ftdCatalog.products, { ...dupe, id: `${dupe.id}-copy` }];
    expect(duplicateCatalogProductIds(products)).toEqual([dupe.productId]);
    expect(() => assertUniqueCatalogProductIds(products)).toThrow(/Duplicate catalog product IDs/);
  });

  it('visibleProducts filters on the visible flag', () => {
    expect(visibleProducts(ftdCatalog)).toHaveLength(12);
    const hidden: Catalog<FtdGrant> = {
      products: ftdCatalog.products.map((p, i) => (i === 0 ? { ...p, visible: false } : p)),
    };
    expect(visibleProducts(hidden)).toHaveLength(11);
    expect(visibleProducts(hidden).some((p) => p.id === 'no-ads')).toBe(false);
  });
});

describe('validateCatalog — rejects malformed products', () => {
  it('flags empty id, empty productId, negative tier, and invalid kind', () => {
    const bad: Catalog<FtdGrant> = {
      products: [
        { ...ftdCatalogProducts[0], id: '' },
        { ...ftdCatalogProducts[1], productId: '  ' },
        { ...ftdCatalogProducts[2], tier: -1 },
        // @ts-expect-error — deliberately invalid kind to exercise the runtime guard
        { ...ftdCatalogProducts[3], kind: 'subscription' },
      ],
    };
    const problems = validateCatalog(bad);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/empty id/);
    expect(problems[1]).toMatch(/empty productId/);
    expect(problems[2]).toMatch(/tier must be/);
    expect(problems[3]).toMatch(/invalid kind/);
  });
});
