import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@fabrikav2/sdk/analytics';
import { analytics } from '../../src/analytics/AnalyticsService';
import {
  canonicalAnalyticsEvents,
  dashboardImportDimensionKeys,
  firebaseEventName,
  sanitizeCanonicalAnalyticsParams,
} from '../../src/analytics/CanonicalAnalyticsEvents';
import {
  designEvent,
  gameAnalyticsDesignEventId,
  gameAnalyticsDesignEventValue,
} from '../../src/analytics/GameAnalyticsEvents';
import { createGameAnalyticsSink, type GameAnalyticsSdk } from '../../src/analytics/GameAnalyticsSink';
import {
  consumeNextLevelReady,
  createLevelCompleteActionTracker,
  markInterstitialShownBeforeNextLevel,
  markLevelCompleteLeft,
  resetBetweenLevelFlowForTest,
  resolveInterstitialGate,
} from '../../src/analytics/BetweenLevelFlow';
import { AD_FORMAT_PLACEMENT, createAdMobCompositionOptions } from '../../src/ads/adMobComposition';

// The six between-level events, their GameAnalytics
// design ids, and the params that must survive both durable sinks (the
// GameAnalytics sink's per-event custom-field allowlist and the owned mirror's
// canonical sanitizer).
const betweenLevelEvents = [
  {
    id: 'level_complete_shown',
    gaId: 'level_complete:shown',
    valueKey: 'duration_ms',
    params: { level_id: 'hawaii', sequence_slot: 3, level_index: 2, levels_completed_session: 3, duration_ms: 41_200 },
  },
  {
    id: 'level_complete_action',
    gaId: 'level_complete:action',
    valueKey: 'dwell_ms',
    params: { level_id: 'hawaii', sequence_slot: 3, level_index: 2, action: 'next', dwell_ms: 6_100, reward_revealed: true },
  },
  {
    id: 'interstitial_gate',
    gaId: 'interstitial:gate',
    valueKey: null,
    params: { level_id: 'hawaii', sequence_slot: 3, level_index: 2, eligible: true, reason: 'cadence', every_n: 3, levels_completed_session: 3 },
  },
  {
    id: 'ad_lifecycle',
    gaId: 'ad:lifecycle',
    valueKey: 'cache_age_ms',
    params: { ad_type: 'interstitial', placement: 'between_levels', stage: 'dismissed', reason: 'frequency_cap', attempt: 1, cache_age_ms: 900, level_index: 2 },
  },
  {
    id: 'next_level_ready',
    gaId: 'level:next_ready',
    valueKey: 'gap_ms',
    params: { level_id: 'santorini', sequence_slot: 4, level_index: 3, gap_ms: 8_400, after_interstitial: true },
  },
  {
    id: 'level_abandoned',
    gaId: 'level:abandoned',
    valueKey: 'elapsed_ms',
    params: { level_id: 'hawaii', sequence_slot: 3, level_index: 2, reason: 'background', elapsed_ms: 12_000, found_count: 4, total_count: 15 },
  },
] as const;

function trackSpy(): ReturnType<typeof vi.spyOn> {
  const sdk = (analytics as unknown as { sdk: { track: (...args: unknown[]) => void } }).sdk;
  return vi.spyOn(sdk, 'track');
}

function stringified(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));
}

afterEach(() => {
  vi.restoreAllMocks();
  resetBetweenLevelFlowForTest();
});

