/// <reference types="vite/client" />

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
  readonly VITE_APPLOVIN_IOS_BANNER_AD_UNIT_ID?: string;
  readonly VITE_APPLOVIN_IOS_INTERSTITIAL_AD_UNIT_ID?: string;
  readonly VITE_APPLOVIN_IOS_REWARDED_AD_UNIT_ID?: string;
  readonly VITE_APPLOVIN_ANDROID_SDK_KEY?: string;
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
}
