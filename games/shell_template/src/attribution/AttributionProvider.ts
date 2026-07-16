export type AttributionPrimitive = string | number | boolean | null | undefined;
export type AttributionParams = Record<string, AttributionPrimitive>;

export type AttributionEventName =
  | 'appOpen'
  | 'levelStart'
  | 'levelComplete'
  | 'levelFailed'
  | 'rewardedWatched';

export interface AttributionProvider {
  readonly providerName: string;
  init: () => Promise<void>;
  track: (eventName: AttributionEventName, params?: AttributionParams) => Promise<void>;
}
