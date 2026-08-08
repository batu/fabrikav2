import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CDN_ORIGIN = 'https://cdn.example.test';
const fetchState = vi.hoisted(() => ({ manifestAttempts: 0 }));

vi.mock('../../src/config/cdn', () => ({
  getCdnOrigin: (): string => CDN_ORIGIN,
  isCdnExplicitlyDisabled: (): boolean => false,
}));

vi.mock('../../src/config/RemoteConfigService', () => ({
  remoteConfigService: {
    snapshot: () => ({
      active: { levelSequencePayload: '', levelSequenceSha256: '' },
      sources: { levelSequencePayload: 'remote', levelSequenceSha256: 'remote' },
    }),
  },
}));

vi.mock('../../src/data/cohortContext', () => ({
  cohortBucket: (): number => 42,
}));

import { _clearAllLevelCaches, getLevelIndex } from '../../src/data/levels';
import type { ManifestLevelEntry, ManifestV1 } from '../../src/v1core/assets';

function level(id: string, bundled: boolean): ManifestLevelEntry {
  return {
    id,
    name: id,
    width: 2688,
    height: 2688,
    cohort_buckets: ['all'],
    bundled,
    assets: {
      levelJson: { path: `levels/${id}/level.json`, hash: `${id}-json`, size: 1 },
      colorImage: { path: `levels/${id}/color.webp`, hash: `${id}-color`, size: 1 },
      bgImages: [],
    },
  };
}

function manifest(revision: number, levels: readonly ManifestLevelEntry[]): ManifestV1 {
  return {
    version: 1,
    manifestRevision: revision,
    generatedAt: '2026-08-06T00:00:00Z',
    experimentId: 'test',
    levels,
  };
}

describe('runtime manifest retry refresh', () => {
  const bundled = manifest(1, [level('bundled', true)]);
  const live = manifest(2, [level('bundled', true), level('remote', false)]);

  beforeEach(async () => {
    await _clearAllLevelCaches();
    fetchState.manifestAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === 'levels/bundled-manifest.json') return Response.json(bundled);
      if (url === `${CDN_ORIGIN}/manifest.json`) {
        fetchState.manifestAttempts += 1;
        return fetchState.manifestAttempts === 1
          ? new Response('', { status: 503 })
          : Response.json(live);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
  });

  afterEach(async () => {
    await _clearAllLevelCaches();
    vi.unstubAllGlobals();
  });

  it('replaces a cached fallback index after a later CDN initialization succeeds', async () => {
    expect((await getLevelIndex()).map((entry) => entry.id)).toEqual(['bundled']);
    expect((await getLevelIndex()).map((entry) => entry.id)).toEqual(['bundled', 'remote']);
    expect(fetchState.manifestAttempts).toBe(2);
  });

  it('shares concurrent manifest initialization and retries fallback on the next completed call', async () => {
    let releaseFallback!: () => void;
    const delayedFallback = new Promise<Response>((resolve) => {
      releaseFallback = () => resolve(new Response('', { status: 503 }));
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === 'levels/bundled-manifest.json') return Response.json(bundled);
      if (url === `${CDN_ORIGIN}/manifest.json`) {
        fetchState.manifestAttempts += 1;
        return fetchState.manifestAttempts === 1 ? delayedFallback : Response.json(live);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const first = getLevelIndex();
    const concurrent = getLevelIndex();
    await vi.waitFor(() => expect(fetchState.manifestAttempts).toBe(1));
    releaseFallback();

    expect((await first).map((entry) => entry.id)).toEqual(['bundled']);
    expect((await concurrent).map((entry) => entry.id)).toEqual(['bundled']);
    expect(fetchState.manifestAttempts).toBe(1);
    expect((await getLevelIndex()).map((entry) => entry.id)).toEqual(['bundled', 'remote']);
    expect(fetchState.manifestAttempts).toBe(2);
  });
});
