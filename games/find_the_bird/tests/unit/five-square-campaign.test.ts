import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CAMPAIGN_IDS = [
  'square_hawaii_waterfall_flash_4k',
  'square_pirate_cove_flash_4k',
  'square_yucatan_cenote_flash_4k',
  'square_sami_aurora_flash_4k',
  'square_grand_bazaar_flash_4k',
] as const;

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
    expect(catalog.levels.map((level: any) => level.id)).toEqual(CAMPAIGN_IDS);
    expect(catalog.levels.every((level: any) => level.listable && level.bundledInApp)).toBe(true);
  });

  it.each(CAMPAIGN_IDS)('%s is a complete 4096 square package with 15 one-to-one targets', (levelId) => {
    const level = readJson(join(levelsRoot, levelId, 'level.json'));

    expect([level.width, level.height]).toEqual([4096, 4096]);
    expect(level.dogs).toHaveLength(15);
    expect(new Set(level.dogs.map((dog: any) => dog.id)).size).toBe(15);
    expect(new Set(level.dogs.map((dog: any) => dog.sprite.image)).size).toBe(15);

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
