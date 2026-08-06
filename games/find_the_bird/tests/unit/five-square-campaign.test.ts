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

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectPaths(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) { for (const item of value) collectPaths(item, out); return; }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'path' && typeof item === 'string') out.add(item);
    else collectPaths(item, out);
  }
}

describe('wave-1 campaign (5 bundled starters + streamed rest)', () => {
  const index: { id: string }[] = readJson(join(levelsRoot, 'levels-index.json'));
  const bundled = readJson(join(levelsRoot, 'bundled-manifest.json'));
  const catalog = readJson(join(levelsRoot, 'catalog-manifest.json'));

  it('index is 53 unique levels and the starter prefix IS the bundled manifest', () => {
    expect(index.length).toBe(53);
    expect(new Set(index.map((l) => l.id)).size).toBe(53);
    const starters = index.slice(0, STARTER_COUNT).map((l) => l.id);
    expect(bundled.levels.map((l: any) => l.id)).toEqual(starters);
    for (const level of bundled.levels) expect(level.bundled).toBe(true);
  });

  it('bundled manifest references only existing files and fits the native cap', () => {
    const paths = new Set<string>();
    collectPaths(bundled, paths);
    let total = 0;
    for (const rel of paths) {
      const abs = join(process.cwd(), 'public', rel);
      expect(existsSync(abs), rel).toBe(true);
      total += readFileSync(abs).byteLength;
    }
    expect(total).toBeLessThan(NATIVE_BUNDLE_MAX_BYTES);
  });

  it('every indexed level is listable in the catalog', () => {
    const byId = new Map<string, any>(catalog.levels.map((l: any) => [l.id, l]));
    for (const { id } of index) {
      expect(byId.get(id)?.listable, id).toBe(true);
    }
  });

  it.each(index.map((l) => l.id))('%s is a complete square package', (levelId) => {
    const level = readJson(join(levelsRoot, levelId, 'level.json'));
    expect(ALLOWED_DIMS.has(level.width), `width ${level.width}`).toBe(true);
    expect(level.width).toBe(level.height);
    expect(level.dogs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(level.dogs.map((dog: any) => dog.id)).size).toBe(level.dogs.length);

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
