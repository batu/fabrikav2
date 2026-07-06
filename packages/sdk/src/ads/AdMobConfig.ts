/**
 * AdMob configuration. Carried from v1 `packages/core/src/ads/AdConfig.ts`.
 * The hard-coded defaults are **Google's published test ad-unit IDs**
 * (the `ca-app-pub-3940256099942544/...` family, see
 * https://developers.google.com/admob/android/test-ads) — safe to ship as
 * defaults; NO real/production ad-unit IDs live here. The
 * game overrides them via `import.meta.env` for a production build.
 */

export type SupportedAdPlatform = 'android' | 'ios';

export interface AdConfig {
  enabled: boolean;
  isTesting: boolean;
  androidInterstitialAdUnitId: string;
  iosInterstitialAdUnitId: string;
  androidBannerAdUnitId: string;
  iosBannerAdUnitId: string;
  androidRewardedAdUnitId: string;
  iosRewardedAdUnitId: string;
  testingDevices: string[];
}

const DEFAULT_ANDROID_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3940256099942544/1033173712';
const DEFAULT_IOS_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3940256099942544/4411468910';
const DEFAULT_ANDROID_BANNER_AD_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';
const DEFAULT_IOS_BANNER_AD_UNIT_ID = 'ca-app-pub-3940256099942544/2934735716';
// Google's published test IDs for Rewarded Video ads.
// https://developers.google.com/admob/android/test-ads
const DEFAULT_ANDROID_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';
const DEFAULT_IOS_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/1712485313';

const parseAdMobBooleanEnv = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  return value === 'true';
};

const parseCsvEnv = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item: string): string => item.trim())
    .filter((item: string): boolean => item.length > 0);
};

const getEnvString = (value: string | undefined, fallback: string): string =>
  value && value.trim().length > 0 ? value.trim() : fallback;

/**
 * Vite injects these via `import.meta.env` at build time. This package doesn't
 * depend on vite/client types, so cast through `unknown` to get at the bag of
 * env strings without pulling Vite's types into the SDK's tsconfig.
 */
interface ViteEnv {
  VITE_ADMOB_ENABLED?: string;
  VITE_ADMOB_TEST_MODE?: string;
  VITE_ADMOB_ANDROID_INTERSTITIAL_ID?: string;
  VITE_ADMOB_IOS_INTERSTITIAL_ID?: string;
  VITE_ADMOB_ANDROID_BANNER_ID?: string;
  VITE_ADMOB_IOS_BANNER_ID?: string;
  VITE_ADMOB_ANDROID_REWARDED_ID?: string;
  VITE_ADMOB_IOS_REWARDED_ID?: string;
  VITE_ADMOB_TESTING_DEVICES?: string;
  DEV?: boolean;
}

export const createAdConfig = (env: ViteEnv = {}): AdConfig => ({
  enabled: parseAdMobBooleanEnv(env.VITE_ADMOB_ENABLED, true),
  isTesting: parseAdMobBooleanEnv(env.VITE_ADMOB_TEST_MODE, env.DEV ?? false),
  androidInterstitialAdUnitId: getEnvString(
    env.VITE_ADMOB_ANDROID_INTERSTITIAL_ID,
    DEFAULT_ANDROID_INTERSTITIAL_AD_UNIT_ID,
  ),
  iosInterstitialAdUnitId: getEnvString(
    env.VITE_ADMOB_IOS_INTERSTITIAL_ID,
    DEFAULT_IOS_INTERSTITIAL_AD_UNIT_ID,
  ),
  androidBannerAdUnitId: getEnvString(env.VITE_ADMOB_ANDROID_BANNER_ID, DEFAULT_ANDROID_BANNER_AD_UNIT_ID),
  iosBannerAdUnitId: getEnvString(env.VITE_ADMOB_IOS_BANNER_ID, DEFAULT_IOS_BANNER_AD_UNIT_ID),
  androidRewardedAdUnitId: getEnvString(env.VITE_ADMOB_ANDROID_REWARDED_ID, DEFAULT_ANDROID_REWARDED_AD_UNIT_ID),
  iosRewardedAdUnitId: getEnvString(env.VITE_ADMOB_IOS_REWARDED_ID, DEFAULT_IOS_REWARDED_AD_UNIT_ID),
  testingDevices: parseCsvEnv(env.VITE_ADMOB_TESTING_DEVICES),
});

/** Test-mode default config (Google test IDs, ads enabled). Games build their own from env. */
export const AD_CONFIG: AdConfig = createAdConfig();

export const getInterstitialUnitId = (platform: SupportedAdPlatform, config: AdConfig = AD_CONFIG): string =>
  platform === 'android' ? config.androidInterstitialAdUnitId : config.iosInterstitialAdUnitId;

export const getBannerUnitId = (platform: SupportedAdPlatform, config: AdConfig = AD_CONFIG): string =>
  platform === 'android' ? config.androidBannerAdUnitId : config.iosBannerAdUnitId;

export const getRewardedUnitId = (platform: SupportedAdPlatform, config: AdConfig = AD_CONFIG): string =>
  platform === 'android' ? config.androidRewardedAdUnitId : config.iosRewardedAdUnitId;
