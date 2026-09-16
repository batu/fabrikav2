import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  INTERSTITIAL_CADENCE_STORAGE_KEY,
  REWARDED_TO_INTERSTITIAL_COOLDOWN_MS,
  adExposureSummary,
  cadenceProgress,
  configureInterstitialCadence,
  recordCompletion,
  recordInterstitialShown,
  recordRewardedFinished,
  recordRewardedStarted,
  resetInterstitialCadenceForTest,
  rewardedAdInFlight,
  rewardedCooldownRemainingMs,
} from '../../src/ads/interstitialCadence';
import { resolveInterstitialGate } from '../../src/analytics/BetweenLevelFlow';
import { adExposureBucket } from '../../src/analytics/adPolicyDimensions';
import {
  adPolicyCohort,
  automaticAdBlockReason,
  configureSessionAds,
  daysSinceInstall,
  installDayUtc,
} from '../../src/ads/sessionAdPolicy';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const T0 = Date.UTC(2026, 8, 17, 12, 0, 0);
let now = T0;
const clock = () => now;

const gate = (cadence: number, extra: Partial<Parameters<typeof resolveInterstitialGate>[0]> = {}) => resolveInterstitialGate({
  everyN: 3, minLevelNumber: 0, nextLevelNumber: 5, adsEnabled: true, hasNoAdsEntitlement: false,
  automaticAdBlockReason: null, cadenceProgress: cadence, rewardedCooldownRemainingMs: rewardedCooldownRemainingMs(), ...extra,
});

describe('persisted interstitial cadence (ad policy v2)', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    now = T0;
    storage = memoryStorage();
    configureInterstitialCadence({ storage, clock });
  });
  afterEach(() => resetInterstitialCadenceForTest());

  it('counts each committed completion once and survives a relaunch (2 + restart + 1 = eligible)', () => {
    expect(recordCompletion('tx-1', 3, true)).toBe(1);
    expect(recordCompletion('tx-1', 3, true)).toBe(1);
    expect(recordCompletion('tx-2', 3, true)).toBe(2);
    expect(gate(2)).toEqual({ eligible: false, reason: 'cadence_not_reached' });
    configureInterstitialCadence({ storage, clock });
    expect(cadenceProgress()).toBe(2);
    expect(recordCompletion('tx-3', 3, true)).toBe(3);
    expect(gate(3)).toEqual({ eligible: true, reason: 'cadence' });
  });

  it('protected completions never become ad debt', () => {
    expect(recordCompletion('tx-1', 3, false)).toBe(0);
    expect(recordCompletion('tx-2', 3, false)).toBe(0);
    expect(storage.values.has(INTERSTITIAL_CADENCE_STORAGE_KEY)).toBe(false);
  });

  it('saturates at N: a missed opportunity is retained, never stacked', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) recordCompletion(id, 3, true);
    expect(cadenceProgress()).toBe(3);
    expect(gate(3)).toEqual({ eligible: true, reason: 'cadence' });
    recordInterstitialShown(1);
    expect(cadenceProgress()).toBe(0);
    expect(recordCompletion('f', 3, true)).toBe(1);
  });

  it('only a confirmed presentation resets progress; a failed show keeps the pending opportunity', () => {
    for (const id of ['a', 'b', 'c']) recordCompletion(id, 3, true);
    // GameScene only calls recordInterstitialShown on `shown === true`; a
    // false result leaves the record untouched.
    expect(cadenceProgress()).toBe(3);
    recordInterstitialShown(0);
    expect(cadenceProgress()).toBe(0);
    expect(adExposureSummary()).toEqual({ auto_ad_impressions: 1, first_auto_ad_day: 0 });
    recordInterstitialShown(4);
    expect(adExposureSummary()).toEqual({ auto_ad_impressions: 2, first_auto_ad_day: 0 });
  });

  it('a rewarded ad that starts clears progress, blocks while open, and starts a 120 s cooldown on dismissal, earned or not', () => {
    for (const id of ['a', 'b', 'c']) recordCompletion(id, 3, true);
    recordRewardedStarted();
    expect(rewardedAdInFlight()).toBe(true);
    expect(cadenceProgress()).toBe(0);
    recordRewardedFinished();
    expect(rewardedAdInFlight()).toBe(false);
    expect(rewardedCooldownRemainingMs()).toBe(REWARDED_TO_INTERSTITIAL_COOLDOWN_MS);
    // Three more completions while cooling down: cooldown is named first.
    for (const id of ['d', 'e', 'f']) recordCompletion(id, 3, true);
    now = T0 + 90_000;
    expect(gate(3)).toEqual({ eligible: false, reason: 'rewarded_cooldown' });
    now = T0 + REWARDED_TO_INTERSTITIAL_COOLDOWN_MS;
    expect(gate(3)).toEqual({ eligible: true, reason: 'cadence' });
  });

  it('the rewarded cooldown survives a restart; an in-flight flag does not', () => {
    recordRewardedStarted();
    recordRewardedFinished();
    configureInterstitialCadence({ storage, clock });
    expect(rewardedAdInFlight()).toBe(false);
    expect(rewardedCooldownRemainingMs()).toBe(REWARDED_TO_INTERSTITIAL_COOLDOWN_MS);
  });

  it('a rewarded attempt that never presents changes nothing', () => {
    for (const id of ['a', 'b', 'c']) recordCompletion(id, 3, true);
    // No lifecycle start/finish is delivered for a not-loaded rewarded ad.
    expect(cadenceProgress()).toBe(3);
    expect(rewardedCooldownRemainingMs()).toBe(0);
    expect(gate(3)).toEqual({ eligible: true, reason: 'cadence' });
  });

  it('tolerates corrupt storage and a null storage', () => {
    configureInterstitialCadence({ storage: memoryStorage({ [INTERSTITIAL_CADENCE_STORAGE_KEY]: '{not json' }), clock });
    expect(cadenceProgress()).toBe(0);
    configureInterstitialCadence({ storage: null, clock });
    expect(recordCompletion('a', 3, true)).toBe(1);
  });
});

