import { envString, parseBooleanEnv, requiredValue, sha256Hex } from '@fabrikav2/sdk/config-env';

export interface GameAnalyticsIosConfig {
  gameKey: string;
  secretKey: string;
  verboseLogging: boolean;
}

export type GameAnalyticsConfigResult =
  | {
      enabled: true;
      config: GameAnalyticsIosConfig;
    }
  | {
      enabled: false;
      reason: string;
      missingKeys: string[];
    };

export type GameAnalyticsEnv = Record<string, string | boolean | undefined>;

export interface GameAnalyticsIdentityPolicy {
  /** Raw values are a test-only seam; production bundles fingerprints only. */
  readonly approvedGameKeys: readonly string[];
  readonly approvedSecretKeys: readonly string[];
  readonly approvedGameKeyFingerprints?: readonly string[];
  readonly approvedSecretKeyFingerprints?: readonly string[];
}

const REQUIRED_GAMEANALYTICS_KEYS = [
  'VITE_GAMEANALYTICS_IOS_GAME_KEY',
  'VITE_GAMEANALYTICS_IOS_SECRET_KEY',
] as const;
type RequiredGameAnalyticsKey = (typeof REQUIRED_GAMEANALYTICS_KEYS)[number];
const CONFIG_READ_AFTER_VALIDATION_ERROR =
  'GameAnalytics config value was read after missing-key validation.';
const PRODUCTION_GAMEANALYTICS_IDENTITY_POLICY: GameAnalyticsIdentityPolicy = {
  approvedGameKeys: [],
  approvedSecretKeys: [],
  approvedGameKeyFingerprints: [
    'b7d40d4f0f62188d11ec138b31f971e26a7500428142939660af4cab20fe6425',
  ],
  approvedSecretKeyFingerprints: [
    'c356f65080a80ff69c17de5d3af900aa8ecb11268b066e72b12fa042d9066038',
  ],
};

export function readGameAnalyticsIosConfig(
  env: GameAnalyticsEnv,
  isProductionBuild: boolean = false,
  identityPolicy: GameAnalyticsIdentityPolicy = PRODUCTION_GAMEANALYTICS_IDENTITY_POLICY,
): GameAnalyticsConfigResult {
  if (!parseBooleanEnv(env.VITE_GAMEANALYTICS_IOS_ENABLED, false)) {
    return {
      enabled: false,
      reason: 'GameAnalytics iOS is disabled',
      missingKeys: [],
    };
  }
  if (envString(env.VITE_GAMEANALYTICS_IOS_GAME_ID) !== 'find_the_bird') {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_ID must be find_the_bird',
      missingKeys: [],
    };
  }
  const values = {
    VITE_GAMEANALYTICS_IOS_GAME_KEY: envString(env.VITE_GAMEANALYTICS_IOS_GAME_KEY),
    VITE_GAMEANALYTICS_IOS_SECRET_KEY: envString(env.VITE_GAMEANALYTICS_IOS_SECRET_KEY),
  } satisfies Record<RequiredGameAnalyticsKey, string | null>;
  const missingKeys = REQUIRED_GAMEANALYTICS_KEYS.filter(
    (key: RequiredGameAnalyticsKey): boolean => values[key] === null,
  );

  if (missingKeys.length > 0) {
    return {
      enabled: false,
      reason: `missing GameAnalytics iOS config: ${missingKeys.join(', ')}`,
      missingKeys,
    };
  }

  if (!isGameAnalyticsGameKey(requiredValue(
    values.VITE_GAMEANALYTICS_IOS_GAME_KEY,
    CONFIG_READ_AFTER_VALIDATION_ERROR,
  ))) {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_KEY must be 32 hexadecimal characters',
      missingKeys: [],
    };
  }

  if (!isGameAnalyticsSecretKey(requiredValue(
    values.VITE_GAMEANALYTICS_IOS_SECRET_KEY,
    CONFIG_READ_AFTER_VALIDATION_ERROR,
  ))) {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_SECRET_KEY must be 40 hexadecimal characters',
      missingKeys: [],
    };
  }

  const gameKey = requiredValue(values.VITE_GAMEANALYTICS_IOS_GAME_KEY, CONFIG_READ_AFTER_VALIDATION_ERROR);
  const gameKeyApproved = identityPolicy.approvedGameKeys.includes(gameKey)
    || (identityPolicy.approvedGameKeyFingerprints ?? []).includes(sha256Hex(gameKey));
  if (isProductionBuild && !gameKeyApproved) {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_KEY is not approved for find_the_bird',
      missingKeys: [],
    };
  }

  const secretKey = requiredValue(values.VITE_GAMEANALYTICS_IOS_SECRET_KEY, CONFIG_READ_AFTER_VALIDATION_ERROR);
  const secretKeyApproved = identityPolicy.approvedSecretKeys.includes(secretKey)
    || (identityPolicy.approvedSecretKeyFingerprints ?? []).includes(sha256Hex(secretKey));
  if (isProductionBuild && !secretKeyApproved) {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_SECRET_KEY is not approved for find_the_bird',
      missingKeys: [],
    };
  }

  return {
    enabled: true,
    config: {
      gameKey,
      secretKey,
      verboseLogging: !isProductionBuild && parseBooleanEnv(env.VITE_GAMEANALYTICS_VERBOSE_LOGGING, false),
    },
  };
}

export function readGameAnalyticsIosConfigFromImportMetaEnv(): GameAnalyticsConfigResult {
  const env = (import.meta as unknown as { env?: GameAnalyticsEnv }).env ?? {};
  return readGameAnalyticsIosConfig(env, env.PROD === true);
}

export function redactGameAnalyticsKey(value: string): string {
  if (value.length <= 6) return '<redacted>';
  return `<redacted:${value.slice(-4)}>`;
}

function isGameAnalyticsGameKey(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

function isGameAnalyticsSecretKey(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}
