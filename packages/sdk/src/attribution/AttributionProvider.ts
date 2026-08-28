export type AttributionPrimitive = string | number | boolean | null | undefined;
export type AttributionParams = Record<string, AttributionPrimitive>;
export type AttributionParamBag<P> = { [K in keyof P]: AttributionPrimitive };

export type AttributionEventName =
  | 'appOpen'
  | 'levelStart'
  | 'levelComplete'
  | 'levelFailed'
  | 'rewardedWatched';

export type AppsFlyerValueEventName =
  | 'af_tutorial_completion'
  | 'af_level_achieved'
  | 'af_purchase'
  | 'af_ad_revenue'
  | 'retention_milestone';

export interface AttributionProvider {
  readonly providerName: string;
  init: () => Promise<void>;
  track: <P extends AttributionParamBag<P>>(eventName: AttributionEventName, params?: P) => Promise<void>;
}