describe('install-day protection (ad policy v2)', () => {
  afterEach(() => configureSessionAds(true, 'durable'));

  it('a new install is protected on its UTC install day and cohorted as new_install', () => {
    const storage = memoryStorage();
    configureSessionAds(false, 'durable', storage, () => Date.UTC(2026, 8, 16, 23, 59));
    expect(installDayUtc()).toBe('2026-09-16');
    expect(adPolicyCohort()).toBe('new_install');
    expect(automaticAdBlockReason()).toBe('install_day');
    expect(daysSinceInstall()).toBe(0);
    configureSessionAds(true, 'durable', storage, () => Date.UTC(2026, 8, 17, 0, 1));
    expect(automaticAdBlockReason()).toBeNull();
    expect(daysSinceInstall()).toBe(1);
    expect(adPolicyCohort()).toBe('new_install');
  });

  it('an existing install without the key is never protected and has no install day', () => {
    configureSessionAds(true, 'durable', memoryStorage({ ftd_level: '7' }));
    expect(adPolicyCohort()).toBe('existing_install');
    expect(installDayUtc()).toBeNull();
    expect(daysSinceInstall()).toBeNull();
    expect(automaticAdBlockReason()).toBeNull();
  });

  it('volatile storage blocks automatic ads and reports storage_unavailable', () => {
    configureSessionAds(false, 'volatile', memoryStorage());
    expect(adPolicyCohort()).toBe('storage_unavailable');
    expect(automaticAdBlockReason()).toBe('storage_unavailable');
  });

  it('buckets first exposure day for the GameAnalytics split', () => {
    expect([-1, 0, 1, 2, 3, 4, 30].map(adExposureBucket)).toEqual([
      'auto_ads_none', 'auto_ads_first_d0', 'auto_ads_first_d1', 'auto_ads_first_d2_3', 'auto_ads_first_d2_3', 'auto_ads_first_d4plus', 'auto_ads_first_d4plus',
    ]);
  });
});
