import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { AppLovinAdUnitIds, AppLovinConsentFlowConfig, AppLovinPrivacyConfig } from './AppLovinConfig';

export interface AppLovinInitializeOptions {
  sdkKey: string;
  verboseLogging: boolean;
  adUnitIds: AppLovinAdUnitIds;
  privacy: AppLovinPrivacyConfig;
  consentFlow?: AppLovinConsentFlowConfig;
}

export interface AppLovinAdUnitOptions {
  adUnitId: string;
}

export interface AppLovinFullscreenAdOptions extends AppLovinAdUnitOptions {
  placement?: string;
}

export interface AppLovinBooleanResult {
  initialized: boolean;
}

export interface AppLovinLoadResult {
  loaded: boolean;
}

export interface AppLovinShowResult {
  shown: boolean;
}

export interface AppLovinRewardedResult {
  granted: boolean;
}

export interface AppLovinPrivacyOptionsResult {
  shown: boolean;
}

export interface AppLovinAdRevenuePaidEvent {
  ad_type?: string;
  placement?: string;
  revenue_usd?: number;
  currency?: string;
  precision?: string;
  network_name?: string;
  ad_unit_id?: string;
  ad_impression_id?: string;
}

export interface AppLovinMaxPlugin {
  initialize: (options: AppLovinInitializeOptions) => Promise<AppLovinBooleanResult>;
  /**
   * PERSISTENT-BANNER CONTRACT (2026-07 purchase/ads audit): the native
   * implementation must create ONE MAAdView on first call and reuse it for
   * every later show — never a fresh MAAdView+loadAd per call. The v1 iOS
   * plugin created a new ad view per show, so every no-fill at level start
   * surfaced as a failed show (1,028 of 2,912 ad events in the 2026-06 UA
   * test, ~38%). Reloading between shows is the MAX SDK auto-refresh's job.
   * `shown: false` therefore means "banner is not currently displayable",
   * not "this attempt's fresh load failed".
   */
  showBanner: (options: AppLovinAdUnitOptions) => Promise<AppLovinShowResult>;
  /** Hides the persistent banner. Must NOT destroy the underlying MAAdView. */
  hideBanner: () => Promise<void>;
  preloadInterstitial: (options: AppLovinAdUnitOptions) => Promise<AppLovinLoadResult>;
  showInterstitial: (options: AppLovinFullscreenAdOptions) => Promise<AppLovinShowResult>;
  preloadRewarded: (options: AppLovinAdUnitOptions) => Promise<AppLovinLoadResult>;
  showRewarded: (options: AppLovinFullscreenAdOptions) => Promise<AppLovinRewardedResult>;
  showPrivacyOptions?: () => Promise<AppLovinPrivacyOptionsResult>;
  addListener?: (
    eventName: 'adRevenuePaid',
    listenerFunc: (event: AppLovinAdRevenuePaidEvent) => void,
  ) => Promise<PluginListenerHandle>;
}

export const AppLovinMax = registerPlugin<AppLovinMaxPlugin>('AppLovinMax');
