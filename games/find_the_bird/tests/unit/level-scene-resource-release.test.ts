import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cdnState = vi.hoisted(() => ({ origin: null as string | null }));

vi.mock('../../src/config/cdn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/config/cdn')>()),
  getCdnOrigin: (): string | null => cdnState.origin,
  isCdnExplicitlyDisabled: (): boolean => cdnState.origin === null,
}));

import {
  _clearAllLevelCaches,
  loadLevel,
  releaseLevelSceneResources,
} from '../../src/data/levels';
import type { ManifestLevelEntry, ManifestV1 } from '../../src/v1core/assets';

const CDN_ORIGIN = 'https://cdn.example.test';

function levelFile(id: string, assetRoot: string): object {
  return {
    id,
    name: id,
    width: 100,
    height: 100,
    colorImage: `${assetRoot}/color.png`,
    dogs: [{
      id: 'dog_00',
      x: 50,
      y: 50,
      r: 10,
      sprite: {
        image: `${assetRoot}/dogs/dog_00/sprite.png`,
        x: 40,
        y: 40,
        width: 20,
        height: 20,
        cleanup: { x: 35, y: 35, width: 30, height: 30 },
      },
    }],
  };
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function manifest(levels: readonly ManifestLevelEntry[]): ManifestV1 {
  return {
    version: 1,
    manifestRevision: 1,
    generatedAt: '2026-08-09T00:00:00Z',
    experimentId: 'resource-release-test',
    levels: [...levels],
  };
}

describe('level scene resource release', () => {
  beforeEach(async () => {
    await _clearAllLevelCaches();
    cdnState.origin = null;
  });

  afterEach(async () => {
    await _clearAllLevelCaches();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retains parsed bundled data backed only by stable same-origin paths', async () => {
    const id = 'bundled';
    const root = `levels/${id}`;
    const json = JSON.stringify(levelFile(id, root));
    const entry: ManifestLevelEntry = {
      id,
      name: id,
      width: 100,
      height: 100,
      cohort_buckets: ['all'],
      bundled: true,
      assets: {
        levelJson: { path: `${root}/level.json`, hash: 'bundled-json', size: json.length },
        colorImage: { path: `${root}/color.png`, hash: 'bundled-color', size: 1 },
        bgImages: [{ path: `${root}/bg.png`, hash: 'bundled-bg', size: 1 }],
        dogSprites: [{ path: `${root}/dogs/dog_00/sprite.png`, hash: 'bundled-sprite', size: 1 }],
      },
    };
    const bundledManifest = manifest([entry]);
    const levelFetches: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === 'levels/bundled-manifest.json') return Response.json(bundledManifest);
      if (url === `${root}/level.json`) {
        levelFetches.push(url);
        return new Response(json, { headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const first = await loadLevel(id);
    releaseLevelSceneResources(id);
    const second = await loadLevel(id);

    expect(second).toBe(first);
    expect(levelFetches).toEqual([`${root}/level.json`]);
  });

  it('revokes Object URLs and invalidates parsed data backed by remote blobs', async () => {
    cdnState.origin = CDN_ORIGIN;
    const id = 'remote';
    const root = `remote/${id}`;
    const blobs = {
      json: new Blob([JSON.stringify(levelFile(id, root))], { type: 'application/json' }),
      color: new Blob(['color'], { type: 'image/png' }),
      bg: new Blob(['background'], { type: 'image/png' }),
      sprite: new Blob(['sprite'], { type: 'image/png' }),
    };
    const hashes = {
      json: await sha256(blobs.json),
      color: await sha256(blobs.color),
      bg: await sha256(blobs.bg),
      sprite: await sha256(blobs.sprite),
    };
    const entry: ManifestLevelEntry = {
      id,
      name: id,
      width: 100,
      height: 100,
      cohort_buckets: ['all'],
      bundled: false,
      assets: {
        levelJson: { path: `${root}/level.json`, hash: hashes.json, size: blobs.json.size },
        colorImage: { path: `${root}/color.png`, hash: hashes.color, size: blobs.color.size },
        bgImages: [{ path: `${root}/bg.png`, hash: hashes.bg, size: blobs.bg.size }],
        dogSprites: [{ path: `${root}/dogs/dog_00/sprite.png`, hash: hashes.sprite, size: blobs.sprite.size }],
      },
    };
    const remoteManifest = manifest([entry]);
    const emptyBundledManifest = manifest([]);
    const assetByUrl = new Map<string, Blob>([
      [`${CDN_ORIGIN}/assets/${hashes.json}.json`, blobs.json],
      [`${CDN_ORIGIN}/assets/${hashes.color}.png`, blobs.color],
      [`${CDN_ORIGIN}/assets/${hashes.bg}.png`, blobs.bg],
      [`${CDN_ORIGIN}/${root}/dogs/dog_00/sprite.png`, blobs.sprite],
    ]);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === 'levels/bundled-manifest.json') return Response.json(emptyBundledManifest);
      if (url === `${CDN_ORIGIN}/manifest.json`) return Response.json(remoteManifest);
      const blob = assetByUrl.get(url);
      if (blob !== undefined) return new Response(blob);
      throw new Error(`unexpected fetch: ${url}`);
    }));
    let objectUrlSequence = 0;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:resource-${++objectUrlSequence}`);
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const first = await loadLevel(id);
    releaseLevelSceneResources(id);
    await Promise.resolve();

    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
    const second = await loadLevel(id);
    expect(second).not.toBe(first);
    expect(createObjectURL).toHaveBeenCalledTimes(6);
  });
});
