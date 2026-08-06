import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Wave-1 regime (2026-08-06): the campaign is the 53-level first-autonomous
// batch. The first STARTER_COUNT levels of the index are bundled in-app
// (bundled-manifest.json is the native build's copy list); the rest stream
// from the ftb-level-origin worker. Previous fixed lists live in git history.
const STARTER_COUNT = 5;
const NATIVE_BUNDLE_MAX_BYTES = 100 * 1024 * 1024;
// poststretch2 predates the 2688 canvas and is grandfathered at 4096.
const ALLOWED_DIMS = new Set([2688, 4096]);

const levelsRoot = join(process.cwd(), 'public/levels');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface ManifestAsset {
  readonly hash: string;
  readonly size: number;
  readonly path: string;
}

interface LevelIndexEntry {
  readonly id: string;
}

interface BundledLevel {
  readonly id: string;
  readonly bundled: boolean;
}

interface CatalogAsset {
  readonly role: string;
  readonly hash: string;
  readonly size: number;
  readonly path: string;
}

interface CatalogLevel {
  readonly id: string;
  readonly listable: boolean;
  readonly width: number;
  readonly height: number;
  readonly packageId: string;
  readonly package: {
    readonly complete: boolean;
    readonly requiredAssets: readonly CatalogAsset[];
    readonly requiredBytes: number;
  };
}

interface RuntimeDog {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly sprite: {
    readonly image: string;
    readonly cleanup: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  };
}

interface RuntimeLevel {
  readonly width: number;
  readonly height: number;
  readonly dogs: readonly RuntimeDog[];
}

function collectAssets(value: unknown, out: Map<string, ManifestAsset>): void {
  if (Array.isArray(value)) { for (const item of value) collectAssets(item, out); return; }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.path === 'string'
    && typeof record.hash === 'string'
    && typeof record.size === 'number'
  ) {
    out.set(record.path, {
      hash: record.hash,
      size: record.size,
      path: record.path,
    });
  }
  for (const item of Object.values(record)) collectAssets(item, out);
}

describe('wave-1 campaign (5 bundled starters + streamed rest)', () => {
  const index = readJson<LevelIndexEntry[]>(join(levelsRoot, 'levels-index.json'));
  const bundled = readJson<{ levels: BundledLevel[] }>(join(levelsRoot, 'bundled-manifest.json'));
  const catalog = readJson<{ levels: CatalogLevel[] }>(join(levelsRoot, 'catalog-manifest.json'));

  it('index is 53 unique levels and the starter prefix IS the bundled manifest', () => {
    expect(index.length).toBe(53);
    expect(new Set(index.map((l) => l.id)).size).toBe(53);
    const starters = index.slice(0, STARTER_COUNT).map((l) => l.id);
    expect(bundled.levels.map((level) => level.id)).toEqual(starters);
    for (const level of bundled.levels) expect(level.bundled).toBe(true);
  });

  it('bundled manifest references only existing files and fits the native cap', () => {
    const assets = new Map<string, ManifestAsset>();
    collectAssets(bundled, assets);
    let total = 0;
    for (const asset of assets.values()) {
      const abs = join(process.cwd(), 'public', asset.path);
      expect(existsSync(abs), asset.path).toBe(true);
      const bytes = readFileSync(abs);
      expect(bytes.byteLength, asset.path).toBe(asset.size);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.path).toBe(asset.hash);
      total += bytes.byteLength;
    }
    expect(total).toBeLessThan(NATIVE_BUNDLE_MAX_BYTES);
  });

  it('every indexed level is a complete square package in the catalog', () => {
    const byId = new Map(catalog.levels.map((level) => [level.id, level]));
    for (const { id } of index) {
      const level = byId.get(id);
      expect(level, id).toBeDefined();
      if (!level) throw new Error(`Catalog entry missing for ${id}`);

      expect(level.listable, id).toBe(true);
      expect(ALLOWED_DIMS.has(level.width), id).toBe(true);
      expect(level.height, id).toBe(level.width);
      expect(level.packageId.startsWith(`${id}:`), id).toBe(true);
      expect(level.package.complete, id).toBe(true);

      const requiredAssets = level.package.requiredAssets;
      expect(Array.isArray(requiredAssets), id).toBe(true);
      const roles = new Set(requiredAssets.map((asset) => asset.role));
      expect(roles.has('levelJson'), id).toBe(true);
      expect(roles.has('colorImage'), id).toBe(true);
      expect([...roles].some((role) => role.startsWith('bgImage:')), id).toBe(true);
      expect([...roles].filter((role) => role.startsWith('dogSprite:')).length, id).toBeGreaterThanOrEqual(10);

      let requiredBytes = 0;
      for (const asset of requiredAssets) {
        expect(asset.path.startsWith(`levels/${id}/`), `${id}:${asset.role}`).toBe(true);
        expect(asset.hash, `${id}:${asset.role}`).toMatch(/^[0-9a-f]{64}$/);
        expect(Number.isSafeInteger(asset.size) && asset.size > 0, `${id}:${asset.role}`).toBe(true);
        requiredBytes += asset.size;
      }
      expect(level.package.requiredBytes, id).toBe(requiredBytes);
    }
  });

  it.each(bundled.levels.map((level) => level.id))('%s is a complete bundled package', (levelId) => {
    const level = readJson<RuntimeLevel>(join(levelsRoot, levelId, 'level.json'));
    expect(ALLOWED_DIMS.has(level.width), `width ${level.width}`).toBe(true);
    expect(level.width).toBe(level.height);
    expect(level.dogs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(level.dogs.map((dog) => dog.id)).size).toBe(level.dogs.length);

    for (const dog of level.dogs) {
      expect(Number.isFinite(dog.x) && Number.isFinite(dog.y) && Number.isFinite(dog.r)).toBe(true);
      expect(dog.r).toBeGreaterThan(0);
      expect(dog.x - dog.r).toBeGreaterThanOrEqual(0);
      expect(dog.y - dog.r).toBeGreaterThanOrEqual(0);
      expect(dog.x + dog.r).toBeLessThanOrEqual(level.width);
      expect(dog.y + dog.r).toBeLessThanOrEqual(level.height);

      const sprite = dog.sprite;
      expect(existsSync(join(process.cwd(), 'public', sprite.image))).toBe(true);
      // Runtime contract (and the export gate) require the CLEANUP box to
      // contain the tap center; the sprite box may sit a few px off after
      // recentring, which dissolve renders invisibly.
      const cleanup = sprite.cleanup;
      expect(dog.x).toBeGreaterThanOrEqual(cleanup.x);
      expect(dog.x).toBeLessThanOrEqual(cleanup.x + cleanup.width);
      expect(dog.y).toBeGreaterThanOrEqual(cleanup.y);
      expect(dog.y).toBeLessThanOrEqual(cleanup.y + cleanup.height);
    }
  });
});
