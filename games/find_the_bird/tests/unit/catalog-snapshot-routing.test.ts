import { describe, expect, it } from 'vitest';

import { catalogSnapshotFetchUrls } from '../../src/data/catalogSnapshotUrls';

describe('catalog snapshot routing', () => {
  it('tries packaged same-origin bytes before the configured CDN', () => {
    expect(catalogSnapshotFetchUrls('catalog-000308', 'https://cdn.example.test/')).toEqual([
      'levels/catalog-snapshots/catalog-000308.json',
      'https://cdn.example.test/levels/catalog-snapshots/catalog-000308.json',
    ]);
  });

  it('stays packaged-only when CDN delivery is disabled', () => {
    expect(catalogSnapshotFetchUrls('catalog 1', null)).toEqual([
      'levels/catalog-snapshots/catalog%201.json',
    ]);
  });
});
