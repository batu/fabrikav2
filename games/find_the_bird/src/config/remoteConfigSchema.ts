import {
  booleanField,
  numberField,
  stringField,
  type ConfigFieldDefinition,
} from '@fabrikav2/services/remote-config';

export type RemoteConfigValueType = 'boolean' | 'number' | 'string';
export type RemoteConfigPrimitive = boolean | number | string;

export interface RemoteConfigValues {
  progressionHomeEnabled: boolean;
  levelMapEnabled: boolean;
  levelSequencePayload: string;
  levelSequenceSha256: string;
  rewardProgressEnabled: boolean;
  rewardProgressGoal: number;
  rewardHintsAmount: number;
  gameplayInitialHints: number;
  ratePromptEnabledDefault: boolean;
  achievementsEnabled: boolean;
  collectionUnlockLevel: number;
  sanctuaryUnlockLevel: number;
  sparrowTeaseCount: number;
  sparrowUnlockCount: number;
  sparrowHatCount: number;
  sparrowCardiganCount: number;
  robinUnlockCount: number;
  robinHatCount: number;
  robinCardiganCount: number;
  bluebirdUnlockCount: number;
  bluebirdHatCount: number;
  bluebirdCardiganCount: number;
  housePriceTier1: number;
  housePriceTier2: number;
  housePriceTier3: number;
  sanctuaryCoinsPerHourTier1: number;
  sanctuaryCoinsPerHourTier2: number;
  sanctuaryCoinsPerHourTier3: number;
  sanctuaryOfflineCapHours: number;
  findMomentBurstEnabled: boolean;
  healthBarEnabled: boolean;
  microAnimationsEnabled: boolean;
  hintRwEnabled: boolean;
  levelContinueRwEnabled: boolean;
  levelEndClaimX2Enabled: boolean;
  interstitialEveryNLevels: number;
  interstitialMinIntervalS: number;
  interstitialMinLevel: number;
  hintBoosterSingleCoinPrice: number;
  hintBoosterBundleCoinPrice: number;
  hintBoosterBundleHintAmount: number;
  levelCompleteCoinReward: number;
  levelContinueCoinPrice: number;
  noAdsVisible: boolean;
  noAdsProductId: string;
  noAdsPremiumVisible: boolean;
  noAdsPremiumProductId: string;
  noAdsPremiumHintAmount: number;
  egoOfferEnabled: boolean;
  egoOfferProductId: string;
  egoOfferHintAmount: number;
  egoOfferCoinAmount: number;
  hintPack10Visible: boolean;
  hintPack10ProductId: string;
  hintPack10HintAmount: number;
  hintPack25Visible: boolean;
  hintPack25ProductId: string;
  hintPack25HintAmount: number;
  hintPack50Visible: boolean;
  hintPack50ProductId: string;
  hintPack50HintAmount: number;
  coinPack1000Visible: boolean;
  coinPack1000ProductId: string;
  coinPack1000CoinAmount: number;
  coinPack5000Visible: boolean;
  coinPack5000ProductId: string;
  coinPack5000CoinAmount: number;
  coinPack10000Visible: boolean;
  coinPack10000ProductId: string;
  coinPack10000CoinAmount: number;
  coinPack25000Visible: boolean;
  coinPack25000ProductId: string;
  coinPack25000CoinAmount: number;
  coinPack50000Visible: boolean;
  coinPack50000ProductId: string;
  coinPack50000CoinAmount: number;
  coinPack100000Visible: boolean;
  coinPack100000ProductId: string;
  coinPack100000CoinAmount: number;
}

export type RemoteConfigValueKey = keyof RemoteConfigValues;

export interface RemoteConfigDefinition<TKey extends RemoteConfigValueKey = RemoteConfigValueKey> {
  key: TKey;
  remoteKey: string;
  type: RemoteConfigValueType;
  description: string;
}

