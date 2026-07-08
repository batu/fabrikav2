import {
  REMOTE_CONFIG_DEFAULTS,
  REMOTE_CONFIG_DEFINITIONS,
  type RemoteConfigDefinition,
  type RemoteConfigPrimitive,
  type RemoteConfigValueKey,
  type RemoteConfigValueType,
} from './remoteConfigSchema.ts';

type FirebaseRemoteConfigValueType = 'BOOLEAN' | 'NUMBER' | 'STRING';

export interface FirebaseRemoteConfigParameter {
  defaultValue: { value: string };
  description: string;
  valueType: FirebaseRemoteConfigValueType;
}

export interface FirebaseRemoteConfigParameterGroup {
  description: string;
  parameters: Record<string, FirebaseRemoteConfigParameter>;
}

export interface FirebaseRemoteConfigTemplate {
  conditions: [];
  parameters: Record<string, never>;
  parameterGroups: Record<string, FirebaseRemoteConfigParameterGroup>;
}

interface RemoteConfigTemplateGroup {
  name: string;
  description: string;
  keys: readonly RemoteConfigValueKey[];
}

const TEMPLATE_GROUPS: readonly RemoteConfigTemplateGroup[] = [
  {
    name: 'Progression And Home',
    description: 'Home shell, map, reward progress, startup, and player-facing progression defaults.',
    keys: [
      'progressionHomeEnabled',
      'levelMapEnabled',
      'levelSequencePayload',
      'levelSequenceSha256',
      'rewardProgressEnabled',
      'rewardProgressGoal',
      'rewardHintsAmount',
      'gameplayInitialHints',
      'ratePromptEnabledDefault',
    ],
  },
  {
    name: 'Rewards And Continues',
    description: 'Rewarded-ad availability and soft-currency economy values.',
    keys: [
      'hintRwEnabled',
      'levelContinueRwEnabled',
      'levelEndClaimX2Enabled',
      'hintBoosterSingleCoinPrice',
      'hintBoosterBundleCoinPrice',
      'hintBoosterBundleHintAmount',
      'levelCompleteCoinReward',
      'levelContinueCoinPrice',
    ],
  },
  {
    name: 'Ads',
    description: 'Interstitial cadence: every-Nth-level gate, frequency cap, and first eligible level.',
    keys: [
      'interstitialEveryNLevels',
      'interstitialMinIntervalS',
      'interstitialMinLevel',
    ],
  },
  {
    name: 'Shop And Offers',
    description: 'Client-visible product IDs, offer visibility, and fulfillment grant quantities.',
    keys: [
      'noAdsVisible',
      'noAdsProductId',
      'noAdsPremiumVisible',
      'noAdsPremiumProductId',
      'noAdsPremiumHintAmount',
      'egoOfferEnabled',
      'egoOfferProductId',
      'egoOfferHintAmount',
      'egoOfferCoinAmount',
      'hintPack10Visible',
      'hintPack10ProductId',
      'hintPack10HintAmount',
      'hintPack25Visible',
      'hintPack25ProductId',
      'hintPack25HintAmount',
      'hintPack50Visible',
      'hintPack50ProductId',
      'hintPack50HintAmount',
      'coinPack1000Visible',
      'coinPack1000ProductId',
      'coinPack1000CoinAmount',
      'coinPack5000Visible',
      'coinPack5000ProductId',
      'coinPack5000CoinAmount',
      'coinPack10000Visible',
      'coinPack10000ProductId',
      'coinPack10000CoinAmount',
      'coinPack25000Visible',
      'coinPack25000ProductId',
      'coinPack25000CoinAmount',
      'coinPack50000Visible',
      'coinPack50000ProductId',
      'coinPack50000CoinAmount',
      'coinPack100000Visible',
      'coinPack100000ProductId',
      'coinPack100000CoinAmount',
    ],
  },
  {
    name: 'Polish',
    description: 'Visual polish rollout flags for effects and in-level motion.',
    keys: [
      'transitionConfettiEnabled',
      'findMomentBurstEnabled',
      'microAnimationsEnabled',
    ],
  },
];

export function buildFirebaseRemoteConfigTemplate(): FirebaseRemoteConfigTemplate {
  const definitionsByKey = Object.fromEntries(
    REMOTE_CONFIG_DEFINITIONS.map((definition) => [definition.key, definition]),
  ) as Record<RemoteConfigValueKey, RemoteConfigDefinition>;

  const groupedKeys = new Set<RemoteConfigValueKey>();
  const parameterGroups: Record<string, FirebaseRemoteConfigParameterGroup> = {};

  for (const group of TEMPLATE_GROUPS) {
    const parameters: Record<string, FirebaseRemoteConfigParameter> = {};
    for (const key of group.keys) {
      if (groupedKeys.has(key)) {
        throw new Error(`Remote Config template key appears in multiple groups: ${key}`);
      }
      groupedKeys.add(key);
      const definition = definitionsByKey[key];
      parameters[definition.remoteKey] = buildParameter(definition, REMOTE_CONFIG_DEFAULTS[key]);
    }

    parameterGroups[group.name] = {
      description: group.description,
      parameters,
    };
  }

  const missingKeys = REMOTE_CONFIG_DEFINITIONS
    .map((definition) => definition.key)
    .filter((key) => !groupedKeys.has(key));

  if (missingKeys.length > 0) {
    throw new Error(`Remote Config template groups missing keys: ${missingKeys.join(', ')}`);
  }

  return {
    conditions: [],
    parameters: {},
    parameterGroups,
  };
}

export function stableRemoteConfigTemplateJson(template: FirebaseRemoteConfigTemplate): string {
  return `${JSON.stringify(template, null, 2)}\n`;
}

function buildParameter(
  definition: RemoteConfigDefinition,
  defaultValue: RemoteConfigPrimitive,
): FirebaseRemoteConfigParameter {
  return {
    defaultValue: { value: String(defaultValue) },
    description: definition.description,
    valueType: firebaseValueType(definition.type),
  };
}

function firebaseValueType(type: RemoteConfigValueType): FirebaseRemoteConfigValueType {
  if (type === 'boolean') return 'BOOLEAN';
  if (type === 'number') return 'NUMBER';
  return 'STRING';
}
