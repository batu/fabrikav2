import { registerPlugin } from '@capacitor/core';

export interface AppsFlyerInitializeOptions {
  devKey: string;
  /** Numeric App Store id; required on iOS, ignored on Android. */
  appleAppId: string | null;
  debugLogging: boolean;
  /** Partners the native SDK must not share with. Empty blocks nobody. Applied before start. */
  blockedPartners: readonly string[];
}

export interface AppsFlyerBooleanResult {
  initialized: boolean;
}

export interface AppsFlyerTrackEventOptions {
  eventName: string;
  eventValues?: Record<string, string>;
}

export interface AppsFlyerTrackEventResult {
  tracked: boolean;
}

export interface AppsFlyerStatusResult {
  initialized: boolean;
  appsFlyerId: string | null;
}

export interface AppsFlyerAttributionPlugin {
  initialize: (options: AppsFlyerInitializeOptions) => Promise<AppsFlyerBooleanResult>;
  trackEvent: (options: AppsFlyerTrackEventOptions) => Promise<AppsFlyerTrackEventResult>;
  getStatus: () => Promise<AppsFlyerStatusResult>;
}

export const AppsFlyerAttribution = registerPlugin<AppsFlyerAttributionPlugin>('AppsFlyerAttribution');