export const REMOTE_CONFIG_DEFAULTS: RemoteConfigValues = {
  progressionHomeEnabled: true,
  levelMapEnabled: true,
  levelSequencePayload: '',
  levelSequenceSha256: '',
  rewardProgressEnabled: true,
  rewardProgressGoal: 6,
  rewardHintsAmount: 4,
  gameplayInitialHints: 3,
  ratePromptEnabledDefault: true,
  findMomentBurstEnabled: true,
  // Lives/health OFF by default (2026-08-07): losing a level to wrong taps
  // is a retention risk we want to opt into remotely, not ship on.
  // 2026-09-16: Achievements left the home nav (Sanctuary + Birds tiles took the
  // row). Off hides the tile, the claim dot and unlock toasts; unlock tracking
  // and the page itself keep working so the flag can be flipped back remotely.
  achievementsEnabled: false,
  // Collection + Sanctuary (release 1). Locked tiles advertise these two
  // levels. Both gates are ARRIVAL-based (metaGates.ts is `levels >= required
  // - 1`), so gate N opens after N-1 completions: the Collection after one, the
  // Sanctuary after six.
  //
  // 2026-09-19, set against the funnel rather than by feel. GameAnalytics game
  // 351396, 2026-08-19 to 09-19, 241 users who started level 1: 80.1% complete
  // at least one level, 69.3% two, 43.6% three, 33.2% five, 30.3% six, 24.5%
  // nine. The largest cliff is two to three completions, -25.7 points.
  //
  // The Collection sits at the floor. BootScene sends a fresh install straight
  // into level 1, so the home screen is not seen until one level is done, which
  // makes gate values 0, 1 and 2 behaviourally identical; 2 is the honest
  // spelling of that floor. It reaches 80.1% of players against 43.2% at the
  // old gate of 5.
  //
  // The Sanctuary is deliberately later. Its payoff is offline coin accrual, so
  // it only pays a player who leaves and comes back: the hook has to be
  // installed before the departure it is meant to reverse, and there is no
  // value in being earlier than that. Six completions reaches 30.3% (73 users)
  // against ~48 who ever return, so it clears the audience with margin, where
  // the old nine completions (59 users) was marginal. Not five: there the
  // tier-1 purchase lands on L6 beside the sparrow card claim, gap 0, putting
  // two celebrations on one screen.
  collectionUnlockLevel: 2,
  sanctuaryUnlockLevel: 7,
  // Below the tease count the card is fully hidden; from it the silhouette
  // and species show, so the player knows what they are collecting towards.
  // 2026-09-18 cadence pass. The two progressions take turns instead of racing:
  // the nest box's second tier opens the robin, the robin's hat opens the
  // bluebird, and every threshold is fitted to the supply that
  // tools/birdtypes/shape_ladder.py lays down, which is itself chosen from the
  // classifier's five candidates per sprite. tools/birdtypes/cadence_report.py
  // walks a player through all 92 levels; `--coverage` prints how late each card
  // can open and still finish. Re-run both before changing any number here or in
  // the prices below.
  //
  // Nothing counts before the Collection unlocks, the sparrow included, so a
  // player reaches level 5 with an empty card. That is why the sparrow's first
  // rung is only 5: it has to be claimable within a few levels of the gate and
  // still before the nest box is built. No ladder species is laid down in levels
  // 1 to 4 at all, since those pickups could only be thrown away.
  //
  // Measured order for a player who banks their coins, by the level they are
  // ENTERING when the game offers it (both tiles are arrival-based), with the
  // gap in levels:
  //   L3  sparrow card (the Collection opens at L2, one level of countdown)
  //   L7  build the nest box (4), on the level the Sanctuary opens
  //   L12 sparrow hat (5)             L22 tier 2, which opens the robin (10)
  //   L26 robin card (4)              L32 sparrow costume (6)
  //   L41 tier 3 (9)                  L43 robin hat, which opens the bluebird (2)
  //   L47 robin costume (4)           L57 bluebird card (10)
  //   L70 bluebird hat (13)           L77 bluebird costume (7)
  //
  // Only the front of the ladder moved; everything from the robin hat onward is
  // within a level of where it was.
  //
  // The sparrow's SUPPLY start moved with its gate, and that is the point of
  // the change rather than a side effect. Supply used to begin at L5 at exactly
  // 5 a level, so the card completed on L5 whatever the gate said — shipping
  // the gate alone would have shown a pill reading 0/5 for three levels, which
  // is worse than the locked tile it replaced. From L2 the player gets one
  // level of countdown and the card lands entering L3 (69.3% reach) rather than
  // L6 (33.2%).
  //
  // The rungs are also capped by what a LATE opener can still find, since a
  // species counts only from the level its card opens. At these numbers the
  // sparrow has 210 laid down from the gate against 150 needed, the robin
  // finishes even if its card opens as late as L45 (110 left against 100) and
  // the bluebird as late as L65 (51 against 50). The robin's ceiling had to
  // rise 240 -> 250 to get there: the earlier sparrows take sprites it would
  // have had, which dropped it to L45:99 against 100 needed. Its START stays at
  // L10, an anti-waste bound rather than a consequence of the Sanctuary's gate.
  // The order holds for a player who collects idle coins every third level and
  // for one who buys a hint bundle every fifteen.
  //
  // The sparrow's costume went 130 -> 150 to keep it behind the robin card: at
  // 130 the extra early supply pulled it forward onto the same level, which
  // --coverage and the order check both caught.
  //
  // This whole analysis is about a player starting fresh. An EXISTING player
  // upgrading into these numbers loses supply that moved behind them: at level
  // 40 the sparrows still ahead go 55 -> 35 while the cardigan target rises to
  // 150, and past level 50 there are none left in the rest of the game. Perfect
  // play still finishes the card; someone who missed pickups can be stranded.
  // Accepted rather than gating the numbers on install date (operator,
  // 2026-09-19), because the cohort is small and the cards are cosmetic.
  //
  // The bluebird's hat is the one gap over seven levels. It is the scarcest
  // species that has card art, so its pace is supply-bound: fixing it properly
  // means giving the third card a better-supplied species and regenerating its
  // artwork, which was considered and declined.
  //
  // The prices follow the gates by the ladder's standing rule: the first build
  // lands on the level the tile opens. Stock on arrival at L7 is 6 x 45 = 270,
  // so tier 1 is 270 (was 400 for an L10 gate). Tiers 2 and 3 rise to 650 and
  // 850 to hold the documented event order once tier 1 got cheaper; 950 for
  // tier 3 was tried and breaks the ideal line.
  sparrowTeaseCount: 2,
  sparrowUnlockCount: 5,
  sparrowHatCount: 50,
  sparrowCardiganCount: 150,
  robinUnlockCount: 10,
  robinHatCount: 80,
  robinCardiganCount: 100,
  bluebirdUnlockCount: 20,
  bluebirdHatCount: 40,
  bluebirdCardiganCount: 50,
  // 2026-09-18 economy pass, settled against BOTH kinds of player with
  // tools/birdtypes/cadence_report.py (--sweep, and --compare to see the two
  // side by side). Prices are set by when a purchase should land rather than by
  // feel: coins arrive at 45 a level and a price is affordable once the stock
  // reaches it, so each price is the stock the player is holding on its intended
  // level. 400 lands the build on the level the Sanctuary opens, 550 the second
  // tier at L25 and 750 the third at L41, each after the previous drained it.
  //
  // Idle income is deliberately small, and that is a trade rather than an
  // oversight. Idle coins pull the next purchase earlier while the bird events
  // stay where they are, and the order above puts the sparrow's costume before
  // the third upgrade, so a generous idle reward inverts that pair. The sweep is
  // unambiguous: at 15/30/60 an hour under a four-hour cap, 60 coins a
  // collection at tier 1, the order breaks for anyone collecting every three to
  // five levels, and no tier-3 price repairs it — 850 holds but squeezes the
  // non-collector's gaps to a single level. At 10/20/40 under a two-hour cap it
  // holds at every collection frequency tested, from every third level to never.
  //
  // So a full window pays 20 coins at tier 1, 40 at tier 2 and 80 at tier 3:
  // under half a level's income at the bottom and nearly two levels at the top,
  // which makes the top tier the one worth returning for. If the idle reward
  // matters more than that one ordering, the alternative is 15/30/60 under a
  // four-hour cap with tier 3 at 750, which holds for the non-collector and for
  // anyone collecting every seventh level or less often. Switching is these
  // four lines.
  housePriceTier1: 270,
  housePriceTier2: 650,
  housePriceTier3: 850,
  sanctuaryCoinsPerHourTier1: 10,
  sanctuaryCoinsPerHourTier2: 20,
  sanctuaryCoinsPerHourTier3: 40,
  sanctuaryOfflineCapHours: 2,
  healthBarEnabled: false,
  microAnimationsEnabled: false,
  hintRwEnabled: true,
  levelContinueRwEnabled: false,
  levelEndClaimX2Enabled: true,
  interstitialEveryNLevels: 3,
  interstitialMinIntervalS: 120,
  interstitialMinLevel: 0,
  hintBoosterSingleCoinPrice: 250,
  hintBoosterBundleCoinPrice: 600,
  hintBoosterBundleHintAmount: 3,
  levelCompleteCoinReward: 45,
  levelContinueCoinPrice: 900,
  noAdsVisible: true,
  noAdsProductId: 'com.basegamelab.findthebird.noads',
  noAdsPremiumVisible: true,
  noAdsPremiumProductId: 'com.basegamelab.findthebird.noadspremium',
  noAdsPremiumHintAmount: 5,
  egoOfferEnabled: true,
  egoOfferProductId: 'com.basegamelab.findthebird.levelcontinue1000coins5hints',
  egoOfferHintAmount: 5,
  egoOfferCoinAmount: 1_000,
  hintPack10Visible: true,
  hintPack10ProductId: 'com.basegamelab.findthebird.hints10',
  hintPack10HintAmount: 10,
  hintPack25Visible: true,
  hintPack25ProductId: 'com.basegamelab.findthebird.hints25',
  hintPack25HintAmount: 25,
  hintPack50Visible: true,
  hintPack50ProductId: 'com.basegamelab.findthebird.hints50',
  hintPack50HintAmount: 50,
  coinPack1000Visible: true,
  coinPack1000ProductId: 'com.basegamelab.findthebird.coins1000',
  coinPack1000CoinAmount: 1_000,
  coinPack5000Visible: true,
  coinPack5000ProductId: 'com.basegamelab.findthebird.coins5000',
  coinPack5000CoinAmount: 5_000,
  coinPack10000Visible: true,
  coinPack10000ProductId: 'com.basegamelab.findthebird.coins10000',
  coinPack10000CoinAmount: 10_000,
  coinPack25000Visible: true,
  coinPack25000ProductId: 'com.basegamelab.findthebird.coins25000',
  coinPack25000CoinAmount: 25_000,
  coinPack50000Visible: true,
  coinPack50000ProductId: 'com.basegamelab.findthebird.coins50000',
  coinPack50000CoinAmount: 50_000,
  coinPack100000Visible: true,
  coinPack100000ProductId: 'com.basegamelab.findthebird.coins100000',
  coinPack100000CoinAmount: 100_000,
} as const;