describe('between-level contract entries', () => {
  const byId = new Map(canonicalAnalyticsEvents.map((event) => [event.id, event]));

  it.each(betweenLevelEvents)('$id is a runtime event mapped to $gaId with matching Firebase name', ({ id, gaId }) => {
    const entry = byId.get(id);
    expect(entry?.instrumentationStatus).toBe('runtime');
    expect(entry?.gameAnalyticsName).toBe(gaId);
    expect(firebaseEventName(id as never)).toBe(id);
    expect(gameAnalyticsDesignEventId(id, {})).toBe(gaId);
    for (const dimension of entry?.primaryDimensions ?? []) {
      expect(dashboardImportDimensionKeys as readonly string[]).toContain(dimension);
    }
  });

  it.each(betweenLevelEvents)('$id keeps every param through the owned-mirror sanitizer', ({ id, params }) => {
    expect(sanitizeCanonicalAnalyticsParams(id, params)).toEqual(params);
  });

  it.each(betweenLevelEvents)('$id keeps every param as a GameAnalytics custom field and lifts $valueKey into value', ({ id, gaId, valueKey, params }) => {
    const value = gameAnalyticsDesignEventValue(id, params);
    const ga = designEvent(gameAnalyticsDesignEventId(id, params), params, value);
    expect(ga.eventId).toBe(gaId);
    expect(ga.customFields).toEqual(stringified(params));
    expect(ga.value).toBe(valueKey === null ? undefined : params[valueKey as keyof typeof params]);
  });

  it('every event carries level_index so the funnel can be cut at 3 -> 4', () => {
    for (const { id } of betweenLevelEvents) {
      expect(sanitizeCanonicalAnalyticsParams(id, { level_index: 2 })).toEqual({ level_index: 2 });
    }
  });
});

describe('AnalyticsService between-level emitters', () => {
  it('levelCompleteShown / levelCompleteAction / interstitialGate / nextLevelReady / levelAbandoned / adLifecycle track the canonical ids', async () => {
    const spy = trackSpy();
    await analytics.levelCompleteShown({ level_id: 'hawaii', sequence_slot: 3, level_index: 2, levels_completed_session: 3, duration_ms: 41_200 });
    await analytics.levelCompleteAction({ level_id: 'hawaii', level_index: 2, action: 'rate_prompt', dwell_ms: 6_100, reward_revealed: false });
    await analytics.interstitialGate({ level_id: 'hawaii', level_index: 2, eligible: false, reason: 'min_level', every_n: 3, levels_completed_session: 3 });
    await analytics.nextLevelReady({ level_id: 'santorini', level_index: 3, gap_ms: 8_400, after_interstitial: true });
    await analytics.levelAbandoned({ level_id: 'hawaii', level_index: 2, reason: 'shutdown', elapsed_ms: 12_000, found_count: 4, total_count: 15 });
    await analytics.adLifecycle({ ad_type: 'interstitial', placement: 'between_levels', stage: 'shown', cache_age_ms: 900, reason: undefined, level_index: 2 });
    expect(spy.mock.calls).toEqual([
      ['level_complete_shown', { level_id: 'hawaii', sequence_slot: 3, level_index: 2, levels_completed_session: 3, duration_ms: 41_200 }],
      ['level_complete_action', { level_id: 'hawaii', level_index: 2, action: 'rate_prompt', dwell_ms: 6_100, reward_revealed: false }],
      ['interstitial_gate', { level_id: 'hawaii', level_index: 2, eligible: false, reason: 'min_level', every_n: 3, levels_completed_session: 3 }],
      ['next_level_ready', { level_id: 'santorini', level_index: 3, gap_ms: 8_400, after_interstitial: true }],
      ['level_abandoned', { level_id: 'hawaii', level_index: 2, reason: 'shutdown', elapsed_ms: 12_000, found_count: 4, total_count: 15 }],
      ['ad_lifecycle', { ad_type: 'interstitial', placement: 'between_levels', stage: 'shown', cache_age_ms: 900, level_index: 2 }],
    ]);
  });
});

describe('GameAnalytics sink dispatch', () => {
  it('sends level_complete:action as a design event with dwell_ms as value and stringified custom fields', async () => {
    const sdk = gameAnalyticsSdk();
    const sink = createGameAnalyticsSink({ gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false }, { loader: async () => sdk });
    const params = { level_id: 'hawaii', sequence_slot: 3, level_index: 2, action: 'next', dwell_ms: 6_100, reward_revealed: true, cohort_bucket: 7 };
    sink.emit(analyticsEvent('level_complete_action', params));
    await sink.flush?.();
    expect(sdk.GameAnalytics.addDesignEvent).toHaveBeenCalledWith('level_complete:action', 6_100, stringified(params));
  });

  it('sends ad:lifecycle with stage and reason as custom fields (FTB previously dropped them)', async () => {
    const sdk = gameAnalyticsSdk();
    const sink = createGameAnalyticsSink({ gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false }, { loader: async () => sdk });
    sink.emit(analyticsEvent('ad_lifecycle', { ad_type: 'interstitial', placement: 'between_levels', stage: 'skipped', reason: 'not_loaded', level_index: 2 }));
    await sink.flush?.();
    expect(sdk.GameAnalytics.addDesignEvent).toHaveBeenCalledWith('ad:lifecycle', undefined, {
      ad_type: 'interstitial', placement: 'between_levels', stage: 'skipped', reason: 'not_loaded', level_index: '2',
    });
  });
});

