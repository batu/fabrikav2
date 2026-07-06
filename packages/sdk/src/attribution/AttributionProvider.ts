export type AttributionPrimitive = string | number | boolean | null | undefined;
export type AttributionParams = Record<string, AttributionPrimitive>;
export type AttributionParamBag<P> = { [K in keyof P]: AttributionPrimitive };

export type AttributionEventName =
  | 'appOpen'
  | 'levelStart'
  | 'levelComplete'
  | 'levelFailed'
  | 'rewardedWatched';

export interface AttributionProvider {
  readonly providerName: string;
  init: () => Promise<void>;
  track: <P extends AttributionParamBag<P>>(eventName: AttributionEventName, params?: P) => Promise<void>;
}