type RemoteConfigDefinitionForKey<TKey extends RemoteConfigValueKey> = {
  key: TKey;
  remoteKey: string;
  type: RemoteConfigValues[TKey] extends boolean
    ? 'boolean'
    : RemoteConfigValues[TKey] extends number
      ? 'number'
      : 'string';
  description: string;
};

export const REMOTE_CONFIG_DEFINITIONS_BY_KEY: {
  [TKey in RemoteConfigValueKey]: RemoteConfigDefinitionForKey<TKey>;
} = {
  progressionHomeEnabled: { key: 'progressionHomeEnabled', remoteKey: 'progression_home_enabled', type: 'boolean', description: 'Enable the home/progression shell.' },
  levelMapEnabled: { key: 'levelMapEnabled', remoteKey: 'level_map_enabled', type: 'boolean', description: 'Enable the vertical level-map screen.' },
  levelSequencePayload: { key: 'levelSequencePayload', remoteKey: 'level_sequence_payload', type: 'string', description: 'Complete V1 live level sequence JSON payload. Empty disables remote sequence activation.' },
  levelSequenceSha256: { key: 'levelSequenceSha256', remoteKey: 'level_sequence_sha256', type: 'string', description: 'SHA-256 hex digest for level_sequence_payload. Required when payload is non-empty.' },
  rewardProgressEnabled: { key: 'rewardProgressEnabled', remoteKey: 'reward_progress_enabled', type: 'boolean', description: 'Enable home reward-progress loop.' },
  rewardProgressGoal: { key: 'rewardProgressGoal', remoteKey: 'reward_progress_goal', type: 'number', description: 'Level completions required for the home reward.' },
  rewardHintsAmount: { key: 'rewardHintsAmount', remoteKey: 'reward_hints_amount', type: 'number', description: 'Hints granted when reward progress completes.' },
  gameplayInitialHints: { key: 'gameplayInitialHints', remoteKey: 'gameplay_initial_hints', type: 'number', description: 'Default starting hints for new players.' },
  ratePromptEnabledDefault: { key: 'ratePromptEnabledDefault', remoteKey: 'rate_prompt_enabled_default', type: 'boolean', description: 'Default rate prompt availability for fresh installs.' },
  findMomentBurstEnabled: { key: 'findMomentBurstEnabled', remoteKey: 'find_moment_burst_enabled', type: 'boolean', description: 'Enable small find-moment burst feedback.' },
  achievementsEnabled: { key: 'achievementsEnabled', remoteKey: 'achievements_enabled', type: 'boolean', description: 'Show the Achievements home tile, claim dot and unlock toasts. Off hides the entry point; progress tracking continues.' },
  collectionUnlockLevel: { key: 'collectionUnlockLevel', remoteKey: 'collection_unlock_level', type: 'number', description: 'Completed levels required before the Collection home tile unlocks.' },
  sanctuaryUnlockLevel: { key: 'sanctuaryUnlockLevel', remoteKey: 'sanctuary_unlock_level', type: 'number', description: 'Completed levels required before the Sanctuary home tile unlocks (with the sparrow count).' },
  sparrowTeaseCount: { key: 'sparrowTeaseCount', remoteKey: 'sparrow_tease_count', type: 'number', description: 'Sparrow pickups that reveal the silhouette and species on the locked card.' },
  sparrowUnlockCount: { key: 'sparrowUnlockCount', remoteKey: 'sparrow_unlock_count', type: 'number', description: 'Sparrow pickups that unlock the sparrow card and open the Sanctuary tile.' },
  sparrowHatCount: { key: 'sparrowHatCount', remoteKey: 'sparrow_hat_count', type: 'number', description: 'Sparrow pickups that unlock the sparrow hat costume.' },
  sparrowCardiganCount: { key: 'sparrowCardiganCount', remoteKey: 'sparrow_cardigan_count', type: 'number', description: 'Sparrow pickups that unlock the sparrow cardigan costume (final state).' },
  robinUnlockCount: { key: 'robinUnlockCount', remoteKey: 'robin_unlock_count', type: 'number', description: 'Robin pickups that unlock the robin card.' },
  robinHatCount: { key: 'robinHatCount', remoteKey: 'robin_hat_count', type: 'number', description: 'Robin pickups that unlock the robin hat costume.' },
  robinCardiganCount: { key: 'robinCardiganCount', remoteKey: 'robin_cardigan_count', type: 'number', description: 'Robin pickups that unlock the robin full costume.' },
  bluebirdUnlockCount: { key: 'bluebirdUnlockCount', remoteKey: 'bluebird_unlock_count', type: 'number', description: 'Bluebird pickups that unlock the bluebird card.' },
  bluebirdHatCount: { key: 'bluebirdHatCount', remoteKey: 'bluebird_hat_count', type: 'number', description: 'Bluebird pickups that unlock the bluebird hat costume.' },
  bluebirdCardiganCount: { key: 'bluebirdCardiganCount', remoteKey: 'bluebird_cardigan_count', type: 'number', description: 'Bluebird pickups that unlock the bluebird full costume.' },
  housePriceTier1: { key: 'housePriceTier1', remoteKey: 'house_price_tier_1', type: 'number', description: 'Coin price to build the tier-1 nest box in the Sanctuary.' },
  housePriceTier2: { key: 'housePriceTier2', remoteKey: 'house_price_tier_2', type: 'number', description: 'Coin price to upgrade the nest box to tier 2.' },
  housePriceTier3: { key: 'housePriceTier3', remoteKey: 'house_price_tier_3', type: 'number', description: 'Coin price to upgrade the nest box to tier 3.' },
  sanctuaryCoinsPerHourTier1: { key: 'sanctuaryCoinsPerHourTier1', remoteKey: 'sanctuary_coins_per_hour_tier_1', type: 'number', description: 'Coins accrued per hour by a tier-1 house with at least one bird housed.' },
  sanctuaryCoinsPerHourTier2: { key: 'sanctuaryCoinsPerHourTier2', remoteKey: 'sanctuary_coins_per_hour_tier_2', type: 'number', description: 'Coins accrued per hour by a tier-2 house with at least one bird housed.' },
  sanctuaryCoinsPerHourTier3: { key: 'sanctuaryCoinsPerHourTier3', remoteKey: 'sanctuary_coins_per_hour_tier_3', type: 'number', description: 'Coins accrued per hour by a tier-3 house with at least one bird housed.' },
  sanctuaryOfflineCapHours: { key: 'sanctuaryOfflineCapHours', remoteKey: 'sanctuary_offline_cap_hours', type: 'number', description: 'Maximum hours of Sanctuary coin accrual banked while away.' },
  healthBarEnabled: { key: 'healthBarEnabled', remoteKey: 'health_bar_enabled', type: 'boolean', description: 'Show the lives/health bar and let wrong taps fail the level.' },
  microAnimationsEnabled: { key: 'microAnimationsEnabled', remoteKey: 'micro_animations_enabled', type: 'boolean', description: 'Enable subtle in-level micro animations.' },
  hintRwEnabled: { key: 'hintRwEnabled', remoteKey: 'hint_rw_enabled', type: 'boolean', description: 'Enable rewarded-ad hint acquisition when hints are empty.' },
  levelContinueRwEnabled: { key: 'levelContinueRwEnabled', remoteKey: 'level_continue_rw_enabled', type: 'boolean', description: 'Deprecated no-op: fail-screen rewarded-ad continue was removed.' },
  levelEndClaimX2Enabled: { key: 'levelEndClaimX2Enabled', remoteKey: 'level_end_claim_x2_enabled', type: 'boolean', description: 'Enable rewarded-ad completion coin doubling.' },
  interstitialEveryNLevels: { key: 'interstitialEveryNLevels', remoteKey: 'interstitial_every_n_levels', type: 'number', description: 'Show an interstitial after every Nth countable completed level; progress persists across launches and saturates at N. 0 disables interstitials.' },
  interstitialMinIntervalS: { key: 'interstitialMinIntervalS', remoteKey: 'interstitial_min_interval_s', type: 'number', description: 'Minimum seconds between interstitial impressions.' },
  interstitialMinLevel: { key: 'interstitialMinLevel', remoteKey: 'interstitial_min_level', type: 'number', description: 'First level number (1-based) at which interstitials may show. 0 = no floor.' },
  hintBoosterSingleCoinPrice: { key: 'hintBoosterSingleCoinPrice', remoteKey: 'hint_booster_single_coin_price', type: 'number', description: 'Coin price for one hint.' },
  hintBoosterBundleCoinPrice: { key: 'hintBoosterBundleCoinPrice', remoteKey: 'hint_booster_bundle_coin_price', type: 'number', description: 'Coin price for hint bundle.' },
  hintBoosterBundleHintAmount: { key: 'hintBoosterBundleHintAmount', remoteKey: 'hint_booster_bundle_hint_amount', type: 'number', description: 'Hints granted by bundle purchase.' },
  levelCompleteCoinReward: { key: 'levelCompleteCoinReward', remoteKey: 'level_complete_coin_reward', type: 'number', description: 'Base coins granted on level completion.' },
  levelContinueCoinPrice: { key: 'levelContinueCoinPrice', remoteKey: 'level_continue_coin_price', type: 'number', description: 'Coin price for level continue.' },
  noAdsVisible: { key: 'noAdsVisible', remoteKey: 'no_ads_visible', type: 'boolean', description: 'Show No-Ads offer.' },
  noAdsProductId: { key: 'noAdsProductId', remoteKey: 'no_ads_product_id', type: 'string', description: 'Store product ID for No-Ads.' },
  noAdsPremiumVisible: { key: 'noAdsPremiumVisible', remoteKey: 'no_ads_premium_visible', type: 'boolean', description: 'Show No-Ads Premium offer.' },
  noAdsPremiumProductId: { key: 'noAdsPremiumProductId', remoteKey: 'no_ads_premium_product_id', type: 'string', description: 'Store product ID for No-Ads Premium.' },
  noAdsPremiumHintAmount: { key: 'noAdsPremiumHintAmount', remoteKey: 'no_ads_premium_hint_amount', type: 'number', description: 'Hints granted by No-Ads Premium.' },
  egoOfferEnabled: { key: 'egoOfferEnabled', remoteKey: 'ego_offer_enabled', type: 'boolean', description: 'Enable fail-screen continue + hints offer.' },
  egoOfferProductId: { key: 'egoOfferProductId', remoteKey: 'ego_offer_product_id', type: 'string', description: 'Store product ID for fail-screen ego offer.' },
  egoOfferHintAmount: { key: 'egoOfferHintAmount', remoteKey: 'ego_offer_hint_amount', type: 'number', description: 'Hints granted by ego offer.' },
  egoOfferCoinAmount: { key: 'egoOfferCoinAmount', remoteKey: 'ego_offer_coin_amount', type: 'number', description: 'Coins granted by ego offer.' },
  hintPack10Visible: { key: 'hintPack10Visible', remoteKey: 'hint_pack_10_visible', type: 'boolean', description: 'Show 10-hint pack.' },
  hintPack10ProductId: { key: 'hintPack10ProductId', remoteKey: 'hint_pack_10_product_id', type: 'string', description: 'Store product ID for 10-hint pack.' },
  hintPack10HintAmount: { key: 'hintPack10HintAmount', remoteKey: 'hint_pack_10_hint_amount', type: 'number', description: 'Hints granted by 10-hint pack.' },
  hintPack25Visible: { key: 'hintPack25Visible', remoteKey: 'hint_pack_25_visible', type: 'boolean', description: 'Show 25-hint pack.' },
  hintPack25ProductId: { key: 'hintPack25ProductId', remoteKey: 'hint_pack_25_product_id', type: 'string', description: 'Store product ID for 25-hint pack.' },
  hintPack25HintAmount: { key: 'hintPack25HintAmount', remoteKey: 'hint_pack_25_hint_amount', type: 'number', description: 'Hints granted by 25-hint pack.' },
  hintPack50Visible: { key: 'hintPack50Visible', remoteKey: 'hint_pack_50_visible', type: 'boolean', description: 'Show 50-hint pack.' },
  hintPack50ProductId: { key: 'hintPack50ProductId', remoteKey: 'hint_pack_50_product_id', type: 'string', description: 'Store product ID for 50-hint pack.' },
  hintPack50HintAmount: { key: 'hintPack50HintAmount', remoteKey: 'hint_pack_50_hint_amount', type: 'number', description: 'Hints granted by 50-hint pack.' },
  coinPack1000Visible: { key: 'coinPack1000Visible', remoteKey: 'coin_pack_1000_visible', type: 'boolean', description: 'Show 1,000-coin pack.' },
  coinPack1000ProductId: { key: 'coinPack1000ProductId', remoteKey: 'coin_pack_1000_product_id', type: 'string', description: 'Store product ID for 1,000-coin pack.' },
  coinPack1000CoinAmount: { key: 'coinPack1000CoinAmount', remoteKey: 'coin_pack_1000_coin_amount', type: 'number', description: 'Coins granted by 1,000-coin pack.' },
  coinPack5000Visible: { key: 'coinPack5000Visible', remoteKey: 'coin_pack_5000_visible', type: 'boolean', description: 'Show 5,000-coin pack.' },
  coinPack5000ProductId: { key: 'coinPack5000ProductId', remoteKey: 'coin_pack_5000_product_id', type: 'string', description: 'Store product ID for 5,000-coin pack.' },
  coinPack5000CoinAmount: { key: 'coinPack5000CoinAmount', remoteKey: 'coin_pack_5000_coin_amount', type: 'number', description: 'Coins granted by 5,000-coin pack.' },
  coinPack10000Visible: { key: 'coinPack10000Visible', remoteKey: 'coin_pack_10000_visible', type: 'boolean', description: 'Show 10,000-coin pack.' },
  coinPack10000ProductId: { key: 'coinPack10000ProductId', remoteKey: 'coin_pack_10000_product_id', type: 'string', description: 'Store product ID for 10,000-coin pack.' },
  coinPack10000CoinAmount: { key: 'coinPack10000CoinAmount', remoteKey: 'coin_pack_10000_coin_amount', type: 'number', description: 'Coins granted by 10,000-coin pack.' },
  coinPack25000Visible: { key: 'coinPack25000Visible', remoteKey: 'coin_pack_25000_visible', type: 'boolean', description: 'Show 25,000-coin pack.' },
  coinPack25000ProductId: { key: 'coinPack25000ProductId', remoteKey: 'coin_pack_25000_product_id', type: 'string', description: 'Store product ID for 25,000-coin pack.' },
  coinPack25000CoinAmount: { key: 'coinPack25000CoinAmount', remoteKey: 'coin_pack_25000_coin_amount', type: 'number', description: 'Coins granted by 25,000-coin pack.' },
  coinPack50000Visible: { key: 'coinPack50000Visible', remoteKey: 'coin_pack_50000_visible', type: 'boolean', description: 'Show 50,000-coin pack.' },
  coinPack50000ProductId: { key: 'coinPack50000ProductId', remoteKey: 'coin_pack_50000_product_id', type: 'string', description: 'Store product ID for 50,000-coin pack.' },
  coinPack50000CoinAmount: { key: 'coinPack50000CoinAmount', remoteKey: 'coin_pack_50000_coin_amount', type: 'number', description: 'Coins granted by 50,000-coin pack.' },
  coinPack100000Visible: { key: 'coinPack100000Visible', remoteKey: 'coin_pack_100000_visible', type: 'boolean', description: 'Show 100,000-coin pack.' },
  coinPack100000ProductId: { key: 'coinPack100000ProductId', remoteKey: 'coin_pack_100000_product_id', type: 'string', description: 'Store product ID for 100,000-coin pack.' },
  coinPack100000CoinAmount: { key: 'coinPack100000CoinAmount', remoteKey: 'coin_pack_100000_coin_amount', type: 'number', description: 'Coins granted by 100,000-coin pack.' },
};

