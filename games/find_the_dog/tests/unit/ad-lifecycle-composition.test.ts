import { afterEach, describe, expect, it, vi } from 'vitest';
import { AD_FORMAT_PLACEMENT, createAdMobCompositionOptions, type AdMobCompositionAnalytics } from '../../src/ads/adMobComposition';
import { adService, configureAdService } from '../../src/ads/Service';
import { DisabledAdProvider } from '../../src/ads/DisabledAdProvider';
import { analytics } from '../../src/analytics/AnalyticsService';
import { registerLifecycleHooks, resetGameLifecycleForTest, resumeGame, suspendGame } from '../../src/platform/gameLifecycle';

function makeAnalytics(): AdMobCompositionAnalytics & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  const record = (name: string) => async (params: unknown): Promise<void> => { calls.push([name, params]); };
  return {
    calls,
    adShown: record('adShown'),
    adShowFailed: record('adShowFailed'),
    adLifecycle: record('adLifecycle'),
    adRevenuePaid: record('adRevenuePaid'),
  };
}

afterEach(() => {
  resetGameLifecycleForTest();
  configureAdService(new DisabledAdProvider('test reset'));
  vi.restoreAllMocks();
});

describe('AdMob composition: app-resume seam', () => {
  it('hands the provider the game lifecycle resume signal and releases it on remove', async () => {
    const options = createAdMobCompositionOptions({ analytics: makeAnalytics(), forwardAcquisitionValueEvent: async () => true });
    const onResume = vi.fn();
    const handle = await options.addAppResumeListener(onResume);

    await suspendGame('capacitor');
    resumeGame('capacitor');
    expect(onResume).toHaveBeenCalledTimes(1);

    await handle.remove();
    await suspendGame('capacitor');
    resumeGame('capacitor');
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('registers under a stable hook id so re-registration replaces rather than stacks', async () => {
    const register = vi.fn(registerLifecycleHooks);
    const options = createAdMobCompositionOptions({ analytics: makeAnalytics(), forwardAcquisitionValueEvent: async () => true, registerHooks: register });
    const first = vi.fn();
    const second = vi.fn();
    await options.addAppResumeListener(first);
    await options.addAppResumeListener(second);
    expect(register.mock.calls.map(([id]) => id)).toEqual(['ads-resume', 'ads-resume']);
    await suspendGame('visibility');
    resumeGame('visibility');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('AdMob composition: lifecycle events → owned analytics', () => {
  it('every provider stage becomes an ad_lifecycle event with the static placement and correlation fields', () => {
    const sink = makeAnalytics();
    const options = createAdMobCompositionOptions({ analytics: sink, forwardAcquisitionValueEvent: async () => true });
    options.onAdEvent({ format: 'interstitial', stage: 'load_failed', loadId: 'interstitial-0-3', attempt: 2, reason: 'native_2' });
    options.onAdEvent({ format: 'rewarded', stage: 'show_requested', loadId: 'rewarded-0-1', cacheAgeMs: 4200 });
    expect(sink.calls).toEqual([
      ['adLifecycle', { ad_type: 'interstitial', placement: 'between_levels', stage: 'load_failed', load_id: 'interstitial-0-3', reason: 'native_2', attempt: 2, cache_age_ms: undefined }],
      ['adLifecycle', { ad_type: 'rewarded', placement: 'rewarded', stage: 'show_requested', load_id: 'rewarded-0-1', reason: undefined, attempt: undefined, cache_age_ms: 4200 }],
    ]);
  });

  it('banner ad_shown comes only from the native impression callback and ad_show_failed from the native failure', () => {
    const sink = makeAnalytics();
    const options = createAdMobCompositionOptions({ analytics: sink, forwardAcquisitionValueEvent: async () => true });
    options.onAdEvent({ format: 'banner', stage: 'load_requested', loadId: 'banner-0-1' });
    options.onAdEvent({ format: 'banner', stage: 'loaded', loadId: 'banner-0-1' });
    expect(sink.calls.filter(([name]) => name === 'adShown')).toHaveLength(0);
    options.onAdEvent({ format: 'banner', stage: 'impression', loadId: 'banner-0-1' });
    options.onAdEvent({ format: 'banner', stage: 'load_failed', loadId: 'banner-0-2', reason: 'native_3' });
    expect(sink.calls.filter(([name]) => name !== 'adLifecycle')).toEqual([
      ['adShown', { ad_type: 'banner', placement: AD_FORMAT_PLACEMENT.banner }],
      ['adShowFailed', { ad_type: 'banner', placement: AD_FORMAT_PLACEMENT.banner, reason: 'native_3' }],
    ]);
  });

  it('full-screen impressions do not duplicate the game-level ad_shown / rewarded_ad_granted events', () => {
    const sink = makeAnalytics();
    const options = createAdMobCompositionOptions({ analytics: sink, forwardAcquisitionValueEvent: async () => true });
    options.onAdEvent({ format: 'interstitial', stage: 'impression', loadId: 'interstitial-0-1' });
    options.onAdEvent({ format: 'rewarded', stage: 'reward_earned', loadId: 'rewarded-0-1' });
    expect(sink.calls.map(([name]) => name)).toEqual(['adLifecycle', 'adLifecycle']);
  });

  it('a paid callback reaches both the owned ad_revenue_paid event and the AppsFlyer value projection', () => {
    const sink = makeAnalytics();
    const forward = vi.fn(async () => true);
    const options = createAdMobCompositionOptions({ analytics: sink, forwardAcquisitionValueEvent: forward });
    options.onAdRevenuePaid({ revenue: 0.0012, currency: 'USD', format: 'rewarded', placement: 'rewarded', impressionId: 'imp-9', precision: '3', networkName: 'GADMobileAds' });
    expect(sink.calls).toEqual([[
      'adRevenuePaid',
      { ad_type: 'rewarded', placement: 'rewarded', revenue_usd: 0.0012, currency: 'USD', precision: '3', network_name: 'GADMobileAds', ad_impression_id: 'imp-9' },
    ]]);
    expect(forward).toHaveBeenCalledWith({ type: 'ad_revenue', revenue: 0.0012, currency: 'USD', format: 'rewarded', placement: 'rewarded', impressionId: 'imp-9' });
  });
});

describe('AnalyticsService.adLifecycle', () => {
  it('tracks ad_lifecycle with compacted params', async () => {
    const sdk = (analytics as unknown as { sdk: { track: (...args: unknown[]) => void } }).sdk;
    const spy = vi.spyOn(sdk, 'track');
    await analytics.adLifecycle({ ad_type: 'interstitial', placement: 'between_levels', stage: 'skipped', reason: 'frequency_cap', load_id: undefined });
    expect(spy).toHaveBeenCalledWith('ad_lifecycle', { ad_type: 'interstitial', placement: 'between_levels', stage: 'skipped', reason: 'frequency_cap' });
  });
});

describe('adService banner wrapper', () => {
  it('forwards every showBanner to the delegate so a native load failure can be retried', async () => {
    const results = [true, true];
    const delegate = {
      providerName: 'admob',
      init: async (): Promise<void> => {},
      preloadInterstitial: async (): Promise<void> => {},
      maybeShowInterstitial: async (): Promise<boolean> => false,
      showBanner: vi.fn(async (): Promise<boolean> => results.shift() ?? false),
      hideBanner: vi.fn(async (): Promise<void> => {}),
      preloadRewarded: async (): Promise<void> => {},
      showRewardedAd: async (): Promise<{ granted: boolean }> => ({ granted: false }),
    };
    configureAdService(delegate);
    await expect(adService.showBanner()).resolves.toBe(true);
    // Delegate saw an asynchronous native failure; the wrapper must not answer from a cache.
    await expect(adService.showBanner()).resolves.toBe(true);
    expect(delegate.showBanner).toHaveBeenCalledTimes(2);
    await adService.hideBanner();
    expect(delegate.hideBanner).toHaveBeenCalledTimes(1);
  });
});
