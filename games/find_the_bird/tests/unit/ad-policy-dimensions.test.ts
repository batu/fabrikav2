import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGameAnalyticsSink, type GameAnalyticsSdk } from '../../src/analytics/GameAnalyticsSink';
import { AD_EXPOSURE_DIMENSION, AD_POLICY_COHORT_DIMENSION } from '../../src/analytics/adPolicyDimensions';
import { adPolicyUserProperties } from '../../src/analytics/adPolicyUserProperties';
import { configureInterstitialCadence, recordInterstitialShown, resetInterstitialCadenceForTest } from '../../src/ads/interstitialCadence';
import { configureSessionAds } from '../../src/ads/sessionAdPolicy';

function sdk(): GameAnalyticsSdk {
  const calls: string[] = [];
  const track = (name: string) => vi.fn(() => { calls.push(name); });
  return {
    GameAnalytics: {
      setEnabledInfoLog: vi.fn(), setEnabledVerboseLog: vi.fn(),
      configureAvailableResourceCurrencies: vi.fn(), configureAvailableResourceItemTypes: vi.fn(),
      configureAvailableCustomDimensions01: track('configure01'), setCustomDimension01: track('set01'),
      configureAvailableCustomDimensions02: track('configure02'), setCustomDimension02: track('set02'),
      setEnabledManualSessionHandling: vi.fn(), initialize: track('initialize'), startSession: vi.fn(), endSession: vi.fn(),
      isSdkReady: vi.fn(() => true), addProgressionEvent: vi.fn(), addDesignEvent: vi.fn(), addResourceEvent: vi.fn(), addAdEvent: vi.fn(),
    },
    EGAProgressionStatus: { Start: 1, Complete: 2, Fail: 3 }, EGAResourceFlowType: { Source: 1, Sink: 2 },
    EGAAdAction: { Show: 1, FailedShow: 2, RewardReceived: 3 }, EGAAdType: { Banner: 1, Interstitial: 2, RewardedVideo: 3 },
    __calls: calls,
  } as GameAnalyticsSdk & { __calls: string[] };
}

const store = () => { const v = new Map<string, string>(); return { getItem: (k: string) => v.get(k) ?? null, setItem: (k: string, x: string) => { v.set(k, x); } }; };

afterEach(() => { configureSessionAds(true, 'durable'); resetInterstitialCadenceForTest(); });

describe('ad policy cohort dimensions', () => {
  it('declares and sets both GameAnalytics dimensions before initialize()', async () => {
    configureSessionAds(false, 'durable', store(), () => Date.UTC(2026, 8, 16, 12));
    configureInterstitialCadence({ storage: store(), clock: () => Date.UTC(2026, 8, 17, 12) });
    recordInterstitialShown(1);
    const loaded = sdk() as ReturnType<typeof sdk> & { __calls: string[] };
    const sink = createGameAnalyticsSink({ gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false }, {
      loader: async () => loaded, customDimension01: AD_POLICY_COHORT_DIMENSION, customDimension02: AD_EXPOSURE_DIMENSION,
    });
    sink.emit({ name: 'session_start', params: {}, sessionId: 's', env: 'development', timestamp: 0 } as never);
    await sink.flush?.();
    expect(loaded.GameAnalytics.setCustomDimension01).toHaveBeenCalledWith('ads_v2_new_install');
    expect(loaded.GameAnalytics.setCustomDimension02).toHaveBeenCalledWith('auto_ads_first_d1');
    expect(loaded.__calls.indexOf('set02')).toBeLessThan(loaded.__calls.indexOf('initialize'));
    expect(loaded.__calls.indexOf('configure01')).toBeLessThan(loaded.__calls.indexOf('set01'));
  });

  it('user properties carry install day, cohort, exposure count and first exposure day', () => {
    configureSessionAds(false, 'durable', store(), () => Date.UTC(2026, 8, 16, 12));
    configureInterstitialCadence({ storage: store(), clock: () => Date.UTC(2026, 8, 16, 12) });
    expect(adPolicyUserProperties()).toEqual({
      ad_policy: 'install_day_v2', ad_policy_cohort: 'new_install', install_day: '2026-09-16',
      auto_ad_impressions: '0', first_auto_ad_day: '-1', days_since_install: '0',
    });
  });
});