export const REMOTE_CONFIG_DEFINITIONS: readonly RemoteConfigDefinition[] = Object.values(
  REMOTE_CONFIG_DEFINITIONS_BY_KEY,
);

export type FtdRemoteConfigSchema = {
  readonly [TKey in RemoteConfigValueKey]: ConfigFieldDefinition<RemoteConfigValues[TKey]>;
};

function validRemoteNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validRemoteString(value: string): boolean {
  return value.trim().length > 0;
}

function sharedFieldFor(
  definition: RemoteConfigDefinition,
): ConfigFieldDefinition {
  const options = {
    remoteKey: definition.remoteKey,
    description: definition.description,
  };
  const defaultValue = REMOTE_CONFIG_DEFAULTS[definition.key];
  if (definition.type === 'boolean') {
    return booleanField(defaultValue as boolean, options);
  }
  if (definition.type === 'number') {
    return numberField(defaultValue as number, {
      ...options,
      validate: validRemoteNumber,
    });
  }
  return stringField(defaultValue as string, {
    ...options,
    validate: validRemoteString,
  });
}

/** The game-owned schema consumed by @fabrikav2/services/remote-config. */
export const ftdRemoteConfigSchema = Object.fromEntries(
  REMOTE_CONFIG_DEFINITIONS.map((definition) => [definition.key, sharedFieldFor(definition)]),
) as FtdRemoteConfigSchema;

