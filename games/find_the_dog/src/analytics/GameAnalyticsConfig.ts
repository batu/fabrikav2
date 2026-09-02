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
  /** Public GameAnalytics game keys explicitly bound to FTD. Empty in
   * production until the external FTD project has been provisioned. */
  readonly approvedGameKeys: readonly string[];
}

const PRODUCTION_GAMEANALYTICS_IDENTITY_POLICY: GameAnalyticsIdentityPolicy = {
  approvedGameKeys: [],
};

const REQUIRED_GAMEANALYTICS_KEYS = [
  'VITE_GAMEANALYTICS_IOS_GAME_KEY',
  'VITE_GAMEANALYTICS_IOS_SECRET_KEY',
] as const;
type RequiredGameAnalyticsKey = (typeof REQUIRED_GAMEANALYTICS_KEYS)[number];

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
  if (envString(env.VITE_GAMEANALYTICS_IOS_GAME_ID) !== 'find_the_dog') {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_ID must be find_the_dog',
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

  if (!isGameAnalyticsGameKey(requiredValue(values.VITE_GAMEANALYTICS_IOS_GAME_KEY))) {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_KEY must be 32 hexadecimal characters',
      missingKeys: [],
    };
  }

  if (!isGameAnalyticsSecretKey(requiredValue(values.VITE_GAMEANALYTICS_IOS_SECRET_KEY))) {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_SECRET_KEY must be 40 hexadecimal characters',
      missingKeys: [],
    };
  }

  const gameKey = requiredValue(values.VITE_GAMEANALYTICS_IOS_GAME_KEY);
  if (isProductionBuild && !identityPolicy.approvedGameKeys.includes(gameKey)) {
    return {
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_KEY is not approved for find_the_dog',
      missingKeys: [],
    };
  }

  return {
    enabled: true,
    config: {
      gameKey,
      secretKey: requiredValue(values.VITE_GAMEANALYTICS_IOS_SECRET_KEY),
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

function envString(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredValue(value: string | null): string {
  if (value === null) {
    throw new Error('GameAnalytics config value was read after missing-key validation.');
  }
  return value;
}

function parseBooleanEnv(value: string | boolean | undefined, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}
