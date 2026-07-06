import type { AdjustEnvironment } from './AdjustAttributionPlugin.ts';
import type { AttributionEventName } from './AttributionProvider.ts';

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

interface AdjustImportMetaEnv extends AdjustEnv {
  PROD?: boolean;
}

const env = ((import.meta as unknown as { env?: AdjustImportMetaEnv }).env ?? {}) as AdjustImportMetaEnv;

const REQUIRED_ADJUST_KEYS = ['VITE_ADJUST_IOS_APP_TOKEN'] as const;
type RequiredAdjustKey = (typeof REQUIRED_ADJUST_KEYS)[number];

/**
 * v2 behavioral change (card d44nVkm2 AC): when VITE_ADJUST_IOS_ENVIRONMENT is
 * absent, default the Adjust backend to `sandbox` rather than treating it as a
 * missing required key. Neither v1 copy defaulted — both required an explicit
 * environment. The production guard and fail-closed build detection below are
 * unchanged, so a production build with the env unset still resolves to
 * `sandbox` and is then rejected by the guard (a prod app can never silently
 * run against the sandbox backend).
 */
const DEFAULT_ADJUST_ENVIRONMENT: AdjustEnvironment = 'sandbox';

const EVENT_TOKEN_ENV_KEYS = {
  appOpen: 'VITE_ADJUST_EVENT_APP_OPEN_TOKEN',
  levelStart: 'VITE_ADJUST_EVENT_LEVEL_START_TOKEN',
  levelComplete: 'VITE_ADJUST_EVENT_LEVEL_COMPLETE_TOKEN',
  levelFailed: 'VITE_ADJUST_EVENT_LEVEL_FAIL_TOKEN',
  rewardedWatched: 'VITE_ADJUST_EVENT_REWARDED_WATCHED_TOKEN',
} as const satisfies Record<AttributionEventName, string>;

const PRODUCTION_GUARD_REASON =
  'VITE_ADJUST_IOS_ENVIRONMENT must be production for production builds';

export function readAdjustIosConfig(
  adjustEnv: AdjustEnv = env,
  isProductionBuild: boolean = productionDefault(adjustEnv),
): AdjustConfigResult {
  if (!parseBooleanEnv(adjustEnv.VITE_ADJUST_IOS_ENABLED, false)) {
    return {
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENABLED is not true',
      missingKeys: [],
    };
  }

  const values = {
    VITE_ADJUST_IOS_APP_TOKEN: envString(adjustEnv.VITE_ADJUST_IOS_APP_TOKEN),
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

  const environment = resolveAdjustEnvironment(envString(adjustEnv.VITE_ADJUST_IOS_ENVIRONMENT));
  if (environment === null) {
    return {
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENVIRONMENT must be sandbox or production',
      missingKeys: [],
    };
  }

  if (!isAdjustAppToken(requiredValue(values.VITE_ADJUST_IOS_APP_TOKEN))) {
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
      appToken: requiredValue(values.VITE_ADJUST_IOS_APP_TOKEN),
      environment,
      verboseLogging: !isProductionBuild && parseBooleanEnv(adjustEnv.VITE_ADJUST_VERBOSE_LOGGING, false),
      eventTokens: readEventTokens(adjustEnv),
      privacy: {
        disableIdfaReading: true,
        disableAppTrackingTransparencyUsage: true,
      },
    },
  };
}

function productionDefault(adjustEnv: AdjustEnv): boolean {
  return typeof adjustEnv.PROD === 'boolean' ? adjustEnv.PROD : true;
}

function isAdjustAppToken(value: string): boolean {
  return value.length === 12;
}

export function redactAdjustToken(value: string): string {
  if (value.length <= 6) return '<redacted>';
  return `<redacted:${value.slice(-4)}>`;
}

function readEventTokens(adjustEnv: AdjustEnv): AdjustEventTokens {
  return {
    appOpen: envString(adjustEnv[EVENT_TOKEN_ENV_KEYS.appOpen]),
    levelStart: envString(adjustEnv[EVENT_TOKEN_ENV_KEYS.levelStart]),
    levelComplete: envString(adjustEnv[EVENT_TOKEN_ENV_KEYS.levelComplete]),
    levelFailed: envString(adjustEnv[EVENT_TOKEN_ENV_KEYS.levelFailed]),
    rewardedWatched: envString(adjustEnv[EVENT_TOKEN_ENV_KEYS.rewardedWatched]),
  };
}

/**
 * Resolve the Adjust backend environment. An unset value (null) defaults to
 * sandbox (see DEFAULT_ADJUST_ENVIRONMENT); a present-but-invalid value still
 * returns null so the caller rejects it as malformed.
 */
function resolveAdjustEnvironment(value: string | null): AdjustEnvironment | null {
  if (value === null) return DEFAULT_ADJUST_ENVIRONMENT;
  return parseAdjustEnvironment(value);
}

function parseAdjustEnvironment(value: string): AdjustEnvironment | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'sandbox' || normalized === 'production') {
    return normalized;
  }
  return null;
}

function envString(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredValue(value: string | null): string {
  if (value === null) {
    throw new Error('Adjust config value was read after missing-key validation.');
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
