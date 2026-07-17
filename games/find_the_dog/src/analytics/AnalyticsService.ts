import {
  createAnalytics,
  createConsoleSink,
  type Analytics,
  type AnalyticsParamValue,
} from '@fabrikav2/sdk/analytics';
import { attribution } from '../attribution/AttributionService';
import { registerLifecycleHooks } from '../platform/gameLifecycle';
import { adService } from '../ads/Service';
import type { PurchaseUnfulfilledOutcome } from '../shop/PurchaseFulfillment';
import type { AnalyticsLevelAttribution } from './AnalyticsEventContract';

export type FtdEvent =
  | 'app_open'
  | 'app_background'
  | 'app_foreground'
  | 'dog_found'
  | 'hint_used'
  | 'settings_changed'
  | 'ad_shown'
  | 'ad_show_failed'
  | 'ad_revenue_paid'
  | 'resource_changed'
  | 'product_tapped'
  | 'purchase_initiated'
  | 'purchase_sheet_shown'
  | 'purchase_cancelled'
  | 'purchase_failed'
  | 'purchase_fulfilled'
  | 'purchase_unfulfilled'
  | 'iap_state_changed'
  | 'rewarded_ad_granted';

type LevelAttributionParams = Partial<AnalyticsLevelAttribution>;

interface LevelStartParams extends LevelAttributionParams {
  level_id: string;
  level_name: string;
}

interface LevelCompleteParams extends LevelAttributionParams {
  level_id: string;
  time_seconds: number;
  hints_used: number;
  wrong_taps: number;
}

interface LevelFailedParams extends LevelAttributionParams {
  level_id: string;
  dogs_found: number;
}

interface DogFoundParams extends LevelAttributionParams {
  level_id: string;
  dog_index: number;
  time_since_start: number;
}

interface HintUsedParams extends LevelAttributionParams {
  level_id: string;
  dogs_found: number;
}

interface SettingsChangedParams {
  setting_name: string;
  new_value: string;
}

interface AdShownParams {
  ad_type: 'banner' | 'interstitial';
  placement: string;
}

interface AdShowFailedParams {
  ad_type: 'banner' | 'interstitial' | 'rewarded';
  placement: string;
  reason: string;
}

interface AdRevenuePaidParams {
  ad_type: 'banner' | 'interstitial' | 'rewarded';
  placement: string;
  revenue_usd: number;
  currency?: string;
  precision?: string;
  network_name?: string;
  ad_unit_id?: string;
  ad_impression_id?: string;
}

interface ResourceChangedParams {
  flow_type: 'source' | 'sink';
  currency: string;
  amount: number;
  item_type: string;
  item_id: string;
  level_id?: string;
  transaction_id?: string;
  event_occurrence_id?: string;
}

/** Which UI surface hosted the purchase attempt. */
export type PurchaseSurface = 'shop' | 'fail_continue';

interface ProductTappedParams {
  product_id: string;
}

interface PurchaseInitiatedParams {
  product_id: string;
  surface: PurchaseSurface;
}

interface PurchaseSheetShownParams {
  product_id: string;
}

interface PurchaseCancelledParams {
  product_id: string;
  surface: PurchaseSurface;
}

interface PurchaseFailedParams {
  product_id: string;
  surface: PurchaseSurface;
  /** The IapPurchaseResult status that ended the attempt: 'failed' | 'unavailable'. */
  reason: string;
  /** Only for status 'failed': our timeout vs a store rejection. */
  failure_kind?: string;
  error_message?: string | null;
}

interface IapStateChangedParams {
  state: string;
  reason?: string | null;
}

interface PurchaseFulfilledParams {
  product_id: string;
  purchase_id: string;
  no_ads: boolean;
  hints: number;
  coins: number;
  continue_level: boolean;
}

interface PurchaseUnfulfilledParams {
  product_id: string;
  purchase_id: string;
  outcome: PurchaseUnfulfilledOutcome;
}

interface RewardedAdGrantedParams {
  placement: string;
}

export interface OwnedAnalyticsMirrorStats {
  queued: number;
  dropped: number;
  sent: number;
  failed: number;
  disabledReason: string | null;
}

