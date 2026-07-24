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
  findMomentBurstEnabled: boolean;
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
  noAdsProductId: 'com.baseardahan.hiddenobj.noads3',
  noAdsPremiumVisible: true,
  noAdsPremiumProductId: 'com.baseardahan.hiddenobj.noadspremium2',
  noAdsPremiumHintAmount: 5,
  egoOfferEnabled: true,
  egoOfferProductId: 'com.baseardahan.hiddenobj.levelcontinue1000coins5hints',
  egoOfferHintAmount: 5,
  egoOfferCoinAmount: 1_000,
  hintPack10Visible: true,
  hintPack10ProductId: 'com.baseardahan.hiddenobj.hints10x',
  hintPack10HintAmount: 10,
  hintPack25Visible: true,
  hintPack25ProductId: 'com.baseardahan.hiddenobj.hints25x',
  hintPack25HintAmount: 25,
  hintPack50Visible: true,
  hintPack50ProductId: 'com.baseardahan.hiddenobj.hints50x',
  hintPack50HintAmount: 50,
  coinPack1000Visible: true,
  coinPack1000ProductId: 'com.baseardahan.hiddenobj.coins1000',
  coinPack1000CoinAmount: 1_000,
  coinPack5000Visible: true,
  coinPack5000ProductId: 'com.baseardahan.hiddenobj.coins5000',
  coinPack5000CoinAmount: 5_000,
  coinPack10000Visible: true,
  coinPack10000ProductId: 'com.baseardahan.hiddenobj.coins10000',
  coinPack10000CoinAmount: 10_000,
  coinPack25000Visible: true,
  coinPack25000ProductId: 'com.baseardahan.hiddenobj.coins25000',
  coinPack25000CoinAmount: 25_000,
  coinPack50000Visible: true,
  coinPack50000ProductId: 'com.baseardahan.hiddenobj.coins50000',
  coinPack50000CoinAmount: 50_000,
  coinPack100000Visible: true,
  coinPack100000ProductId: 'com.baseardahan.hiddenobj.coins100000',
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
  microAnimationsEnabled: { key: 'microAnimationsEnabled', remoteKey: 'micro_animations_enabled', type: 'boolean', description: 'Enable subtle in-level micro animations.' },
  hintRwEnabled: { key: 'hintRwEnabled', remoteKey: 'hint_rw_enabled', type: 'boolean', description: 'Enable rewarded-ad hint acquisition when hints are empty.' },
  levelContinueRwEnabled: { key: 'levelContinueRwEnabled', remoteKey: 'level_continue_rw_enabled', type: 'boolean', description: 'Deprecated no-op: fail-screen rewarded-ad continue was removed.' },
  levelEndClaimX2Enabled: { key: 'levelEndClaimX2Enabled', remoteKey: 'level_end_claim_x2_enabled', type: 'boolean', description: 'Enable rewarded-ad completion coin doubling.' },
  interstitialEveryNLevels: { key: 'interstitialEveryNLevels', remoteKey: 'interstitial_every_n_levels', type: 'number', description: 'Show an interstitial after every Nth completed level this session. 0 disables interstitials.' },
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
