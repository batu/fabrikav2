import type { AdProvider } from './AdProvider';

// 2026-09-13: 26 potentially occluded levels from the 44-level serving list.
// See tools/level-editor/PIPELINE.md. Stable IDs survive sequence reordering.
// This is a conservative mitigation, not a claim that every bird was device-tested.
const bannerExcludedLevelIds: ReadonlySet<string> = new Set([
  'ad_campaigns_ad_castle_market_bird_9721',
  'ad_campaigns_ad_farm_orchard_bird_33ca',
  'alpine_meadow_cheese_farm_courtyard_bird_aba2',
  'american_southwest_sw_adobe_courtyard_bird_419b',
  'american_southwest_sw_cactus_garden_ranch_bird_19f1',
  'american_southwest_sw_canyon_river_camp_bird_6221',
  'american_southwest_sw_mesa_campground_bird_563d',
  'cozy_interiors_cozy_potting_shed_garden_bird_bd9a',
  'cozy_interiors_cozy_toymaker_workshop_bird_4e44',
  'fairytale_forest_giant_hollow_tree_library_bird_de8f',
  'france_mont_saint_michel_causeway_bird_3e43',
  'france_provence_lavender_village_bird_54c3',
  'greece_agora_ruins_garden_bird_8978',
  'greece_harbor_taverna_morning_bird_3d5d',
  'greece_hilltop_windmills_bird_b89d',
  'greece_santorini_steps_bird_4634',
  'hawaii_rainforest_waterfall_bird_0f98',
  'italy_amalfi_cliff_lemons_bird_8fae',
  'japan_morning_market_bird_f461',
  'japan_night_harbor_bird_7fea',
  'japan_temple_garden_bird_e0ef',
  'mexico_oaxaca_market_bird_fb10',
  'nordic_cold_stockholm_christmas_market_bird_53ea',
  'railway_roundhouse_garden_rail_museum_bird_1bc3',
  'southeast_asia_sea_floating_market_bird_2fa8',
  'turkey_cappadocia_balloon_dawn_bird_b03c',
]);

type BannerProvider = Pick<AdProvider, 'showBanner' | 'hideBanner'>;
const bannerUpdates = new WeakMap<BannerProvider, Promise<boolean | null>>();

/** null means intentionally suppressed; false means an attempted show failed. */
export function updateLevelBanner(
  provider: BannerProvider,
  levelId: string,
  adsEnabled: boolean,
): Promise<boolean | null> {
  // Order native operations so neither a late show nor a late hide can win
  // over the next level's banner policy. A failed operation must not jam the queue.
  const previous = bannerUpdates.get(provider) ?? Promise.resolve(null);
  const update = previous.catch(() => null).then(async (): Promise<boolean | null> => {
    if (!adsEnabled || bannerExcludedLevelIds.has(levelId)) {
      await provider.hideBanner();
      return null;
    }
    return provider.showBanner();
  });
  bannerUpdates.set(provider, update);
  return update.then((shown) => bannerUpdates.get(provider) === update ? shown : null);
}
