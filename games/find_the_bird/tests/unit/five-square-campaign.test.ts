import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Interim single-level test campaign (2026-08-04): the flat-key/dissolve
// approach test ships the autumn-pond level alone; the ten-keeper campaign
// replaces this list after Batu's review.
const CAMPAIGN_IDS = [
  'ancient_forest_creek_autumn_pond_reeds_bird_da7e',
] as const;
const TARGET_COUNTS: Record<string, number> = {
  ancient_forest_creek_autumn_pond_reeds_bird_da7e: 18,
};

const levelsRoot = join(process.cwd(), 'public/levels');

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('five-square bundled campaign', () => {
  it('uses exactly the agreed five levels in progression order in every active manifest', () => {
    const index = readJson(join(levelsRoot, 'levels-index.json'));
    const bundled = readJson(join(levelsRoot, 'bundled-manifest.json'));
    const catalog = readJson(join(levelsRoot, 'catalog-manifest.json'));

    expect(index.map((level: any) => level.id)).toEqual(CAMPAIGN_IDS);
    expect(bundled.levels.map((level: any) => level.id)).toEqual(CAMPAIGN_IDS);
    const catalogById = new Map<string, any>(catalog.levels.map((level: any) => [level.id, level]));
    for (const id of CAMPAIGN_IDS) {
      expect(catalogById.get(id)?.listable).toBe(true);
      expect(catalogById.get(id)?.bundledInApp).toBe(true);
    }
  });

  it.each(CAMPAIGN_IDS)('%s is a complete 4096 square package with 15 one-to-one targets', (levelId) => {
    const level = readJson(join(levelsRoot, levelId, 'level.json'));

    expect([level.width, level.height]).toEqual([4096, 4096]);
    expect(level.dogs).toHaveLength(TARGET_COUNTS[levelId]);
    expect(new Set(level.dogs.map((dog: any) => dog.id)).size).toBe(TARGET_COUNTS[levelId]);
    expect(new Set(level.dogs.map((dog: any) => dog.sprite.image)).size).toBe(TARGET_COUNTS[levelId]);

    for (const dog of level.dogs) {
      expect(Number.isFinite(dog.x) && Number.isFinite(dog.y) && Number.isFinite(dog.r)).toBe(true);
      expect(dog.r).toBeGreaterThan(0);
      expect(dog.x - dog.r).toBeGreaterThanOrEqual(0);
      expect(dog.y - dog.r).toBeGreaterThanOrEqual(0);
      expect(dog.x + dog.r).toBeLessThanOrEqual(level.width);
      expect(dog.y + dog.r).toBeLessThanOrEqual(level.height);

      const sprite = dog.sprite;
      expect(existsSync(join(process.cwd(), 'public', sprite.image))).toBe(true);
      expect(dog.x).toBeGreaterThanOrEqual(sprite.x);
      expect(dog.x).toBeLessThanOrEqual(sprite.x + sprite.width);
      expect(dog.y).toBeGreaterThanOrEqual(sprite.y);
      expect(dog.y).toBeLessThanOrEqual(sprite.y + sprite.height);
    }
  });
});
