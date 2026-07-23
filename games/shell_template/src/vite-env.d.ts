/// <reference types="vite/client" />
/// <reference path="../../../packages/sdk/src/ads/capacitor-admob-shims.d.ts" />
/// <reference path="../../../packages/sdk/src/haptics/capacitor-shims.d.ts" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_TEST_HARNESS?: string;
  readonly VITE_SDK_VERIFIER_AUTOMOUNT?: string;
  readonly VITE_FTD_FORCE_CANVAS?: string;
  readonly VITE_FTD_SIM_AUTOPLAY?: string;
  readonly VITE_FTD_DISABLE_REMOTE_CONFIG?: string;
  readonly VITE_FTD_STORE_LINK?: string;
  readonly VITE_INSITU_TOUR?: string;
  readonly VITE_CDN_ENABLED?: string;
  readonly VITE_CDN_ORIGIN_ANDROID?: string;
  readonly VITE_CDN_ORIGIN_PROD?: string;
  readonly VITE_CDN_ORIGIN_DEV?: string;
  readonly VITE_APPLOVIN_IOS_ENABLED?: string;
  readonly VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY?: string;
  readonly VITE_APPLOVIN_IOS_SDK_KEY?: string;
  readonly VITE_APPLOVIN_IOS_BANNER_ID?: string;
  readonly VITE_APPLOVIN_IOS_INTERSTITIAL_ID?: string;
  readonly VITE_APPLOVIN_IOS_REWARDED_ID?: string;
  readonly VITE_APPLOVIN_ANDROID_ENABLED?: string;
  readonly VITE_APPLOVIN_ANDROID_GENERAL_AUDIENCE_ONLY?: string;
  readonly VITE_APPLOVIN_ANDROID_SDK_KEY?: string;
  readonly VITE_APPLOVIN_ANDROID_BANNER_ID?: string;
  readonly VITE_APPLOVIN_ANDROID_INTERSTITIAL_ID?: string;
  readonly VITE_APPLOVIN_ANDROID_REWARDED_ID?: string;
  readonly VITE_APPLOVIN_ALLOW_PARTIAL_UNITS?: string;
  readonly VITE_APPLOVIN_VERBOSE_LOGGING?: string;
  readonly VITE_APPLOVIN_HAS_USER_CONSENT?: string;
  readonly VITE_APPLOVIN_DO_NOT_SELL?: string;
  readonly VITE_APPLOVIN_CONSENT_FLOW_ENABLED?: string;
  readonly VITE_APPLOVIN_GDPR_TERMS_ALERT_ENABLED?: string;
  readonly VITE_PRIVACY_POLICY_URL?: string;
  readonly VITE_TERMS_URL?: string;
  readonly VITE_ADJUST_IOS_ENABLED?: string;
  readonly VITE_ADJUST_IOS_APP_TOKEN?: string;
  readonly VITE_ADJUST_IOS_ENVIRONMENT?: string;
  readonly VITE_APPSFLYER_ENABLED?: string;
  readonly VITE_APPSFLYER_DEV_KEY?: string;
  readonly VITE_APPSFLYER_APPLE_APP_ID?: string;
  readonly VITE_APPSFLYER_DEBUG_LOGGING?: string;
  readonly VITE_FB_ENABLED?: string;
  readonly VITE_FB_APP_ID?: string;
  readonly VITE_FB_CLIENT_TOKEN?: string;
  readonly VITE_FB_AUTO_LOG_APP_EVENTS?: string;
  readonly VITE_FB_ADVERTISER_ID_COLLECTION?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}