describe('resolveInterstitialGate', () => {
  const base = { everyN: 3, minLevelNumber: 1, adsEnabled: true, hasNoAdsEntitlement: false };

  it('levels 1 and 2 are stopped by cadence; level 3 is eligible', () => {
    expect(resolveInterstitialGate({ ...base, levelsCompletedSession: 1, nextLevelNumber: 2 })).toEqual({ eligible: false, reason: 'cadence' });
    expect(resolveInterstitialGate({ ...base, levelsCompletedSession: 2, nextLevelNumber: 3 })).toEqual({ eligible: false, reason: 'cadence' });
    expect(resolveInterstitialGate({ ...base, levelsCompletedSession: 3, nextLevelNumber: 4 })).toEqual({ eligible: true, reason: 'cadence' });
  });

  it('names min_level, no_ads_entitlement and ads_disabled in that order once cadence hits', () => {
    expect(resolveInterstitialGate({ ...base, levelsCompletedSession: 3, nextLevelNumber: 4, minLevelNumber: 6 })).toEqual({ eligible: false, reason: 'min_level' });
    expect(resolveInterstitialGate({ ...base, levelsCompletedSession: 3, nextLevelNumber: 4, adsEnabled: false, hasNoAdsEntitlement: true })).toEqual({ eligible: false, reason: 'no_ads_entitlement' });
    expect(resolveInterstitialGate({ ...base, levelsCompletedSession: 3, nextLevelNumber: 4, adsEnabled: false })).toEqual({ eligible: false, reason: 'ads_disabled' });
  });

  it('a zero cadence never fires and reports cadence', () => {
    expect(resolveInterstitialGate({ ...base, everyN: 0, levelsCompletedSession: 3, nextLevelNumber: 4 })).toEqual({ eligible: false, reason: 'cadence' });
  });
});

describe('level-complete action tracker', () => {
  it('background reports once and does not consume the leave action', () => {
    const tracker = createLevelCompleteActionTracker(1_000);
    expect(tracker.background(3_500)).toEqual({ action: 'background', dwell_ms: 2_500 });
    expect(tracker.background(4_000)).toBeNull();
    expect(tracker.leave('next', 9_000)).toEqual({ action: 'next', dwell_ms: 8_000 });
    expect(tracker.left).toBe(true);
  });

  it('a shutdown after Next is not a second action', () => {
    const tracker = createLevelCompleteActionTracker(1_000);
    expect(tracker.leave('claim_x2', 5_000)).toEqual({ action: 'claim_x2', dwell_ms: 4_000 });
    expect(tracker.leave('dismissed_by_shutdown', 5_100)).toBeNull();
    expect(tracker.background(5_200)).toBeNull();
  });
});

describe('next_level_ready pending state', () => {
  it('carries the leave timestamp and the interstitial marker to the next consume, then clears', () => {
    expect(consumeNextLevelReady(10)).toBeNull();
    markLevelCompleteLeft(1_000);
    markInterstitialShownBeforeNextLevel();
    expect(consumeNextLevelReady(9_400)).toEqual({ gap_ms: 8_400, after_interstitial: true });
    expect(consumeNextLevelReady(9_500)).toBeNull();
  });

  it('a level reached without an interstitial reports after_interstitial false', () => {
    markLevelCompleteLeft(1_000);
    expect(consumeNextLevelReady(1_900)).toEqual({ gap_ms: 900, after_interstitial: false });
  });
});

