/**
 * The CDN manifest fetch is bounded.
 *
 * It gates every level load while the client is in fallback mode: a refused or
 * failed manifest leaves `usedFallback` true, so `initialize()` stops
 * early-returning and each `loadLevel()` pays the round trip again. A hard
 * failure was always handled — it throws and we fall back — but a merely SLOW
 * origin had nothing to stop it stalling the load behind it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManifestClient, type ManifestV1 } from '../../src/v1core/assets';

const BUNDLED: ManifestV1 = {
  version: 1,
  manifestRevision: 51,
  generatedAt: '2026-09-19T00:00:00Z',
  experimentId: 'ftd_levelset_v1',
  levels: [],
} as unknown as ManifestV1;

describe('CDN manifest fetch timeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('gives up on a hanging origin and serves the bundled manifest', async () => {
    // An origin that accepts the connection and then never answers — the case
    // a plain fetch has no defence against.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));

    const client = createManifestClient();
    const pending = client.initialize('https://cdn.example.test/manifest.json', BUNDLED);
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;

    expect(client.getManifest().manifestRevision).toBe(51);
  });

  it('still prefers a fresh CDN manifest when the origin answers in time', async () => {
    const fresh = { ...BUNDLED, manifestRevision: 52 };
    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: true, json: () => Promise.resolve(fresh),
    } as unknown as Response));

    const client = createManifestClient();
    await client.initialize('https://cdn.example.test/manifest.json', BUNDLED);

    expect(client.getManifest().manifestRevision).toBe(52);
  });
});
