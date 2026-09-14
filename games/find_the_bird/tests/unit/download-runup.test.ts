import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LevelAsset, ManifestLevelEntry, ManifestV1 } from '../../src/v1core/assets';

const scheduled = vi.hoisted(() => ({ run: null as (() => void) | null }));
vi.mock('../../src/platform/browserScheduling', () => ({
  hasLowDataConnection: () => false,
  runWhenVisibleAndIdle: (run: () => void) => { scheduled.run = run; return () => undefined; },
}));
vi.mock('../../src/config/cdn', () => ({
  getCdnOrigin: () => 'https://cdn.example.test',
  isCdnExplicitlyDisabled: () => false,
}));
vi.mock('../../src/data/cohortContext', () => ({ cohortBucket: () => 42 }));
vi.mock('../../src/config/RemoteConfigService', () => ({
  remoteConfigService: { snapshot: () => ({
    active: { levelSequencePayload: '', levelSequenceSha256: '' },
    sources: { levelSequencePayload: 'remote', levelSequenceSha256: 'remote' },
  }) },
}));

import { _clearAllLevelCaches, loadLevelForProgression, packageCacheSnapshot } from '../../src/data/levels';

describe('bundled-size download run-up', () => {
  beforeEach(async () => {
    await _clearAllLevelCaches();
    scheduled.run = null;
  });
  afterEach(async () => {
    await _clearAllLevelCaches();
    vi.unstubAllGlobals();
  });

  it.each([
    { bundledCount: 3, staleCatalog: false },
    { bundledCount: 5, staleCatalog: false },
    { bundledCount: 3, staleCatalog: true },
    { bundledCount: 5, staleCatalog: true },
  ])('downloads $bundledCount levels ahead and tops up (stale catalog: $staleCatalog)', async ({ bundledCount, staleCatalog }) => {
    const responses = new Map<string, Blob>();
    const downloaded: string[] = [];
    async function asset(path: string, content: string): Promise<LevelAsset> {
      const blob = new Blob([content]);
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      responses.set(path, blob);
      responses.set(`https://cdn.example.test/assets/${hash}.${path.split('.').pop()}`, blob);
      return { path, hash, size: blob.size };
    }
    async function level(id: string, bundled: boolean): Promise<ManifestLevelEntry> {
      const root = `levels/${id}`;
      const spritePath = `${root}/sprite.png`;
      const json = JSON.stringify({
        id, name: id, width: 100, height: 100, colorImage: `${root}/color.png`,
        dogs: [{ id: 'bird', x: 50, y: 50, r: 10, sprite: {
          image: spritePath, x: 40, y: 40, width: 20, height: 20,
          cleanup: { x: 35, y: 35, width: 30, height: 30 },
        } }],
      });
      return {
        id, name: id, width: 100, height: 100, bundled, cohort_buckets: ['all'],
        assets: {
          levelJson: await asset(`${root}/level.json`, json),
          colorImage: await asset(`${root}/color.png`, `${id}-color`),
          bgImages: [await asset(`${root}/bg.png`, `${id}-bg`)],
          dogSprites: [await asset(spritePath, `${id}-sprite`)],
        },
      };
    }
    const bundled = await Promise.all(Array.from({ length: bundledCount }, (_, i) => level(`bundled-${i}`, true)));
    const remote = await Promise.all(Array.from({ length: bundledCount + 2 }, (_, i) => level(`remote-${i}`, false)));
    const catalog = {
      catalogRevision: 'test-catalog',
      levels: [...bundled, ...remote].map(entry => ({
        id: entry.id, packageId: `${entry.id}:${entry.assets.levelJson.hash}`,
        width: entry.width, height: entry.height, bundledInApp: entry.bundled,
        listable: true, allCohortAvailable: true, cohortBuckets: ['all'],
        package: { complete: true, requiredAssets: [
          { ...entry.assets.levelJson, role: 'levelJson' },
          { ...entry.assets.colorImage, role: 'colorImage' },
          { role: 'bwImage', hash: 'a'.repeat(64), size: 6_000_000, path: `levels/${entry.id}/bw.png` },
          { ...entry.assets.bgImages![0], role: 'bgImage:0' },
          // The catalog predates the serving manifest's current sprite set.
          { role: 'dogSprite:1', hash: 'b'.repeat(64), size: 100, path: `levels/${entry.id}/removed.png` },
        ] },
      })),
    };
    const manifest = (levels: readonly ManifestLevelEntry[]): ManifestV1 => ({
      version: 1, manifestRevision: 1, generatedAt: '2026-09-14T00:00:00Z', experimentId: 'test', levels,
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'levels/bundled-manifest.json') return Response.json(manifest(bundled));
      if (url === 'levels/catalog-manifest.json' && staleCatalog) return Response.json(catalog);
      // Remote bundled flags must not increase the run-up beyond the actual app bundle.
      if (url === 'https://cdn.example.test/manifest.json') return Response.json(manifest(
        [...bundled, ...remote.map(entry => ({ ...entry, bundled: true }))],
      ));
      const blob = responses.get(url);
      if (!blob) return new Response('', { status: 404 });
      if (url.startsWith('https://')) downloaded.push(url);
      return new Response(blob);
    }));

    await loadLevelForProgression(bundledCount - 1);
    scheduled.run?.();
    const firstWindow = remote.slice(0, bundledCount);
    await vi.waitFor(() => expect(packageCacheSnapshot().lastRetentionPlan?.retainedPackageIds).toEqual([
      `${bundled.at(-1)!.id}:${bundled.at(-1)!.assets.levelJson.hash}`,
      ...firstWindow.map(entry => `${entry.id}:${entry.assets.levelJson.hash}`),
    ]));
    expect(downloaded).toHaveLength(bundledCount * 4);
    expect(downloaded[0]).toContain(remote[0]!.assets.levelJson.hash);

    await loadLevelForProgression(bundledCount);
    scheduled.run?.();
    await vi.waitFor(() => expect(packageCacheSnapshot().lastRetentionPlan?.retainedPackageIds).toEqual(
      remote.slice(0, bundledCount + 1).map(entry => `${entry.id}:${entry.assets.levelJson.hash}`),
    ));
    expect(downloaded).toHaveLength((bundledCount + 1) * 4);
  });
});
