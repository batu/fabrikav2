import { envString, parseBooleanEnv, requiredValue } from '@fabrikav2/sdk/config-env';
import type { AdjustEnvironment } from './AdjustAttributionPlugin';
import type { AttributionEventName } from './AttributionProvider';

export type AdjustEventTokens = Record<AttributionEventName, string | null>;

export interface AdjustPrivacyConfig {
  disableIdfaReading: true;
  disableAppTrackingTransparencyUsage: true;
}

export interface AdjustIosConfig {
  appToken: string;
  environment: AdjustEnvironment;
  verboseLogging: boolean;
  eventTokens: AdjustEventTokens;
  privacy: AdjustPrivacyConfig;
}

export type AdjustConfigResult =
  | {
      enabled: true;
      config: AdjustIosConfig;
    }
  | {
      enabled: false;
      reason: string;
      missingKeys: string[];
    };

export type AdjustEnv = Record<string, string | boolean | undefined>;

const REQUIRED_ADJUST_KEYS = [
  'VITE_ADJUST_IOS_APP_TOKEN',
  'VITE_ADJUST_IOS_ENVIRONMENT',
] as const;
type RequiredAdjustKey = (typeof REQUIRED_ADJUST_KEYS)[number];

const EVENT_TOKEN_ENV_KEYS = {
  appOpen: 'VITE_ADJUST_EVENT_APP_OPEN_TOKEN',
  levelStart: 'VITE_ADJUST_EVENT_LEVEL_START_TOKEN',
  levelComplete: 'VITE_ADJUST_EVENT_LEVEL_COMPLETE_TOKEN',
  levelFailed: 'VITE_ADJUST_EVENT_LEVEL_FAIL_TOKEN',
  rewardedWatched: 'VITE_ADJUST_EVENT_REWARDED_WATCHED_TOKEN',
} as const satisfies Record<AttributionEventName, string>;

const PRODUCTION_GUARD_REASON =
  'VITE_ADJUST_IOS_ENVIRONMENT must be production for production builds';
const CONFIG_READ_AFTER_VALIDATION_ERROR =
  'Adjust config value was read after missing-key validation.';

export function readAdjustIosConfig(
  env: AdjustEnv = import.meta.env,
  isProductionBuild: boolean = import.meta.env.PROD,
): AdjustConfigResult {
  if (!parseBooleanEnv(env.VITE_ADJUST_IOS_ENABLED, false)) {
    return {
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENABLED is not true',
      missingKeys: [],
    };
  }

  const values = {
    VITE_ADJUST_IOS_APP_TOKEN: envString(env.VITE_ADJUST_IOS_APP_TOKEN),
    VITE_ADJUST_IOS_ENVIRONMENT: envString(env.VITE_ADJUST_IOS_ENVIRONMENT),
  } satisfies Record<RequiredAdjustKey, string | null>;
  const missingKeys = REQUIRED_ADJUST_KEYS.filter(
    (key: RequiredAdjustKey): boolean => values[key] === null,
  );

  if (missingKeys.length > 0) {
    return {
      enabled: false,
      reason: `missing Adjust iOS config: ${missingKeys.join(', ')}`,
      missingKeys,
    };
  }

  const environment = parseAdjustEnvironment(requiredValue(
    values.VITE_ADJUST_IOS_ENVIRONMENT,
    CONFIG_READ_AFTER_VALIDATION_ERROR,
  ));
  if (environment === null) {
    return {
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENVIRONMENT must be sandbox or production',
      missingKeys: [],
    };
  }

  if (!isAdjustAppToken(requiredValue(
    values.VITE_ADJUST_IOS_APP_TOKEN,
    CONFIG_READ_AFTER_VALIDATION_ERROR,
  ))) {
    return {
      enabled: false,
      reason: 'VITE_ADJUST_IOS_APP_TOKEN must be a 12-character Adjust app token',
      missingKeys: [],
    };
  }

  if (isProductionBuild && environment !== 'production') {
    return {
      enabled: false,
      reason: PRODUCTION_GUARD_REASON,
      missingKeys: [],
    };
  }

  return {
    enabled: true,
    config: {
      appToken: requiredValue(values.VITE_ADJUST_IOS_APP_TOKEN, CONFIG_READ_AFTER_VALIDATION_ERROR),
      environment,
      verboseLogging: !isProductionBuild && parseBooleanEnv(env.VITE_ADJUST_VERBOSE_LOGGING, false),
      eventTokens: readEventTokens(env),
      privacy: {
        disableIdfaReading: true,
        disableAppTrackingTransparencyUsage: true,
      },
    },
  };
}

function isAdjustAppToken(value: string): boolean {
  return value.length === 12;
}

export function redactAdjustToken(value: string): string {
  if (value.length <= 6) return '<redacted>';
  return `<redacted:${value.slice(-4)}>`;
}

function readEventTokens(env: AdjustEnv): AdjustEventTokens {
  return {
    appOpen: envString(env[EVENT_TOKEN_ENV_KEYS.appOpen]),
    levelStart: envString(env[EVENT_TOKEN_ENV_KEYS.levelStart]),
    levelComplete: envString(env[EVENT_TOKEN_ENV_KEYS.levelComplete]),
    levelFailed: envString(env[EVENT_TOKEN_ENV_KEYS.levelFailed]),
    rewardedWatched: envString(env[EVENT_TOKEN_ENV_KEYS.rewardedWatched]),
  };
}

function parseAdjustEnvironment(value: string): AdjustEnvironment | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'sandbox' || normalized === 'production') {
    return normalized;
  }
  return null;
}
