import { envString, parseBooleanEnv, requiredValue } from '../config-env.ts';

export interface MetaConfig {
  appId: string;
  clientToken: string;
  /** Privacy posture: both default off; enabling is an explicit config act. */
  autoLogAppEvents: boolean;
  advertiserIdCollection: boolean;
}

export type MetaConfigResult =
  | {
      enabled: true;
      config: MetaConfig;
    }
  | {
      enabled: false;
      reason: string;
      missingKeys: string[];
    };

export type MetaEnv = Record<string, string | boolean | undefined>;

const env = ((import.meta as unknown as { env?: MetaEnv }).env ?? {}) as MetaEnv;

const REQUIRED_META_KEYS = ['VITE_FB_APP_ID', 'VITE_FB_CLIENT_TOKEN'] as const;
type RequiredMetaKey = (typeof REQUIRED_META_KEYS)[number];

export function readMetaConfig(platform: string, metaEnv: MetaEnv = env): MetaConfigResult {
  if (!parseBooleanEnv(metaEnv.VITE_FB_ENABLED, false)) {
    return {
      enabled: false,
      reason: 'VITE_FB_ENABLED is not true',
      missingKeys: [],
    };
  }

  if (platform !== 'ios' && platform !== 'android') {
    return {
      enabled: false,
      reason: `Facebook SDK disabled on ${platform || 'web'} platform`,
      missingKeys: [],
    };
  }

  const values = {
    VITE_FB_APP_ID: envString(metaEnv.VITE_FB_APP_ID),
    VITE_FB_CLIENT_TOKEN: envString(metaEnv.VITE_FB_CLIENT_TOKEN),
  } satisfies Record<RequiredMetaKey, string | null>;
  const missingKeys = REQUIRED_META_KEYS.filter(
    (key: RequiredMetaKey): boolean => values[key] === null,
  );

  if (missingKeys.length > 0) {
    return {
      enabled: false,
      reason: `missing Facebook config: ${missingKeys.join(', ')}`,
      missingKeys,
    };
  }

  if (!isNumericAppId(requiredValue(values.VITE_FB_APP_ID))) {
    return {
      enabled: false,
      reason: 'VITE_FB_APP_ID must be the numeric Facebook app id',
      missingKeys: [],
    };
  }

  return {
    enabled: true,
    config: {
      appId: requiredValue(values.VITE_FB_APP_ID),
      clientToken: requiredValue(values.VITE_FB_CLIENT_TOKEN),
      autoLogAppEvents: parseBooleanEnv(metaEnv.VITE_FB_AUTO_LOG_APP_EVENTS, false),
      advertiserIdCollection: parseBooleanEnv(metaEnv.VITE_FB_ADVERTISER_ID_COLLECTION, false),
    },
  };
}

export function redactMetaToken(value: string): string {
  if (value.length <= 6) return '<redacted>';
  return `<redacted:${value.slice(-4)}>`;
}

function isNumericAppId(value: string): boolean {
  return /^\d+$/.test(value);
}
