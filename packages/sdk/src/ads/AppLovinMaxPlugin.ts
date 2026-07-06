import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { AppLovinAdUnitIds, AppLovinConsentFlowConfig, AppLovinPrivacyConfig } from './AppLovinConfig.ts';

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
  showBanner: (options: AppLovinAdUnitOptions) => Promise<AppLovinShowResult>;
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
