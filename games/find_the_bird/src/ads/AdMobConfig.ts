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
  if (!parseBooleanEnv(env.VITE_ADMOB_IOS_ENABLED, publicConfig?.enabled ?? false)) {
    return { enabled: false, reason: 'VITE_ADMOB_IOS_ENABLED is not true', missingKeys: [], invalidKeys: [] };
  }

  const defaults: Record<(typeof REQUIRED_KEYS)[number], string | null> = {
    VITE_ADMOB_IOS_APP_ID: envString(publicConfig?.appId),
    VITE_ADMOB_IOS_BANNER_ID: envString(publicConfig?.adUnits.banner),
    VITE_ADMOB_IOS_INTERSTITIAL_ID: envString(publicConfig?.adUnits.interstitial),
    VITE_ADMOB_IOS_REWARDED_ID: envString(publicConfig?.adUnits.rewarded),
  };
  const values = Object.fromEntries(REQUIRED_KEYS.map((key) => [key, envString(env[key]) ?? defaults[key]])) as
    Record<(typeof REQUIRED_KEYS)[number], string | null>;
  const missingKeys: string[] = REQUIRED_KEYS.filter((key) => values[key] === null);
  const testMode = parseBooleanEnv(env.VITE_ADMOB_IOS_TEST_MODE, false);
  const testingDevices = csv(envString(env.VITE_ADMOB_IOS_TEST_DEVICE_IDS));
  if (testMode && testingDevices.length === 0) missingKeys.push('VITE_ADMOB_IOS_TEST_DEVICE_IDS');
  if (missingKeys.length > 0) {
    return { enabled: false, reason: `missing AdMob iOS config: ${missingKeys.join(', ')}`, missingKeys, invalidKeys: [] };
  }

  const appId = requiredValue(values.VITE_ADMOB_IOS_APP_ID);
  const units = {
    banner: requiredValue(values.VITE_ADMOB_IOS_BANNER_ID),
    interstitial: requiredValue(values.VITE_ADMOB_IOS_INTERSTITIAL_ID),
    rewarded: requiredValue(values.VITE_ADMOB_IOS_REWARDED_ID),
  };
  const invalidKeys: string[] = [];
  if (!validIdentifier(appId, APP_ID)) invalidKeys.push('VITE_ADMOB_IOS_APP_ID');
  for (const [slot, value] of Object.entries(units)) {
    if (!validIdentifier(value, UNIT_ID)) invalidKeys.push(`VITE_ADMOB_IOS_${slot.toUpperCase()}_ID`);
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
      iosBannerAdUnitId: units.banner,
      iosInterstitialAdUnitId: units.interstitial,
      iosRewardedAdUnitId: units.rewarded,
      androidBannerAdUnitId: '',
      androidInterstitialAdUnitId: '',
      androidRewardedAdUnitId: '',
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
