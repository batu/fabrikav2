import { registerPlugin } from '@capacitor/core';

export type AdjustEnvironment = 'sandbox' | 'production';

export interface AdjustInitializeOptions {
  appToken: string;
  environment: AdjustEnvironment;
  verboseLogging: boolean;
  disableIdfaReading: boolean;
  disableAppTrackingTransparencyUsage: boolean;
  eventTokens: Record<string, string>;
}

export interface AdjustBooleanResult {
  initialized: boolean;
}

export interface AdjustTrackEventOptions {
  eventName: string;
  callbackParameters?: Record<string, string>;
}

export interface AdjustTrackEventResult {
  tracked: boolean;
}

export interface AdjustStatusResult {
  initialized: boolean;
  environment: string | null;
}

export interface AdjustAttributionPlugin {
  initialize: (options: AdjustInitializeOptions) => Promise<AdjustBooleanResult>;
  trackEvent: (options: AdjustTrackEventOptions) => Promise<AdjustTrackEventResult>;
  getStatus: () => Promise<AdjustStatusResult>;
}

export const AdjustAttribution = registerPlugin<AdjustAttributionPlugin>('AdjustAttribution');