export function mapRemoteConfigValues(
  read: <TKey extends RemoteConfigValueKey>(key: TKey) => RemoteConfigValues[TKey],
): RemoteConfigValues {
  return {
    progressionHomeEnabled: read('progressionHomeEnabled'),
    levelMapEnabled: read('levelMapEnabled'),
    levelSequencePayload: read('levelSequencePayload'),
    levelSequenceSha256: read('levelSequenceSha256'),
    rewardProgressEnabled: read('rewardProgressEnabled'),
    rewardProgressGoal: read('rewardProgressGoal'),
    rewardHintsAmount: read('rewardHintsAmount'),
    gameplayInitialHints: read('gameplayInitialHints'),
    ratePromptEnabledDefault: read('ratePromptEnabledDefault'),
    findMomentBurstEnabled: read('findMomentBurstEnabled'),
    achievementsEnabled: read('achievementsEnabled'),
    collectionUnlockLevel: read('collectionUnlockLevel'),
    sanctuaryUnlockLevel: read('sanctuaryUnlockLevel'),
    sparrowTeaseCount: read('sparrowTeaseCount'),
    sparrowUnlockCount: read('sparrowUnlockCount'),
    sparrowHatCount: read('sparrowHatCount'),
    sparrowCardiganCount: read('sparrowCardiganCount'),
    robinUnlockCount: read('robinUnlockCount'),
    robinHatCount: read('robinHatCount'),
    robinCardiganCount: read('robinCardiganCount'),
    bluebirdUnlockCount: read('bluebirdUnlockCount'),
    bluebirdHatCount: read('bluebirdHatCount'),
    bluebirdCardiganCount: read('bluebirdCardiganCount'),
    housePriceTier1: read('housePriceTier1'),
    housePriceTier2: read('housePriceTier2'),
    housePriceTier3: read('housePriceTier3'),
    sanctuaryCoinsPerHourTier1: read('sanctuaryCoinsPerHourTier1'),
    sanctuaryCoinsPerHourTier2: read('sanctuaryCoinsPerHourTier2'),
    sanctuaryCoinsPerHourTier3: read('sanctuaryCoinsPerHourTier3'),
    sanctuaryOfflineCapHours: read('sanctuaryOfflineCapHours'),
    healthBarEnabled: read('healthBarEnabled'),
    microAnimationsEnabled: read('microAnimationsEnabled'),
    hintRwEnabled: read('hintRwEnabled'),
    levelContinueRwEnabled: read('levelContinueRwEnabled'),
    levelEndClaimX2Enabled: read('levelEndClaimX2Enabled'),
    interstitialEveryNLevels: read('interstitialEveryNLevels'),
    interstitialMinIntervalS: read('interstitialMinIntervalS'),
    interstitialMinLevel: read('interstitialMinLevel'),
    hintBoosterSingleCoinPrice: read('hintBoosterSingleCoinPrice'),
    hintBoosterBundleCoinPrice: read('hintBoosterBundleCoinPrice'),
    hintBoosterBundleHintAmount: read('hintBoosterBundleHintAmount'),
    levelCompleteCoinReward: read('levelCompleteCoinReward'),
    levelContinueCoinPrice: read('levelContinueCoinPrice'),
    noAdsVisible: read('noAdsVisible'),
    noAdsProductId: read('noAdsProductId'),
    noAdsPremiumVisible: read('noAdsPremiumVisible'),
    noAdsPremiumProductId: read('noAdsPremiumProductId'),
    noAdsPremiumHintAmount: read('noAdsPremiumHintAmount'),
    egoOfferEnabled: read('egoOfferEnabled'),
    egoOfferProductId: read('egoOfferProductId'),
    egoOfferHintAmount: read('egoOfferHintAmount'),
    egoOfferCoinAmount: read('egoOfferCoinAmount'),
    hintPack10Visible: read('hintPack10Visible'),
    hintPack10ProductId: read('hintPack10ProductId'),
    hintPack10HintAmount: read('hintPack10HintAmount'),
    hintPack25Visible: read('hintPack25Visible'),
    hintPack25ProductId: read('hintPack25ProductId'),
    hintPack25HintAmount: read('hintPack25HintAmount'),
    hintPack50Visible: read('hintPack50Visible'),
    hintPack50ProductId: read('hintPack50ProductId'),
    hintPack50HintAmount: read('hintPack50HintAmount'),
    coinPack1000Visible: read('coinPack1000Visible'),
    coinPack1000ProductId: read('coinPack1000ProductId'),
    coinPack1000CoinAmount: read('coinPack1000CoinAmount'),
    coinPack5000Visible: read('coinPack5000Visible'),
    coinPack5000ProductId: read('coinPack5000ProductId'),
    coinPack5000CoinAmount: read('coinPack5000CoinAmount'),
    coinPack10000Visible: read('coinPack10000Visible'),
    coinPack10000ProductId: read('coinPack10000ProductId'),
    coinPack10000CoinAmount: read('coinPack10000CoinAmount'),
    coinPack25000Visible: read('coinPack25000Visible'),
    coinPack25000ProductId: read('coinPack25000ProductId'),
    coinPack25000CoinAmount: read('coinPack25000CoinAmount'),
    coinPack50000Visible: read('coinPack50000Visible'),
    coinPack50000ProductId: read('coinPack50000ProductId'),
    coinPack50000CoinAmount: read('coinPack50000CoinAmount'),
    coinPack100000Visible: read('coinPack100000Visible'),
    coinPack100000ProductId: read('coinPack100000ProductId'),
    coinPack100000CoinAmount: read('coinPack100000CoinAmount'),
  };
}