export function createFtdSessionId(): string {
  return crypto.randomUUID?.() ?? `ftd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function compactParams(input: object): Record<string, AnalyticsParamValue> {
  const out: Record<string, AnalyticsParamValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function levelIndex(params: LevelAttributionParams): number | undefined {
  return params.sequence_slot === undefined ? undefined : params.sequence_slot - 1;
}

/** Build provenance for every event — the v2 analog of GA's configureBuild().
 * `<version>+<sha>` (with a `-dirty` marker) makes any bundle traceable to its
 * commit; the shipped 1.0.2 drifted-worktree bundle was not. */
export function buildStamp(): string | null {
  if (typeof __BUILD_INFO__ === 'undefined' || __BUILD_INFO__ === undefined) return null;
  return `${__BUILD_INFO__.version}+${__BUILD_INFO__.sha}${__BUILD_INFO__.dirty ? '-dirty' : ''}`;
}

export interface AnalyticsServiceComposition {
  readonly sdk: Analytics<FtdEvent>;
  readonly attribution?: typeof attribution;
  readonly providerName?: () => string;
  readonly ownedMirrorStats?: () => OwnedAnalyticsMirrorStats;
}

export class AnalyticsService {
  private sdk: Analytics<FtdEvent>;
  private attributionPort: typeof attribution = attribution;
  private providerNamePort: () => string = () => adService.providerName;
  private ownedMirrorStatsPort: () => OwnedAnalyticsMirrorStats = () => ({
    queued: 0,
    dropped: 0,
    sent: 0,
    failed: 0,
    disabledReason: 'sdk-console-sink-only',
  });
  private cohortBucket: number | null = null;

  constructor(composition?: AnalyticsServiceComposition) {
    this.sdk = composition?.sdk ?? createAnalytics<FtdEvent>({
      env: import.meta.env.PROD ? 'production' : 'development',
      sessionId: createFtdSessionId(),
      sinks: import.meta.env.DEV ? [createConsoleSink()] : [],
      globalParams: { game: 'find_the_dog', build: buildStamp() },
    });
    if (composition !== undefined) this.configureComposition(composition);
  }

  configureComposition(composition: AnalyticsServiceComposition): void {
    this.sdk = composition.sdk;
    this.attributionPort = composition.attribution ?? attribution;
    this.providerNamePort = composition.providerName ?? (() => adService.providerName);
    this.ownedMirrorStatsPort = composition.ownedMirrorStats ?? this.ownedMirrorStatsPort;
  }

  async init(): Promise<void> {
    this.sdk.sessionStart({ first_open: false });
    // 33% of UA-test sessions never delivered a session end: nothing flushed
    // analytics when the app backgrounded, and a killed WKWebView never fires
    // beforeunload. Flush every buffering sink the moment we suspend — the
    // background grace window is the last reliable execution slot.
    registerLifecycleHooks('analytics-flush', {
      onSuspend: (): void => {
        this.sdk.track('app_background');
        this.sdk.sessionEnd();
        void this.sdk.flush();
      },
      onResume: (): void => {
        this.sdk.track('app_foreground');
        this.sdk.sessionStart({ first_open: false });
      },
    });
  }

  setCohortBucket(bucket: number): void {
    this.cohortBucket = bucket;
  }

  ownedMirrorStats(): OwnedAnalyticsMirrorStats {
    return this.ownedMirrorStatsPort();
  }

  appOpen(): Promise<void> {
    void this.attributionPort.appOpen(this.cohortBucket);
    this.sdk.track('app_open', compactParams({ cohort_bucket: this.cohortBucket }));
    return Promise.resolve();
  }

  levelStart(params: LevelStartParams): Promise<void> {
    void this.attributionPort.levelStart({ level_id: params.level_id, level_name: params.level_name });
    this.sdk.levelStart({
      level_id: params.level_id,
      level_index: levelIndex(params),
    });
    return Promise.resolve();
  }

  levelComplete(params: LevelCompleteParams): Promise<void> {
    void this.attributionPort.levelComplete({
      level_id: params.level_id,
      time_seconds: params.time_seconds,
      hints_used: params.hints_used,
      wrong_taps: params.wrong_taps,
    });
    this.sdk.levelComplete({
      level_id: params.level_id,
      level_index: levelIndex(params),
      duration_ms: Math.round(params.time_seconds * 1000),
    });
    return Promise.resolve();
  }

  levelFailed(params: LevelFailedParams): Promise<void> {
    void this.attributionPort.levelFailed({ level_id: params.level_id, dogs_found: params.dogs_found });
    this.sdk.levelFail({
      level_id: params.level_id,
      level_index: levelIndex(params),
      reason: 'out_of_lives',
    });
    return Promise.resolve();
  }

  dogFound(params: DogFoundParams): Promise<void> {
    this.sdk.track('dog_found', compactParams({ ...params }));
    return Promise.resolve();
  }

  hintUsed(params: HintUsedParams): Promise<void> {
    this.sdk.track('hint_used', compactParams({ ...params }));
    this.sdk.resourceChange({
      currency: 'hints',
      amount: 1,
      flow: 'sink',
      reason: 'hint_used',
    });
    return Promise.resolve();
  }

  settingsChanged(params: SettingsChangedParams): Promise<void> {
    this.sdk.track('settings_changed', compactParams(params));
    return Promise.resolve();
  }

  adShown(params: AdShownParams): Promise<void> {
    this.sdk.adImpression({
      ad_format: params.ad_type === 'interstitial' ? 'interstitial' : 'banner',
      placement: params.placement,
      provider: this.providerNamePort(),
    });
    this.sdk.track('ad_shown', compactParams(params));
    return Promise.resolve();
  }

  adShowFailed(params: AdShowFailedParams): Promise<void> {
    this.sdk.track('ad_show_failed', compactParams(params));
    return Promise.resolve();
  }

  adRevenuePaid(params: AdRevenuePaidParams): Promise<void> {
    this.sdk.track('ad_revenue_paid', compactParams(params));
    return Promise.resolve();
  }

  resourceChanged(params: ResourceChangedParams): Promise<void> {
    this.sdk.resourceChange({
      currency: params.currency,
      amount: params.amount,
      flow: params.flow_type,
      reason: params.item_id,
      balance: undefined,
    });
    this.sdk.track('resource_changed', compactParams(params));
    return Promise.resolve();
  }

  productTapped(params: ProductTappedParams): Promise<void> {
    this.sdk.track('product_tapped', compactParams(params));
    return Promise.resolve();
  }

  purchaseInitiated(params: PurchaseInitiatedParams): Promise<void> {
    this.sdk.track('purchase_initiated', compactParams(params));
    return Promise.resolve();
  }

  purchaseSheetShown(params: PurchaseSheetShownParams): Promise<void> {
    this.sdk.track('purchase_sheet_shown', compactParams(params));
    return Promise.resolve();
  }

  purchaseCancelled(params: PurchaseCancelledParams): Promise<void> {
    this.sdk.track('purchase_cancelled', compactParams(params));
    return Promise.resolve();
  }

  purchaseFailed(params: PurchaseFailedParams): Promise<void> {
    this.sdk.track('purchase_failed', compactParams({
      ...params,
      // Cap free-text store errors so a giant native message can't blow the
      // param-size budget of any sink.
      error_message: params.error_message?.slice(0, 96),
    }));
    return Promise.resolve();
  }

  iapStateChanged(params: IapStateChangedParams): Promise<void> {
    this.sdk.track('iap_state_changed', compactParams(params));
    return Promise.resolve();
  }

  purchaseFulfilled(params: PurchaseFulfilledParams): Promise<void> {
    this.sdk.purchase({ product_id: params.product_id, quantity: 1 });
    this.sdk.track('purchase_fulfilled', compactParams(params));
    return Promise.resolve();
  }

  purchaseUnfulfilled(params: PurchaseUnfulfilledParams): Promise<void> {
    this.sdk.track('purchase_unfulfilled', compactParams(params));
    return Promise.resolve();
  }

  rewardedAdGranted(params: RewardedAdGrantedParams): Promise<void> {
    this.sdk.adReward({
      ad_format: 'rewarded',
      placement: params.placement,
      provider: this.providerNamePort(),
      reward_type: params.placement,
    });
    this.sdk.track('rewarded_ad_granted', compactParams(params));
    return Promise.resolve();
  }
}

export const analytics = new AnalyticsService();
