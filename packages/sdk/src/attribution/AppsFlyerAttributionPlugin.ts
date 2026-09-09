import { registerPlugin } from '@capacitor/core';

export interface AppsFlyerInitializeOptions {
  devKey: string;
  /** Numeric App Store id; required on iOS, ignored on Android. */
  appleAppId: string | null;
  debugLogging: boolean;
  /** Partners the native SDK must not share with. Empty blocks nobody. Applied before start. */
  blockedPartners: readonly string[];
  /** Show the App Tracking Transparency prompt before the first SDK session (iOS). */
  requestTrackingAuthorization: boolean;
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
  /** authorized | denied | notDetermined | restricted | unavailable; absent on older bridges. */
  attStatus?: string;
}

export interface AppsFlyerAttributionPlugin {
  initialize: (options: AppsFlyerInitializeOptions) => Promise<AppsFlyerBooleanResult>;
  trackEvent: (options: AppsFlyerTrackEventOptions) => Promise<AppsFlyerTrackEventResult>;
  getStatus: () => Promise<AppsFlyerStatusResult>;
}

export const AppsFlyerAttribution = registerPlugin<AppsFlyerAttributionPlugin>('AppsFlyerAttribution');
