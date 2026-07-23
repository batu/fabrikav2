import { registerPlugin } from '@capacitor/core';

export interface MetaInitializeOptions {
  appId: string;
  clientToken: string;
  autoLogAppEvents: boolean;
  advertiserIdCollection: boolean;
}

export interface MetaBooleanResult {
  initialized: boolean;
}

export interface MetaLogEventOptions {
  eventName: string;
  parameters?: Record<string, string>;
}

export interface MetaLogEventResult {
  logged: boolean;
}

export interface MetaSetAdvertiserTrackingOptions {
  enabled: boolean;
}

export interface MetaStatusResult {
  initialized: boolean;
  appId: string | null;
}

export interface CapacitorMetaPlugin {
  initialize: (options: MetaInitializeOptions) => Promise<MetaBooleanResult>;
  logEvent: (options: MetaLogEventOptions) => Promise<MetaLogEventResult>;
  setAdvertiserTrackingEnabled: (options: MetaSetAdvertiserTrackingOptions) => Promise<MetaBooleanResult>;
  getStatus: () => Promise<MetaStatusResult>;
}

export const MetaEvents = registerPlugin<CapacitorMetaPlugin>('MetaEvents');
