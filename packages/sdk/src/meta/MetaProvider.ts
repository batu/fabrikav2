export type MetaEventPrimitive = string | number | boolean | null | undefined;
export type MetaEventParams = Record<string, MetaEventPrimitive>;

export type MetaProviderStatus =
  | { state: 'not-configured'; reason: string }
  | { state: 'idle' }
  | { state: 'initialized' }
  | { state: 'error'; reason: string };

/**
 * Facebook Core SDK surface: init + app events only. No Login, no sharing.
 * "Off" is a first-class state (DisabledMetaProvider), never an error.
 */
export interface MetaProvider {
  readonly providerName: string;
  init: () => Promise<void>;
  logEvent: (eventName: string, params?: MetaEventParams) => Promise<void>;
  /** Aligns FB advertiser tracking with the iOS ATT outcome. No-op off iOS. */
  setAdvertiserTrackingEnabled: (enabled: boolean) => Promise<void>;
  getStatus: () => MetaProviderStatus;
}
