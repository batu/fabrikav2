import type { AnalyticsEvent, AnalyticsSink } from '@fabrikav2/sdk/analytics';
import { Capacitor } from '@capacitor/core';
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
    setEnabledManualSessionHandling(flag: boolean): void;
    initialize(gameKey: string, secretKey: string): void;
    startSession(): void;
    endSession(): void;
    isSdkReady?(needsInitialized: boolean, warn?: boolean): boolean;
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
  readonly readyTimeoutMs?: number;
  readonly readyPollMs?: number;
  readonly retryDelayMs?: number;
  readonly maxQueueItems?: number;
  readonly maxInitAttempts?: number;
}

export interface GameAnalyticsSink extends AnalyticsSink {
  diagnostics(): {
    readonly queued: number;
    readonly sent: number;
    readonly retried: number;
    readonly dropped: number;
    readonly initializationFailure: string | null;
    readonly flushAttempts: number;
    readonly lastSuccessfulFlushAt: null;
  };
}

/** GameAnalytics is an additive AnalyticsSink. It never becomes a second event
 * authority: canonical facade envelopes are translated with FTD's existing
 * progression/design/resource/ad mappers. */
export function createGameAnalyticsSink(
  config: GameAnalyticsIosConfig,
  options: GameAnalyticsAnalyticsSinkOptions = {},
): GameAnalyticsSink {
  const loader = options.loader ?? (() => import('gameanalytics'));
  const logger = options.logger ?? console;
  const readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
  const readyPollMs = options.readyPollMs ?? 50;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const maxQueueItems = Math.max(1, Math.floor(options.maxQueueItems ?? 100));
  const maxInitAttempts = Math.max(1, Math.floor(options.maxInitAttempts ?? 3));
  let sdk: GameAnalyticsSdk | null = null;
  let loadingSdk: GameAnalyticsSdk | null = null;
  let disabled = false;
  let initPromise: Promise<void> | null = null;
  let initAttempts = 0;
  let nextRetryAt = 0;
  const queue: AnalyticsEvent[] = [];
  let sent = 0;
  let retried = 0;
  let dropped = 0;
  let flushAttempts = 0;
  let nativeSessionActive = false;
  let initializationFailure: string | null = null;
  let nativeIdentity: { native_app_version: string; native_build_number: string } | null = null;
  function send(loaded: GameAnalyticsSdk, event: AnalyticsEvent): void {
    // Keep legacy app_version/build as source provenance. Native identity comes
    // from the archived binary, including Xcode's late version/build overrides.
    // Insert first for the GA field cap, then overwrite any caller-supplied values.
    if (nativeIdentity !== null) event = { ...event, params: { ...nativeIdentity, ...event.params, ...nativeIdentity } };
    let tracked: boolean;
    if (event.name === 'session_start') {
      // initialize() creates the first GA session. Subsequent sessions are
      // started and readiness-checked before this event leaves our queue.
      tracked = trackDesign(loaded, designEvent(gameAnalyticsDesignEventId(event.name, event.params), event.params));
    } else if (event.name === 'session_end') {
      // Preserve the canonical close event before ending the native session.
      tracked = trackDesign(loaded, designEvent(gameAnalyticsDesignEventId(event.name, event.params), event.params));
      loaded.GameAnalytics.endSession();
      nativeSessionActive = false;
    } else {
      tracked = dispatch(loaded, event);
    }
    if (tracked) sent += 1;
    else dropped += 1;
  }

  async function init(forceRetry = false): Promise<void> {
    if (sdk !== null || disabled) return;
    if (initPromise !== null) return initPromise;
    if (Date.now() < nextRetryAt && !forceRetry) return;
    // Once polling is exhausted, later events/resumes only probe the retained
    // SDK. Its original request may still complete; do not reinitialize it.
    const probeOnly = loadingSdk !== null && initAttempts >= maxInitAttempts;
    if (initAttempts > 0) retried += 1;
    initAttempts += 1;
    initPromise = (async (): Promise<void> => {
      try {
        if (loadingSdk === null) {
          if (Capacitor.isNativePlatform() && nativeIdentity === null) {
            const info = await readNativeAppInfo(readyTimeoutMs);
            nativeIdentity = { native_app_version: info.version, native_build_number: info.build };
          }
          const loaded = unwrapSdk(await loader());
          validateSdk(loaded);
          loaded.GameAnalytics.setEnabledInfoLog(config.verboseLogging);
          loaded.GameAnalytics.setEnabledVerboseLog(config.verboseLogging);
          loaded.GameAnalytics.configureAvailableResourceCurrencies([...GAMEANALYTICS_RESOURCE_CURRENCIES]);
          loaded.GameAnalytics.configureAvailableResourceItemTypes([...GAMEANALYTICS_RESOURCE_ITEM_TYPES]);
          loaded.GameAnalytics.setEnabledManualSessionHandling(true);
          loaded.GameAnalytics.initialize(config.gameKey, config.secretKey);
          nativeSessionActive = true;
          loadingSdk = loaded;
        }
        const deadline = Date.now() + (probeOnly ? 0 : readyTimeoutMs);
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (queue.length === 0 && nativeSessionActive) {
          await waitForSdkReady(loadingSdk.GameAnalytics, remainingMs(), readyPollMs);
        }
        while (queue.length > 0) {
          const event = queue[0];
          if (event === undefined) break;
          if (event.name === 'session_start' && !nativeSessionActive) {
            // endSession/startSession run on GA's asynchronous thread. Wait
            // for the old session to close before requesting the new one, so
            // its still-ready state cannot falsely satisfy the next check.
            if (loadingSdk.GameAnalytics.isSdkReady?.(true, false) === true) {
              await waitForSdkReady(loadingSdk.GameAnalytics, remainingMs(), readyPollMs, false);
            }
            loadingSdk.GameAnalytics.startSession();
            nativeSessionActive = true;
          }
          if (nativeSessionActive && loadingSdk.GameAnalytics.isSdkReady?.(true, false) === false) {
            await waitForSdkReady(loadingSdk.GameAnalytics, remainingMs(), readyPollMs);
          }
          // Queue overflow may have evicted the event while readiness waited.
          if (queue[0] !== event) continue;
          queue.shift();
          try {
            send(loadingSdk, event);
          } catch (error) {
            dropped += 1 + queue.length;
            queue.length = 0;
            throw error;
          }
        }
        sdk = loadingSdk;
        loadingSdk = null;
        initializationFailure = null;
      } catch (error: unknown) {
        initializationFailure = errorKind(error);
        logger.warn(`[analytics:gameanalytics] initialization failed (${initializationFailure})`);
        const retryable = error instanceof SdkReadyTimeout
          || (loadingSdk === null && !(error instanceof SdkShapeError));
        if ((error instanceof SdkReadyTimeout && loadingSdk !== null)
          || (retryable && initAttempts < maxInitAttempts)) {
          nextRetryAt = Date.now() + retryDelayMs;
        } else {
          disabled = true;
          dropped += queue.length;
          queue.length = 0;
        }
      }
    })().finally(() => {
      // A ready retained-SDK probe can complete without awaiting. Clear after
      // assignment, so its resolved promise cannot lock the next transition.
      initPromise = null;
    });
    return initPromise;
  }

  return {
    name: 'gameanalytics',
    emit(event): void {
      if (disabled) {
        dropped += 1;
        return;
      }
      if (sdk !== null) {
        const needsSessionWait = (event.name === 'session_start' && !nativeSessionActive)
          || (nativeSessionActive && sdk.GameAnalytics.isSdkReady?.(true, false) === false);
        if (!needsSessionWait) {
          try {
            send(sdk, event);
          } catch (error) {
            dropped += 1;
            throw error;
          }
          return;
        }
        // Reuse the bounded queue/probes for every manual session transition,
        // without reloading or reinitializing the retained SDK.
        loadingSdk = sdk;
        sdk = null;
        initAttempts = 0;
        nextRetryAt = 0;
      }
      if (queue.length >= maxQueueItems) {
        queue.shift();
        dropped += 1;
      }
      queue.push(event);
      void init();
    },
    async flush(): Promise<void> {
      flushAttempts += 1;
      while (sdk === null && !disabled) {
        await init(true);
        // A suspend flush is bounded even if initialization is still pending.
        // Later events/resumes may probe readiness and drain the retained queue.
        if (initAttempts >= maxInitAttempts) break;
      }
    },
    diagnostics() {
      return {
        queued: queue.length,
        sent,
        retried,
        dropped,
        initializationFailure,
        flushAttempts,
        // The GA JavaScript SDK exposes no network-delivery acknowledgement.
        lastSuccessfulFlushAt: null,
      };
    },
  };
}

