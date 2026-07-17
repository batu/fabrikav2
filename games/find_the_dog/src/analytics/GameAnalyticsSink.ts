import type { AnalyticsEvent, AnalyticsSink } from '@fabrikav2/sdk/analytics';
import {
  GAMEANALYTICS_RESOURCE_CURRENCIES,
  GAMEANALYTICS_RESOURCE_ITEM_TYPES,
  adEvent,
  designEvent,
  gameAnalyticsDesignEventId,
  levelProgressionEvent,
  resourceEvent,
  type GameAnalyticsAdEvent,
  type GameAnalyticsDesignEvent,
  type GameAnalyticsProgressionEvent,
  type GameAnalyticsResourceEvent,
} from './GameAnalyticsEvents';
import type { GameAnalyticsIosConfig } from './GameAnalyticsConfig';

type EnumMap = Record<string, number>;

export interface GameAnalyticsSdk {
  GameAnalytics: {
    setEnabledInfoLog(flag: boolean): void;
    setEnabledVerboseLog(flag: boolean): void;
    configureAvailableResourceCurrencies(values: string[]): void;
    configureAvailableResourceItemTypes(values: string[]): void;
    initialize(gameKey: string, secretKey: string): void;
    addProgressionEvent(status: number, p1: string, p2?: string, p3?: string, score?: number, fields?: Record<string, unknown>): void;
    addDesignEvent(eventId: string, value?: number, fields?: Record<string, unknown>): void;
    addResourceEvent(flow: number, currency: string, amount: number, category: string, itemId: string, fields?: Record<string, unknown>): void;
    addAdEvent(action: number, type: number, sdkName: string, placement: string, fields?: Record<string, unknown>): void;
  };
  EGAProgressionStatus: EnumMap;
  EGAResourceFlowType: EnumMap;
  EGAAdAction: EnumMap;
  EGAAdType: EnumMap;
}

export type GameAnalyticsSdkLoader = () => Promise<unknown>;

export interface GameAnalyticsAnalyticsSinkOptions {
  readonly loader?: GameAnalyticsSdkLoader;
  readonly logger?: Pick<Console, 'warn'>;
}

/** GameAnalytics is an additive AnalyticsSink. It never becomes a second event
 * authority: canonical facade envelopes are translated with FTD's existing
 * progression/design/resource/ad mappers. */
export function createGameAnalyticsSink(
  config: GameAnalyticsIosConfig,
  options: GameAnalyticsAnalyticsSinkOptions = {},
): AnalyticsSink {
  const loader = options.loader ?? (() => import('gameanalytics'));
  const logger = options.logger ?? console;
  let sdk: GameAnalyticsSdk | null = null;
  let disabled = false;
  let initPromise: Promise<void> | null = null;
  const queue: AnalyticsEvent[] = [];

  function init(): Promise<void> {
    if (sdk !== null || disabled) return Promise.resolve();
    if (initPromise !== null) return initPromise;
    initPromise = loader()
      .then((module): void => {
        const loaded = unwrapSdk(module);
        loaded.GameAnalytics.setEnabledInfoLog(config.verboseLogging);
        loaded.GameAnalytics.setEnabledVerboseLog(config.verboseLogging);
        loaded.GameAnalytics.configureAvailableResourceCurrencies([...GAMEANALYTICS_RESOURCE_CURRENCIES]);
        loaded.GameAnalytics.configureAvailableResourceItemTypes([...GAMEANALYTICS_RESOURCE_ITEM_TYPES]);
        loaded.GameAnalytics.initialize(config.gameKey, config.secretKey);
        sdk = loaded;
        for (const event of queue.splice(0)) dispatch(loaded, event);
      })
      .catch((error: unknown): void => {
        disabled = true;
        queue.length = 0;
        logger.warn('[analytics:gameanalytics] initialization failed', error);
      });
    return initPromise;
  }

  return {
    name: 'gameanalytics',
    emit(event): void {
      if (disabled) return;
      if (sdk !== null) {
        dispatch(sdk, event);
        return;
      }
      queue.push(event);
      void init();
    },
    async flush(): Promise<void> {
      await init();
    },
  };
}

function unwrapSdk(module: unknown): GameAnalyticsSdk {
  const record = isRecord(module) ? module : {};
  const candidate = isRecord(record.default) ? record.default : record;
  if (!isRecord(candidate.GameAnalytics)) {
    throw new Error('GameAnalytics JavaScript SDK did not expose GameAnalytics');
  }
  return candidate as unknown as GameAnalyticsSdk;
}

