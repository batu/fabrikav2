/**
 * O1: the CDN manifest may only replace the bundled manifest when its
 * manifestRevision is >= the bundled one. A stale origin (observed live
 * 2026-08-12: rev 12 served over a rev 13 bundle, silently reordering the
 * game) must be refused, loudly, with the bundled manifest staying live.
 */
import { describe, expect, it } from 'vitest';

import { createManifestClient } from '../../src/v1core/assets';
import type { ManifestLevelEntry, ManifestV1 } from '../../src/v1core/assets';

function level(id: string): ManifestLevelEntry {
  return {
    id,
    name: id,
    width: 2688,
    height: 2688,
    cohort_buckets: ['all'],
    bundled: true,
    assets: {
      levelJson: { path: `levels/${id}/level.json`, hash: `${id}-json`, size: 1 },
      colorImage: { path: `levels/${id}/color.webp`, hash: `${id}-color`, size: 1 },
      bgImages: [],
    },
  };
}

function manifest(revision: number, ids: readonly string[]): ManifestV1 {
  return {
    version: 1,
    manifestRevision: revision,
    generatedAt: '2026-08-12T00:00:00Z',
    experimentId: 'test',
    levels: ids.map(level),
  };
}

function withFetch(payload: unknown): void {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe('manifest freshness guard (O1)', () => {
  it('refuses a CDN manifest older than the bundled one', async () => {
    const bundled = manifest(13, ['first', 'second']);
    withFetch(manifest(12, ['stale-first']));
    const client = createManifestClient();
    await client.initialize('https://cdn.example.test/manifest.json', bundled);
    expect(client.getManifest().manifestRevision).toBe(13);
    expect(client.getManifest().levels[0]!.id).toBe('first');
  });

  it('accepts a CDN manifest with an equal or newer revision', async () => {
    const bundled = manifest(13, ['first']);
    withFetch(manifest(14, ['newer-first']));
    const client = createManifestClient();
    await client.initialize('https://cdn.example.test/manifest.json', bundled);
    expect(client.getManifest().manifestRevision).toBe(14);

    const equal = createManifestClient();
    withFetch(manifest(13, ['same-rev']));
    await equal.initialize('https://cdn.example.test/manifest.json', bundled);
    expect(equal.getManifest().manifestRevision).toBe(13);
    expect(equal.getManifest().levels[0]!.id).toBe('same-rev');
  });

  it('falls back to bundled when the CDN revision is missing or not a safe integer', async () => {
    const bundled = manifest(13, ['first']);
    for (const bad of [undefined, null, Number.NaN, 2 ** 60, '12']) {
      const payload = { ...manifest(13, ['bogus']), manifestRevision: bad };
      withFetch(payload);
      const client = createManifestClient();
      await client.initialize('https://cdn.example.test/manifest.json', bundled);
      expect(client.getManifest().levels[0]!.id).toBe('first');
    }
  });

  it('a refused stale manifest retries on a later initialize', async () => {
    const bundled = manifest(13, ['first']);
    withFetch(manifest(12, ['stale']));
    const client = createManifestClient();
    await client.initialize('https://cdn.example.test/manifest.json', bundled);
    expect(client.getManifest().manifestRevision).toBe(13);
    withFetch(manifest(15, ['fresh']));
    await client.initialize('https://cdn.example.test/manifest.json', bundled);
    expect(client.getManifest().manifestRevision).toBe(15);
  });
});
