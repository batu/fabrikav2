/// <reference types="vite/client" />
/// <reference path="../../../packages/sdk/src/ads/capacitor-admob-shims.d.ts" />
/// <reference path="../../../packages/sdk/src/haptics/capacitor-shims.d.ts" />

/** Build provenance stamped by configs/vite.base.ts (undefined under vitest). */
declare const __BUILD_INFO__:
  | { sha: string; dirty: boolean; version: string; builtAt: string }
  | undefined;

interface ImportMetaEnv {
  readonly VITE_ENABLE_TEST_HARNESS?: string;
  readonly VITE_FTD_FORCE_CANVAS?: string;
  readonly VITE_FTD_SIM_AUTOPLAY?: string;
  readonly VITE_FTD_DISABLE_REMOTE_CONFIG?: string;
  readonly VITE_FTD_STORE_LINK?: string;
  readonly VITE_INSITU_TOUR?: string;
  readonly VITE_CDN_ENABLED?: string;
  readonly VITE_CDN_ORIGIN_ANDROID?: string;
  readonly VITE_CDN_ORIGIN_PROD?: string;
  readonly VITE_CDN_ORIGIN_DEV?: string;
  readonly VITE_APPLOVIN_IOS_SDK_KEY?: string;
  readonly VITE_APPLOVIN_IOS_ENABLED?: string;
  readonly VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY?: string;
  readonly VITE_APPLOVIN_IOS_BANNER_AD_UNIT_ID?: string;
  readonly VITE_APPLOVIN_IOS_INTERSTITIAL_AD_UNIT_ID?: string;
  readonly VITE_APPLOVIN_IOS_REWARDED_AD_UNIT_ID?: string;
  readonly VITE_APPLOVIN_ANDROID_SDK_KEY?: string;
  readonly VITE_APPLOVIN_ANDROID_ENABLED?: string;
  readonly VITE_APPLOVIN_ANDROID_GENERAL_AUDIENCE_ONLY?: string;
  readonly VITE_APPLOVIN_ANDROID_BANNER_AD_UNIT_ID?: string;
  readonly VITE_APPLOVIN_ANDROID_INTERSTITIAL_AD_UNIT_ID?: string;
  readonly VITE_APPLOVIN_ANDROID_REWARDED_AD_UNIT_ID?: string;
  readonly VITE_ADJUST_IOS_APP_TOKEN?: string;
  readonly VITE_ADJUST_IOS_ENVIRONMENT?: string;
  readonly VITE_ADJUST_IOS_VERBOSE?: string;
  readonly VITE_ADJUST_IOS_EVENT_APP_OPEN?: string;
  readonly VITE_ADJUST_IOS_EVENT_LEVEL_START?: string;
  readonly VITE_ADJUST_IOS_EVENT_LEVEL_COMPLETE?: string;
  readonly VITE_ADJUST_IOS_EVENT_LEVEL_FAILED?: string;
  readonly VITE_ADJUST_IOS_EVENT_REWARDED_WATCHED?: string;
  readonly VITE_ADJUST_IOS_ENABLED?: string;
  readonly VITE_ADJUST_EVENT_APP_OPEN_TOKEN?: string;
  readonly VITE_ADJUST_EVENT_LEVEL_START_TOKEN?: string;
  readonly VITE_ADJUST_EVENT_LEVEL_COMPLETE_TOKEN?: string;
  readonly VITE_ADJUST_EVENT_LEVEL_FAIL_TOKEN?: string;
  readonly VITE_ADJUST_EVENT_REWARDED_WATCHED_TOKEN?: string;
  readonly VITE_REVENUECAT_IOS_API_KEY?: string;
  readonly VITE_GAMEANALYTICS_IOS_GAME_KEY?: string;
  readonly VITE_GAMEANALYTICS_IOS_SECRET_KEY?: string;
  readonly VITE_GAMEANALYTICS_VERBOSE_LOGGING?: string;
  readonly VITE_FTD_OWNED_ANALYTICS_MIRROR_URL?: string;
  readonly VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}