function dispatch(sdk: GameAnalyticsSdk, event: AnalyticsEvent): void {
  const params = event.params;
  const levelId = String(params.level_id ?? 'unknown');
  if (event.name === 'level_start') return trackProgression(sdk, levelProgressionEvent('start', levelId, undefined, params));
  if (event.name === 'level_complete') return trackProgression(sdk, levelProgressionEvent('complete', levelId, numberParam(params.duration_ms), params));
  if (event.name === 'level_fail' || event.name === 'level_failed') return trackProgression(sdk, levelProgressionEvent('fail', levelId, undefined, params));

  if (event.name === 'resource_change' || event.name === 'resource_changed') {
    const currency = params.currency === 'hints' ? 'hints' : 'coins';
    const flow = params.flow === 'sink' || params.flow_type === 'sink' ? 'sink' : 'source';
    const category = resourceCategory(params.item_type);
    return trackResource(sdk, resourceEvent(flow, currency, numberParam(params.amount) ?? 0, category, String(params.reason ?? params.item_id ?? 'unknown'), params));
  }

  const ad = mappedAdEvent(event);
  if (ad !== null) return trackAd(sdk, ad);

  trackDesign(sdk, designEvent(
    gameAnalyticsDesignEventId(event.name, params),
    params,
    numberParam(params.value ?? params.revenue_usd),
  ));
}

function mappedAdEvent(event: AnalyticsEvent): GameAnalyticsAdEvent | null {
  const params = event.params;
  const placement = String(params.placement ?? 'unknown');
  const type = mappedAdType(params.ad_format ?? params.ad_type);
  const sdkName = String(params.provider ?? '').includes('admob') ? 'admob' : 'applovin';
  if (event.name === 'ad_request') return adEvent('request', type, sdkName, placement, params);
  if (event.name === 'ad_impression' || event.name === 'ad_shown') return adEvent('show', type, sdkName, placement, params);
  if (event.name === 'ad_show_failed') return adEvent('failed_show', type, sdkName, placement, params);
  if (event.name === 'ad_reward' || event.name === 'rewarded_ad_granted') return adEvent('reward_received', 'rewarded_video', sdkName, placement, params);
  return null;
}

function trackProgression(sdk: GameAnalyticsSdk, event: GameAnalyticsProgressionEvent): void {
  const status = sdk.EGAProgressionStatus[
    event.status === 'start' ? 'Start' : event.status === 'complete' ? 'Complete' : 'Fail'
  ];
  sdk.GameAnalytics.addProgressionEvent(status, event.progression01, event.progression02, event.progression03, event.score, event.customFields);
}

function trackDesign(sdk: GameAnalyticsSdk, event: GameAnalyticsDesignEvent): void {
  sdk.GameAnalytics.addDesignEvent(event.eventId, event.value, event.customFields);
}

function trackResource(sdk: GameAnalyticsSdk, event: GameAnalyticsResourceEvent): void {
  if (event.amount <= 0) return;
  const flow = event.flowType === 'source' ? sdk.EGAResourceFlowType.Source : sdk.EGAResourceFlowType.Sink;
  sdk.GameAnalytics.addResourceEvent(flow, event.currency, event.amount, event.category, event.itemId, event.customFields);
}

function trackAd(sdk: GameAnalyticsSdk, event: GameAnalyticsAdEvent): void {
  const actionKeys = {
    show: 'Show',
    failed_show: 'FailedShow',
    reward_received: 'RewardReceived',
    request: 'Undefined',
    loaded: 'Undefined',
    clicked: 'Undefined',
  } as const;
  const typeKeys = {
    rewarded_video: 'RewardedVideo',
    banner: 'Banner',
    video: 'Video',
    playable: 'Playable',
    interstitial: 'Interstitial',
    offer_wall: 'OfferWall',
  } as const;
  const action = sdk.EGAAdAction[actionKeys[event.action]];
  const typeKey = typeKeys[event.adType];
  sdk.GameAnalytics.addAdEvent(action, sdk.EGAAdType[typeKey], event.sdkName, event.placement, event.customFields);
}

function mappedAdType(value: unknown): GameAnalyticsAdEvent['adType'] {
  if (value === 'rewarded') return 'rewarded_video';
  if (value === 'banner') return 'banner';
  return 'interstitial';
}

function resourceCategory(value: unknown): (typeof GAMEANALYTICS_RESOURCE_ITEM_TYPES)[number] {
  return GAMEANALYTICS_RESOURCE_ITEM_TYPES.includes(value as never)
    ? value as (typeof GAMEANALYTICS_RESOURCE_ITEM_TYPES)[number]
    : 'shop';
}

function numberParam(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
