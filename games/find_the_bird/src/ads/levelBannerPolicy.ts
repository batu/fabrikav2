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

  // 2026-09-16 intake: 14% placement band audit (banner_audit14.py), birds intrude on these.
  'ad_campaigns_ad_bazaar_alley_bird_3663',
  'ad_campaigns_ad_snowy_chalet_bird_c64d',
  'ad_campaigns_ad_treehouse_village_bird_24d4',
  'american_southwest_sw_adobe_courtyard_bird_4588',
  'ancient_egyptian_compounds_bakers_enclosure_bird_3e39',
  'ancient_egyptian_compounds_scribes_workyard_bird_5094',
  'aquarium_halls_kelp_gallery_bird_c7fa',
  'below_decks_captains_cabin_bird_3b68',
  'below_decks_galley_bird_6b76',
  'castle_keep_great_hall_bird_a6ff',
  'circus_service_compounds_wagon_court_bird_2242',
  'clockwork_workyards_automaton_assembly_bird_e6bf',
  'coral_reef_coral_bommie_garden_bird_86ae',
  'coral_reef_tidal_pool_labyrinth_bird_5dd7',
  'cozy_interiors_cozy_greenhouse_conservatory_bird_73c9',
  'cozy_interiors_cozy_village_bakery_kitchen_bird_3830',
  'france_alsace_wine_village_bird_1d5c',
  'france_montmartre_cafe_terrace_bird_a9c4',
  'grand_interiors_covered_arcade_bird_95e5',
  'grand_interiors_museum_hall_bird_3368',
  'grand_interiors_opera_backstage_bird_dd52',
  'grand_interiors_reading_room_bird_0feb',
  'greece_olive_grove_press_bird_dcce',
  'indian_craft_bazaars_block_printing_quarter_bird_7a65',
  'indian_craft_bazaars_puppet_workshop_bird_08b8',
  'japan_festival_grounds_bird_12fb',
  'mexico_dia_de_muertos_plaza_bird_66a9',
  'mexico_guanajuato_rainbow_alley_bird_1872',
  'mexico_yucatan_cenote_ruins_bird_9fc3',
  'municipal_service_yards_firehouse_court_bird_1d4e',
  'nordic_cold_icelandic_geothermal_town_bird_09ae',
  'nordic_cold_sami_aurora_camp_bird_589b',
  'pirate_shipwreck_island_jungle_cave_shore_bird_1c98',
  'prehistoric_dig_enclosures_fossil_pit_bird_f78c',
  'railway_roundhouse_luggage_island_depot_bird_1480',
  'railway_roundhouse_sleepy_mountain_rail_stop_bird_e325',
  'southeast_asia_sea_floating_market_bird_8d44',
  'sweet_factory_chocolate_hall_bird_950a',
  'turkey_bodrum_marina_sunset_bird_0e4f',
  'turkey_grand_bazaar_corridor_bird_2dd8',
  'uk_london_high_street_bird_06d0',
  'uk_oxford_college_quad_bird_0a66',
  'uk_scottish_highlands_pub_bird_099a',
  'uk_seaside_pier_bird_4b96',
  'underground_crystal_grotto_bird_43ad',
  'underground_metro_concourse_bird_94a1',
  'underground_wine_cellars_bird_2c71',
  'walled_gardens_cloister_herbarium_bird_1c66',
  'walled_gardens_kitchen_garden_bird_3118',
  'walled_gardens_riad_courtyard_bird_5a77',
  'coral_reef_shipwreck_reef_camp_bird_d61b',
  'fairytale_forest_fairy_ring_picnic_bird_9ed2',
  'italy_sicilian_fish_market_bird_fc3c',
  'italy_tuscan_hill_village_bird_a61f',
  'japan_river_bridge_district_bird_0027',
  'walled_gardens_kitchen_garden_bird_6759',
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
