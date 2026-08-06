import { describe, expect, it } from 'vitest';

import { reconcileManifestBundledAuthority } from '../../src/data/levels';
import type { ManifestLevelEntry, ManifestV1 } from '../../src/v1core/assets';

function level(id: string, bundled: boolean, path: string): ManifestLevelEntry {
  return {
    id,
    name: id,
    width: 2560,
    height: 2560,
    cohort_buckets: ['all'],
    bundled,
    assets: {
      levelJson: { hash: `${id}-json`, size: 1, path: `levels/${id}/level.json` },
      colorImage: { hash: `${id}-color`, size: 1, path },
      bgImages: [{ hash: `${id}-bg`, size: 1, path: `levels/${id}/bg.webp` }],
    },
  };
}

function manifest(levels: readonly ManifestLevelEntry[]): ManifestV1 {
  return {
    version: 1,
    manifestRevision: 1,
    generatedAt: '2026-08-05T00:00:00Z',
    experimentId: 'test',
    levels,
  };
}

describe('reconcileManifestBundledAuthority', () => {
  it('trusts the packaged manifest, not stale remote bundled flags', () => {
    const packaged = level('packaged', true, 'levels/packaged/color.webp');
    const livePackaged = level('packaged', true, 'levels/packaged/stale-color.webp');
    const liveRemote = level('remote', true, 'levels/remote/color.webp');

    const result = reconcileManifestBundledAuthority(
      manifest([livePackaged, liveRemote]),
      manifest([packaged]),
    );

    expect(result.levels).toEqual([
      packaged,
      { ...liveRemote, bundled: false },
    ]);
  });

  it('appends packaged fallback levels missing from the live manifest', () => {
    const packaged = level('packaged', true, 'levels/packaged/color.webp');
    expect(reconcileManifestBundledAuthority(manifest([]), manifest([packaged])).levels)
      .toEqual([packaged]);
  });
});