// Do not silently label native events with package.json identity when the
// bridge fails. The existing bounded initialization retry/queue policy applies.
async function readNativeAppInfo(timeoutMs: number): Promise<{ version: string; build: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      import('@capacitor/app').then(({ App }) => App.getInfo()),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new NativeAppInfoError('Native app info timed out')), timeoutMs);
      }),
    ]);
    if (![info.version, info.build].every((value) => typeof value === 'string' && /^\d+(?:\.\d+){0,2}$/.test(value) && value.length <= 96)) {
      throw new NativeAppInfoError('Native app version/build is invalid');
    }
    return info;
  } finally {
    clearTimeout(timer);
  }
}

class NativeAppInfoError extends Error {
  override name = 'NativeAppInfoError';
}

class SdkReadyTimeout extends Error {
  override name = 'SdkReadyTimeout';
}

class SdkShapeError extends Error {
  override name = 'SdkShapeError';
}

async function waitForSdkReady(
  api: GameAnalyticsSdk['GameAnalytics'],
  timeoutMs: number,
  pollMs: number,
  ready = true,
): Promise<void> {
  if (api.isSdkReady === undefined) return;
  const deadline = Date.now() + timeoutMs;
  while (api.isSdkReady(true, false) !== ready) {
    if (Date.now() >= deadline) throw new SdkReadyTimeout('GameAnalytics SDK readiness timed out');
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function errorKind(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name : 'UnknownError';
}

function unwrapSdk(module: unknown): GameAnalyticsSdk {
  const record = isRecord(module) ? module : {};
  const candidate = isRecord(record.default) ? record.default : record;
  if (!isRecord(candidate.GameAnalytics) && typeof candidate.GameAnalytics !== 'function') {
    throw new SdkShapeError('GameAnalytics JavaScript SDK did not expose GameAnalytics');
  }
  return candidate as unknown as GameAnalyticsSdk;
}

function validateSdk(sdk: GameAnalyticsSdk): void {
  const required = [
    'setEnabledInfoLog', 'setEnabledVerboseLog', 'configureAvailableResourceCurrencies',
    'configureAvailableResourceItemTypes', 'setEnabledManualSessionHandling', 'initialize',
    'startSession', 'endSession', 'addProgressionEvent', 'addDesignEvent',
    'addResourceEvent', 'addAdEvent',
  ] as const;
  if (required.some((method) => typeof sdk.GameAnalytics[method] !== 'function')) {
    throw new SdkShapeError('GameAnalytics JavaScript SDK API is incomplete');
  }
}

function dispatch(sdk: GameAnalyticsSdk, event: AnalyticsEvent): boolean {
  const params = event.params;
  const levelId = String(params.level_id ?? 'unknown');

  if (event.name === 'ad_request') {
    return trackDesign(sdk, designEvent(gameAnalyticsDesignEventId(event.name, params), params));
  }
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

  return trackDesign(sdk, designEvent(
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
  if (event.name === 'ad_impression' || event.name === 'ad_shown') return adEvent('show', type, sdkName, placement, params);
  if (event.name === 'ad_show_failed') return adEvent('failed_show', type, sdkName, placement, params);
  if (event.name === 'ad_reward' || event.name === 'rewarded_ad_granted') return adEvent('reward_received', 'rewarded_video', sdkName, placement, params);
  return null;
}

function trackProgression(sdk: GameAnalyticsSdk, event: GameAnalyticsProgressionEvent): true {
  const status = sdk.EGAProgressionStatus[
    event.status === 'start' ? 'Start' : event.status === 'complete' ? 'Complete' : 'Fail'
  ];
  sdk.GameAnalytics.addProgressionEvent(status, event.progression01, event.progression02, event.progression03, event.score, event.customFields);
  return true;
}

function trackDesign(sdk: GameAnalyticsSdk, event: GameAnalyticsDesignEvent): true {
  sdk.GameAnalytics.addDesignEvent(event.eventId, event.value, event.customFields);
  return true;
}

function trackResource(sdk: GameAnalyticsSdk, event: GameAnalyticsResourceEvent): boolean {
  if (event.amount <= 0) return false;
  const flow = event.flowType === 'source' ? sdk.EGAResourceFlowType.Source : sdk.EGAResourceFlowType.Sink;
  sdk.GameAnalytics.addResourceEvent(flow, event.currency, event.amount, event.category, event.itemId, event.customFields);
  return true;
}

function trackAd(sdk: GameAnalyticsSdk, event: GameAnalyticsAdEvent): true {
  const actionKeys = {
    show: 'Show',
    failed_show: 'FailedShow',
    reward_received: 'RewardReceived',
    request: 'Show',
    loaded: 'Show',
    clicked: 'Clicked',
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
  return true;
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
