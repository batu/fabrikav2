import { afterEach, describe, expect, it, vi } from 'vitest';
import { AD_PROTECTION_STORAGE_KEY, adExperimentParams, configureAdProgression, configureSessionAds } from '../../src/ads/sessionAdPolicy';
import { adService, configureAdService } from '../../src/ads/Service';
import { DisabledAdProvider } from '../../src/ads/DisabledAdProvider';

function storage(variant?: string) {
  const data = new Map<string, string>(variant ? [[AD_PROTECTION_STORAGE_KEY, variant]] : []);
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
function native() {
  const provider = {
    providerName: 'test', enabled: true,
    init: vi.fn(async () => {}), preloadInterstitial: vi.fn(async () => {}),
    maybeShowInterstitial: vi.fn(async () => true), showBanner: vi.fn(async () => true),
    hideBanner: vi.fn(async () => {}), preloadRewarded: vi.fn(async () => {}),
    showRewardedAd: vi.fn(async () => ({ granted: true })),
  };
  configureAdService(provider);
  return provider;
}
afterEach(() => {
  vi.restoreAllMocks();
  configureSessionAds(true, 'durable');
  configureAdProgression(() => 1);
  configureAdService(new DisabledAdProvider('test finished'));
});

describe('ad protection experiment through the ad service', () => {
  it.each([1, 10, 11, 25])('blocks the entire first session even at level %i; rewards work', async (level) => {
    const provider = native();
    configureSessionAds(false, 'durable', storage('protected'));
    configureAdProgression(() => level);
    expect(await adService.showBanner()).toBe(false);
    expect(await adService.maybeShowInterstitial()).toBe(false);
    expect(await adService.showRewardedAd()).toEqual({ granted: true });
    expect(provider.showBanner).not.toHaveBeenCalled();
    expect(provider.maybeShowInterstitial).not.toHaveBeenCalled();
  });
  it('keeps protection across relaunches through level 10, allowing ads at 11', async () => {
    native();
    const saved = storage('protected');
    configureSessionAds(true, 'durable', saved);
    let level = 1;
    configureAdProgression(() => level);
    expect(await adService.showBanner()).toBe(false);
    level = 10;
    expect(await adService.maybeShowInterstitial()).toBe(false);
    level = 11;
    expect(await adService.showBanner()).toBe(true);
    expect(await adService.maybeShowInterstitial()).toBe(true);
  });
  it('permits automatic ad calls from the first level in the from-start arm', async () => {
    native();
    configureSessionAds(false, 'durable', storage('from_start'));
    expect(await adService.showBanner()).toBe(true);
    expect(await adService.maybeShowInterstitial()).toBe(true);
    expect(await adService.showRewardedAd()).toEqual({ granted: true });
  });
  it.each([0, 0x7fffffff, 0x80000000, 0xffffffff])('uses a 50/50 boundary and persists draw %i', (draw) => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint32Array)[0] = draw;
      return array;
    });
    const saved = storage();
    configureSessionAds(false, 'durable', saved);
    const expected = draw < 0x80000000 ? 'protected' : 'from_start';
    expect(adExperimentParams().ad_experiment_variant).toBe(expected);
    configureSessionAds(true, 'durable', saved);
    expect(adExperimentParams().ad_experiment_variant).toBe(expected);
    expect(random).toHaveBeenCalledOnce();
  });
  it('excludes existing installs rather than enrolling upgraded users', () => {
    const saved = storage();
    configureSessionAds(true, 'durable', saved);
    expect(saved.getItem(AD_PROTECTION_STORAGE_KEY)).toBe('existing');
    expect(adExperimentParams()).toEqual({});
  });
  it.each(['corrupt', 'volatile', 'write-failed'])('fails closed without misleading assignment telemetry: %s', async (failure) => {
    native();
    const saved = failure === 'write-failed' ? { getItem: () => null, setItem: () => {} } : storage('corrupt');
    configureSessionAds(true, failure === 'volatile' ? 'volatile' : 'durable', saved);
    expect(await adService.showBanner()).toBe(false);
    expect(await adService.maybeShowInterstitial()).toBe(false);
    expect(await adService.showRewardedAd()).toEqual({ granted: true });
    expect(adExperimentParams()).toEqual({});
  });
});
