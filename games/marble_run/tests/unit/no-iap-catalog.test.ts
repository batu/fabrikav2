import { describe, expect, it, vi } from 'vitest';

import { buildFullShopCatalog, buildShopCatalog } from '../../src/shop/ProductCatalog';

describe('Marble Run no-IAP catalog contract', () => {
  it('keeps every purchase catalog empty without consulting remote commerce flags', () => {
    const readRemoteValue = vi.fn(() => {
      throw new Error('commerce config must not be read');
    });
    const reader = { value: readRemoteValue };

    expect(buildFullShopCatalog(reader)).toEqual({ products: [] });
    expect(buildShopCatalog(reader)).toEqual({ products: [] });
    expect(readRemoteValue).not.toHaveBeenCalled();
  });
});
