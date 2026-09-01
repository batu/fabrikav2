import { envString, parseBooleanEnv, requiredValue } from '@fabrikav2/sdk/config-env';
import type { AdConfig } from '@fabrikav2/sdk/ads';

type Env = Record<string, string | boolean | undefined>;

const REQUIRED_KEYS = [
  'VITE_ADMOB_IOS_APP_ID',
  'VITE_ADMOB_IOS_BANNER_ID',
  'VITE_ADMOB_IOS_INTERSTITIAL_ID',
  'VITE_ADMOB_IOS_REWARDED_ID',
] as const;

const GOOGLE_SAMPLE_PUBLISHER = '3940256099942544';
const APP_ID = /^ca-app-pub-(\d{16})~(\d{10})$/;
const UNIT_ID = /^ca-app-pub-(\d{16})\/(\d{10})$/;

export interface AdMobIosPublicConfig {
  readonly enabled: boolean;
  readonly appId: string;
  readonly adUnits: {
    readonly banner: string;
    readonly interstitial: string;
    readonly rewarded: string;
  };
}

export type AdMobIosConfigResult =
  | { enabled: true; appId: string; config: AdConfig }
  | { enabled: false; reason: string; missingKeys: string[]; invalidKeys: string[] };

export function readAdMobIosConfig(env: Env, publicConfig?: AdMobIosPublicConfig): AdMobIosConfigResult {
  return readAdMobConfig('ios', env, publicConfig);
}

export function readAdMobConfig(platform: 'android' | 'ios', env: Env, publicConfig?: AdMobIosPublicConfig): AdMobIosConfigResult {
  const prefix = platform === 'android' ? 'VITE_ADMOB_ANDROID' : 'VITE_ADMOB_IOS';
  const keys = REQUIRED_KEYS.map((key) => key.replace('VITE_ADMOB_IOS', prefix));
  if (!parseBooleanEnv(env[`${prefix}_ENABLED`], publicConfig?.enabled ?? false)) {
    return { enabled: false, reason: `${prefix}_ENABLED is not true`, missingKeys: [], invalidKeys: [] };
  }

  const defaults: Record<(typeof REQUIRED_KEYS)[number], string | null> = {
    VITE_ADMOB_IOS_APP_ID: envString(publicConfig?.appId),
    VITE_ADMOB_IOS_BANNER_ID: envString(publicConfig?.adUnits.banner),
    VITE_ADMOB_IOS_INTERSTITIAL_ID: envString(publicConfig?.adUnits.interstitial),
    VITE_ADMOB_IOS_REWARDED_ID: envString(publicConfig?.adUnits.rewarded),
  };
  const values = Object.fromEntries(keys.map((key, index) => [key, envString(env[key]) ?? defaults[REQUIRED_KEYS[index]]])) as Record<string, string | null>;
  const missingKeys: string[] = keys.filter((key) => values[key] === null);
  const testMode = parseBooleanEnv(env[`${prefix}_TEST_MODE`], false);
  const testingDevices = csv(envString(env[`${prefix}_TEST_DEVICE_IDS`]));
  if (testMode && testingDevices.length === 0) missingKeys.push(`${prefix}_TEST_DEVICE_IDS`);
  if (missingKeys.length > 0) {
    return { enabled: false, reason: `missing AdMob iOS config: ${missingKeys.join(', ')}`, missingKeys, invalidKeys: [] };
  }

  const appId = requiredValue(values[keys[0]]);
  const units = {
    banner: requiredValue(values[keys[1]]),
    interstitial: requiredValue(values[keys[2]]),
    rewarded: requiredValue(values[keys[3]]),
  };
  const invalidKeys: string[] = [];
  if (!validIdentifier(appId, APP_ID)) invalidKeys.push(`${prefix}_APP_ID`);
  for (const [slot, value] of Object.entries(units)) {
    if (!validIdentifier(value, UNIT_ID)) invalidKeys.push(`${prefix}_${slot.toUpperCase()}_ID`);
  }
  if (invalidKeys.length > 0) {
    return { enabled: false, reason: `invalid AdMob iOS config: ${invalidKeys.join(', ')}`, missingKeys: [], invalidKeys };
  }

  return {
    enabled: true,
    appId,
    config: {
      enabled: true,
      isTesting: testMode,
      iosBannerAdUnitId: platform === 'ios' ? units.banner : '',
      iosInterstitialAdUnitId: platform === 'ios' ? units.interstitial : '',
      iosRewardedAdUnitId: platform === 'ios' ? units.rewarded : '',
      androidBannerAdUnitId: platform === 'android' ? units.banner : '',
      androidInterstitialAdUnitId: platform === 'android' ? units.interstitial : '',
      androidRewardedAdUnitId: platform === 'android' ? units.rewarded : '',
      testingDevices,
    },
  };
}

export function adMobIosConfigPresent(env: Env, publicConfig?: AdMobIosPublicConfig): boolean {
  return readAdMobIosConfig(env, publicConfig).enabled;
}

function csv(value: string | null): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

function validIdentifier(value: string, pattern: RegExp): boolean {
  const match = pattern.exec(value);
  return match !== null && match[1] !== GOOGLE_SAMPLE_PUBLISHER;
}