describe('AdMob composition: lifecycle events -> ad_lifecycle', () => {
  it('keeps interstitial presentation on the completed level after Next advances', () => {
    const calls: { stage: string; level_index?: number }[] = [];
    let currentLevelIndex = 2;
    const options = createAdMobCompositionOptions({
      analytics: { adLifecycle: async (params) => { calls.push(params); }, adShown: async () => {}, adShowFailed: async () => {}, adRevenuePaid: async () => {} },
      forwardAcquisitionValueEvent: async () => true,
      currentLevelIndex: () => currentLevelIndex,
    });
    markLevelCompleteLeft(1_000, currentLevelIndex);
    currentLevelIndex = 3;
    for (const stage of ['show_requested', 'shown', 'impression', 'dismissed', 'show_failed', 'skipped'] as const) {
      options.onAdEvent({ format: 'interstitial', stage });
    }
    expect(calls.map((call) => call.level_index)).toEqual([2, 2, 2, 2, 2, 2]);
    options.onAdEvent({ format: 'interstitial', stage: 'load_requested' });
    options.onAdEvent({ format: 'interstitial', stage: 'loaded' });
    options.onAdEvent({ format: 'interstitial', stage: 'load_failed' });
    options.onAdEvent({ format: 'rewarded', stage: 'shown' });
    options.onAdEvent({ format: 'banner', stage: 'impression' });
    expect(calls.slice(6).map((call) => call.level_index)).toEqual([3, 3, 3, 3, 3]);
    consumeNextLevelReady(2_000);
    options.onAdEvent({ format: 'interstitial', stage: 'show_requested' });
    expect(calls.at(-1)?.level_index).toBe(3);
  });

  it('every provider stage becomes an ad_lifecycle event with the static placement and the current level index', () => {
    const calls: unknown[] = [];
    const options = createAdMobCompositionOptions({
      analytics: { adLifecycle: async (params) => { calls.push(params); }, adShown: async () => {}, adShowFailed: async () => {}, adRevenuePaid: async () => {} },
      forwardAcquisitionValueEvent: async () => true,
      currentLevelIndex: () => 2,
    });
    options.onAdEvent({ format: 'interstitial', stage: 'load_failed', loadId: 'interstitial-0-3', attempt: 2, reason: 'native_2' });
    options.onAdEvent({ format: 'interstitial', stage: 'dismissed', loadId: 'interstitial-0-4', cacheAgeMs: 4_200 });
    expect(calls).toEqual([
      { ad_type: 'interstitial', placement: AD_FORMAT_PLACEMENT.interstitial, stage: 'load_failed', load_id: 'interstitial-0-3', reason: 'native_2', attempt: 2, cache_age_ms: undefined, level_index: 2 },
      { ad_type: 'interstitial', placement: AD_FORMAT_PLACEMENT.interstitial, stage: 'dismissed', load_id: 'interstitial-0-4', reason: undefined, attempt: undefined, cache_age_ms: 4_200, level_index: 2 },
    ]);
  });
});

function analyticsEvent(name: string, params: AnalyticsEvent['params']): AnalyticsEvent {
  return { name, params, timestamp: 1, sessionId: 's', env: 'development' };
}

function gameAnalyticsSdk(): GameAnalyticsSdk {
  return {
    GameAnalytics: {
      setEnabledInfoLog: vi.fn(),
      setEnabledVerboseLog: vi.fn(),
      configureAvailableResourceCurrencies: vi.fn(),
      configureAvailableResourceItemTypes: vi.fn(),
      setEnabledManualSessionHandling: vi.fn(),
      initialize: vi.fn(),
      startSession: vi.fn(),
      endSession: vi.fn(),
      isSdkReady: vi.fn(() => true),
      addProgressionEvent: vi.fn(),
      addDesignEvent: vi.fn(),
      addResourceEvent: vi.fn(),
      addAdEvent: vi.fn(),
    },
    EGAProgressionStatus: { Start: 1, Complete: 2, Fail: 3 },
    EGAResourceFlowType: { Source: 1, Sink: 2 },
    EGAAdAction: { Show: 1, FailedShow: 2, RewardReceived: 3 },
    EGAAdType: { Banner: 1, Interstitial: 2, RewardedVideo: 3 },
  };
}
