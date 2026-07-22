import {
  createAnalytics,
  createConsoleSink,
  type Analytics,
  type AnalyticsParamValue,
} from '@fabrikav2/sdk/analytics';
import { attribution } from '../attribution/AttributionService';
import { adService } from '../ads/Service';
import type { PurchaseUnfulfilledOutcome } from '../shop/PurchaseFulfillment';
import type { AnalyticsLevelAttribution } from './AnalyticsEventContract';
import type {
  AchievementPageViewedPayload,
  AchievementProgressPayload,
  AchievementReconciliationAnomalyPayload,
  AchievementRewardGrantedPayload,
  AchievementUnlockedPayload,
  AchievementViewedPayload,
  AchievementViewEvent,
  PendingAnalyticsEvent,
} from '../achievements/AchievementAnalytics';

type FtdEvent =
  | 'app_open'
  | 'dog_found'
  | 'hint_used'
  | 'settings_changed'
  | 'ad_shown'
  | 'ad_revenue_paid'
  | 'resource_changed'
  | 'purchase_fulfilled'
  | 'purchase_unfulfilled'
  | 'rewarded_ad_granted'
  | 'achievement_progress'
  | 'achievement_unlocked'
  | 'achievement_reward_granted'
  | 'achievement_reconciliation_anomaly'
  // Defined now so the contract is whole; emitted by the achievements UI.
  | 'achievement_viewed'
  | 'achievement_page_viewed';

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

function sessionId(): string {
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

function providerName(): string {
  return adService.providerName;
}

class AnalyticsService {
  private readonly sdk: Analytics<FtdEvent>;
  private cohortBucket: number | null = null;

  constructor() {
    this.sdk = createAnalytics<FtdEvent>({
      env: import.meta.env.PROD ? 'production' : 'development',
      sessionId: sessionId(),
      sinks: import.meta.env.DEV ? [createConsoleSink()] : [],
      globalParams: { game: 'shell_template' },
    });
  }

  async init(): Promise<void> {
    this.sdk.sessionStart({ first_open: false });
  }

  setCohortBucket(bucket: number): void {
    this.cohortBucket = bucket;
  }

  ownedMirrorStats(): OwnedAnalyticsMirrorStats {
    return { queued: 0, dropped: 0, sent: 0, failed: 0, disabledReason: 'sdk-console-sink-only' };
  }

  appOpen(): Promise<void> {
    void attribution.appOpen(this.cohortBucket);
    this.sdk.track('app_open', compactParams({ cohort_bucket: this.cohortBucket }));
    return Promise.resolve();
  }

  levelStart(params: LevelStartParams): Promise<void> {
    void attribution.levelStart({ level_id: params.level_id, level_name: params.level_name });
    this.sdk.levelStart({
      level_id: params.level_id,
      level_index: levelIndex(params),
    });
    return Promise.resolve();
  }

  levelComplete(params: LevelCompleteParams): Promise<void> {
    void attribution.levelComplete({
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
    void attribution.levelFailed({ level_id: params.level_id, dogs_found: params.dogs_found });
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
      provider: providerName(),
    });
    this.sdk.track('ad_shown', compactParams(params));
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
      provider: providerName(),
      reward_type: params.placement,
    });
    this.sdk.track('rewarded_ad_granted', compactParams(params));
    return Promise.resolve();
  }

  achievementProgress(payload: AchievementProgressPayload): void {
    this.sdk.track('achievement_progress', compactParams({ ...payload }));
  }

  achievementUnlocked(payload: AchievementUnlockedPayload): void {
    this.sdk.track('achievement_unlocked', compactParams({ ...payload }));
  }

  achievementRewardGranted(payload: AchievementRewardGrantedPayload): void {
    this.sdk.track('achievement_reward_granted', compactParams({ ...payload }));
  }

  achievementReconciliationAnomaly(payload: AchievementReconciliationAnomalyPayload): void {
    this.sdk.track('achievement_reconciliation_anomaly', compactParams({ ...payload }));
  }

  achievementViewed(payload: AchievementViewedPayload): void {
    this.sdk.track('achievement_viewed', compactParams({ ...payload }));
  }

  achievementPageViewed(payload: AchievementPageViewedPayload): void {
    this.sdk.track('achievement_page_viewed', compactParams({ ...payload }));
  }

  /**
   * The public exhaustive dispatcher for durable domain events and allocated UI
   * view events. Callers never access the private SDK or dynamically index methods.
   */
  dispatchAchievementEvent(event: PendingAnalyticsEvent | AchievementViewEvent): void {
    switch (event.name) {
      case 'achievement_progress':
        this.achievementProgress(event.payload);
        return;
      case 'achievement_unlocked':
        this.achievementUnlocked(event.payload);
        return;
      case 'achievement_reward_granted':
        this.achievementRewardGranted(event.payload);
        return;
      case 'achievement_reconciliation_anomaly':
        this.achievementReconciliationAnomaly(event.payload);
        return;
      case 'achievement_viewed':
        this.achievementViewed(event.payload);
        return;
      case 'achievement_page_viewed':
        this.achievementPageViewed(event.payload);
        return;
      default: {
        const exhaustive: never = event;
        void exhaustive;
        throw new Error('Unknown achievement analytics event');
      }
    }
  }
}

export const analytics = new AnalyticsService();