export function mapRemoteConfigSources<TSource>(
  read: (key: RemoteConfigValueKey) => TSource,
): Record<RemoteConfigValueKey, TSource> {
  return {
    progressionHomeEnabled: read('progressionHomeEnabled'),
    levelMapEnabled: read('levelMapEnabled'),
    levelSequencePayload: read('levelSequencePayload'),
    levelSequenceSha256: read('levelSequenceSha256'),
    rewardProgressEnabled: read('rewardProgressEnabled'),
    rewardProgressGoal: read('rewardProgressGoal'),
    rewardHintsAmount: read('rewardHintsAmount'),
    gameplayInitialHints: read('gameplayInitialHints'),
    ratePromptEnabledDefault: read('ratePromptEnabledDefault'),
    findMomentBurstEnabled: read('findMomentBurstEnabled'),
    achievementsEnabled: read('achievementsEnabled'),
    collectionUnlockLevel: read('collectionUnlockLevel'),
    sanctuaryUnlockLevel: read('sanctuaryUnlockLevel'),
    sparrowTeaseCount: read('sparrowTeaseCount'),
    sparrowUnlockCount: read('sparrowUnlockCount'),
    sparrowHatCount: read('sparrowHatCount'),
    sparrowCardiganCount: read('sparrowCardiganCount'),
    robinUnlockCount: read('robinUnlockCount'),
    robinHatCount: read('robinHatCount'),
    robinCardiganCount: read('robinCardiganCount'),
    bluebirdUnlockCount: read('bluebirdUnlockCount'),
    bluebirdHatCount: read('bluebirdHatCount'),
    bluebirdCardiganCount: read('bluebirdCardiganCount'),
    housePriceTier1: read('housePriceTier1'),
    housePriceTier2: read('housePriceTier2'),
    housePriceTier3: read('housePriceTier3'),
    sanctuaryCoinsPerHourTier1: read('sanctuaryCoinsPerHourTier1'),
    sanctuaryCoinsPerHourTier2: read('sanctuaryCoinsPerHourTier2'),
    sanctuaryCoinsPerHourTier3: read('sanctuaryCoinsPerHourTier3'),
    sanctuaryOfflineCapHours: read('sanctuaryOfflineCapHours'),
    healthBarEnabled: read('healthBarEnabled'),
    microAnimationsEnabled: read('microAnimationsEnabled'),
    hintRwEnabled: read('hintRwEnabled'),
    levelContinueRwEnabled: read('levelContinueRwEnabled'),
    levelEndClaimX2Enabled: read('levelEndClaimX2Enabled'),
    interstitialEveryNLevels: read('interstitialEveryNLevels'),
    interstitialMinIntervalS: read('interstitialMinIntervalS'),
    interstitialMinLevel: read('interstitialMinLevel'),
    hintBoosterSingleCoinPrice: read('hintBoosterSingleCoinPrice'),
    hintBoosterBundleCoinPrice: read('hintBoosterBundleCoinPrice'),
    hintBoosterBundleHintAmount: read('hintBoosterBundleHintAmount'),
    levelCompleteCoinReward: read('levelCompleteCoinReward'),
    levelContinueCoinPrice: read('levelContinueCoinPrice'),
    noAdsVisible: read('noAdsVisible'),
    noAdsProductId: read('noAdsProductId'),
    noAdsPremiumVisible: read('noAdsPremiumVisible'),
    noAdsPremiumProductId: read('noAdsPremiumProductId'),
    noAdsPremiumHintAmount: read('noAdsPremiumHintAmount'),
    egoOfferEnabled: read('egoOfferEnabled'),
    egoOfferProductId: read('egoOfferProductId'),
    egoOfferHintAmount: read('egoOfferHintAmount'),
    egoOfferCoinAmount: read('egoOfferCoinAmount'),
    hintPack10Visible: read('hintPack10Visible'),
    hintPack10ProductId: read('hintPack10ProductId'),
    hintPack10HintAmount: read('hintPack10HintAmount'),
    hintPack25Visible: read('hintPack25Visible'),
    hintPack25ProductId: read('hintPack25ProductId'),
    hintPack25HintAmount: read('hintPack25HintAmount'),
    hintPack50Visible: read('hintPack50Visible'),
    hintPack50ProductId: read('hintPack50ProductId'),
    hintPack50HintAmount: read('hintPack50HintAmount'),
    coinPack1000Visible: read('coinPack1000Visible'),
    coinPack1000ProductId: read('coinPack1000ProductId'),
    coinPack1000CoinAmount: read('coinPack1000CoinAmount'),
    coinPack5000Visible: read('coinPack5000Visible'),
    coinPack5000ProductId: read('coinPack5000ProductId'),
    coinPack5000CoinAmount: read('coinPack5000CoinAmount'),
    coinPack10000Visible: read('coinPack10000Visible'),
    coinPack10000ProductId: read('coinPack10000ProductId'),
    coinPack10000CoinAmount: read('coinPack10000CoinAmount'),
    coinPack25000Visible: read('coinPack25000Visible'),
    coinPack25000ProductId: read('coinPack25000ProductId'),
    coinPack25000CoinAmount: read('coinPack25000CoinAmount'),
    coinPack50000Visible: read('coinPack50000Visible'),
    coinPack50000ProductId: read('coinPack50000ProductId'),
    coinPack50000CoinAmount: read('coinPack50000CoinAmount'),
    coinPack100000Visible: read('coinPack100000Visible'),
    coinPack100000ProductId: read('coinPack100000ProductId'),
    coinPack100000CoinAmount: read('coinPack100000CoinAmount'),
  };
}

export function firebaseDefaultConfig(): Record<string, RemoteConfigPrimitive> {
  const config: Record<string, RemoteConfigPrimitive> = {};
  for (const definition of REMOTE_CONFIG_DEFINITIONS) {
    config[definition.remoteKey] = REMOTE_CONFIG_DEFAULTS[definition.key];
  }
  return config;
}
