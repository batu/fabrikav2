import { KEYMASTER_APPLOVIN_AD_UNIT_IDS } from '../config/KeymasterConfig';
import { DEFAULT_LEGAL_LINKS } from '../platform/LegalLinks';

export interface AppLovinAdUnitIds {
  banner: string;
  interstitial: string;
  rewarded: string;
}

export type AppLovinPlatform = 'ios' | 'android';

export interface AppLovinConfig {
  platform: AppLovinPlatform;
  sdkKey: string;
  adUnitIds: AppLovinAdUnitIds;
  verboseLogging: boolean;
  privacy: AppLovinPrivacyConfig;
  consentFlow: AppLovinConsentFlowConfig;
}

export type AppLovinIosConfig = AppLovinConfig;

export interface AppLovinPrivacyConfig {
  generalAudienceOnly: true;
  hasUserConsent: boolean;
  doNotSell: boolean;
}

export interface AppLovinConsentFlowConfig {
  enabled: boolean;
  privacyPolicyUrl: string;
  termsOfServiceUrl: string;
  showTermsAndPrivacyPolicyAlertInGdpr: boolean;
}

export type AppLovinConfigResult =
  | {
      enabled: true;
      requested: true;
      platform: AppLovinPlatform;
      config: AppLovinConfig;
    }
  | {
      enabled: false;
      requested: boolean;
      platform: AppLovinPlatform;
      reason: string;
      missingKeys: string[];
    };

export type AppLovinEnv = Record<string, string | boolean | undefined>;

type AppLovinEnvKey = 'VITE_APPLOVIN_IOS_SDK_KEY' | 'VITE_APPLOVIN_ANDROID_SDK_KEY';

interface PlatformEnvKeys {
  enabled: string;
  generalAudienceOnly: string;
  sdkKey: AppLovinEnvKey;
}

const PLATFORM_ENV_KEYS: Record<AppLovinPlatform, PlatformEnvKeys> = {
  ios: {
    enabled: 'VITE_APPLOVIN_IOS_ENABLED',
    generalAudienceOnly: 'VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY',
    sdkKey: 'VITE_APPLOVIN_IOS_SDK_KEY',
  },
  android: {
    enabled: 'VITE_APPLOVIN_ANDROID_ENABLED',
    generalAudienceOnly: 'VITE_APPLOVIN_ANDROID_GENERAL_AUDIENCE_ONLY',
    sdkKey: 'VITE_APPLOVIN_ANDROID_SDK_KEY',
  },
};

export function readAppLovinIosConfig(env: AppLovinEnv = import.meta.env): AppLovinConfigResult {
  return readAppLovinConfigForPlatform('ios', env);
}

export function readAppLovinAndroidConfig(env: AppLovinEnv = import.meta.env): AppLovinConfigResult {
  return readAppLovinConfigForPlatform('android', env);
}

export function readAppLovinConfigForPlatform(
  platform: AppLovinPlatform,
  env: AppLovinEnv = import.meta.env,
): AppLovinConfigResult {
  const keys = PLATFORM_ENV_KEYS[platform];
  const isProductionBuild = parseBooleanEnv(env.PROD, false);
  const enabled = parseBooleanEnv(env[keys.enabled], false);
  if (!enabled) {
    return {
      enabled: false,
      requested: false,
      platform,
      reason: `${keys.enabled} is not true`,
      missingKeys: [],
    };
  }

  if (!parseBooleanEnv(env[keys.generalAudienceOnly], false)) {
    return {
      enabled: false,
      requested: true,
      platform,
      reason: `${keys.generalAudienceOnly} is not true`,
      missingKeys: [],
    };
  }

  const sdkKey = envString(env[keys.sdkKey]);
  const adUnitIds: AppLovinAdUnitIds = { ...KEYMASTER_APPLOVIN_AD_UNIT_IDS[platform] };
  const missingKeys = sdkKey === null ? [keys.sdkKey] : [];

  if (missingKeys.length > 0) {
    return {
      enabled: false,
      requested: true,
      platform,
      reason: `missing AppLovin ${platformDisplayName(platform)} config: ${missingKeys.join(', ')}`,
      missingKeys,
    };
  }

  return {
    enabled: true,
    requested: true,
    platform,
    config: {
      platform,
      sdkKey: requiredValue(sdkKey),
      adUnitIds,
      verboseLogging: !isProductionBuild && parseBooleanEnv(env.VITE_APPLOVIN_VERBOSE_LOGGING, false),
      privacy: {
        generalAudienceOnly: true,
        hasUserConsent: parseBooleanEnv(env.VITE_APPLOVIN_HAS_USER_CONSENT, false),
        doNotSell: parseBooleanEnv(env.VITE_APPLOVIN_DO_NOT_SELL, true),
      },
      consentFlow: {
        enabled: parseBooleanEnv(env.VITE_APPLOVIN_CONSENT_FLOW_ENABLED, true),
        privacyPolicyUrl: envString(env.VITE_MARBLE_RUN_PRIVACY_POLICY_URL) ?? DEFAULT_LEGAL_LINKS.privacyPolicyUrl,
        termsOfServiceUrl: envString(env.VITE_MARBLE_RUN_TERMS_URL) ?? DEFAULT_LEGAL_LINKS.termsUrl,
        showTermsAndPrivacyPolicyAlertInGdpr: parseBooleanEnv(env.VITE_APPLOVIN_GDPR_TERMS_ALERT_ENABLED, true),
      },
    },
  };
}

function envString(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredValue(value: string | null): string {
  if (value === null) {
    throw new Error('AppLovin config value was read after missing-key validation.');
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

function platformDisplayName(platform: AppLovinPlatform): string {
  return platform === 'ios' ? 'iOS' : 'Android';
}
