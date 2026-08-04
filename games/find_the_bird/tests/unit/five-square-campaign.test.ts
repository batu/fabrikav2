import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Interim single-level test campaign (2026-08-04): the flat-key/dissolve
// approach test ships the autumn-pond level alone; the ten-keeper campaign
// replaces this list after Batu's review.
const CAMPAIGN_IDS = [
  'ancient_forest_creek_autumn_pond_reeds_bird_da7e',
  'hawaii_rainforest_waterfall_bird_4453',
  'hawaii_north_shore_surf_shack_bird_51c1',
  'pirate_shipwreck_island_broken_bow_lagoon_bird_ae98',
  'pirate_shipwreck_island_treasure_cove_camp_bird_13c5',
  'italy_amalfi_cliff_lemons_bird_5a1c',
  'italy_tuscan_hill_village_bird_a61f',
  'mexico_dia_de_muertos_plaza_bird_8d56',
  'mexico_yucatan_cenote_ruins_bird_b8be',
  'fairytale_forest_fairy_ring_picnic_bird_9ed2',
  'ad_campaigns_ad_autumn_forest_bird_389c',
  'ad_campaigns_ad_snowy_chalet_bird_c64d',
  'ad_campaigns_ad_castle_market_bird_9721',
  'ad_campaigns_ad_japanese_garden_bird_cd3d',
  'ad_campaigns_ad_bazaar_alley_bird_3663',
  'ad_campaigns_ad_treehouse_village_bird_30fd',
  'alpine_meadow_cheese_farm_courtyard_bird_50c1',
  'alpine_meadow_goat_pasture_terraces_bird_6dff',
] as const;
const TARGET_COUNTS: Record<string, number> = {
  ancient_forest_creek_autumn_pond_reeds_bird_da7e: 18,
  hawaii_rainforest_waterfall_bird_4453: 19,
  hawaii_north_shore_surf_shack_bird_51c1: 20,
  pirate_shipwreck_island_broken_bow_lagoon_bird_ae98: 20,
  pirate_shipwreck_island_treasure_cove_camp_bird_13c5: 19,
  italy_amalfi_cliff_lemons_bird_5a1c: 23,
  italy_tuscan_hill_village_bird_a61f: 20,
  mexico_dia_de_muertos_plaza_bird_8d56: 22,
  mexico_yucatan_cenote_ruins_bird_b8be: 17,
  fairytale_forest_fairy_ring_picnic_bird_9ed2: 24,
  ad_campaigns_ad_autumn_forest_bird_389c: 16,
  ad_campaigns_ad_snowy_chalet_bird_c64d: 20,
  ad_campaigns_ad_castle_market_bird_9721: 17,
  ad_campaigns_ad_japanese_garden_bird_cd3d: 17,
  ad_campaigns_ad_bazaar_alley_bird_3663: 25,
  ad_campaigns_ad_treehouse_village_bird_30fd: 21,
  alpine_meadow_cheese_farm_courtyard_bird_50c1: 24,
  alpine_meadow_goat_pasture_terraces_bird_6dff: 23,
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

    const expectedDim = levelId.includes('_13c5') || levelId.includes('_b8be') ? 1024 : 4096;
    expect([level.width, level.height]).toEqual([expectedDim, expectedDim]);
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
