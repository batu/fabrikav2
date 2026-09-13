import { afterEach, describe, expect, it, vi } from 'vitest';
import { adService, configureAdService, showRewardedAdForEconomy } from '../../src/ads/Service';
import { DisabledAdProvider } from '../../src/ads/DisabledAdProvider';
import { configureSessionAds } from '../../src/ads/sessionAdPolicy';

afterEach(() => {
  configureSessionAds(true, 'durable');
  configureAdService(new DisabledAdProvider('test finished'));
});

function provider() {
  return {
    providerName: 'test', enabled: true,
    init: vi.fn(async () => {}),
    preloadInterstitial: vi.fn(async () => {}),
    maybeShowInterstitial: vi.fn(async () => true),
    showBanner: vi.fn(async () => true),
    hideBanner: vi.fn(async () => {}),
    preloadRewarded: vi.fn(async () => {}),
    showRewardedAd: vi.fn(async () => ({ granted: true })),
  };
}

describe('first-install session ad policy', () => {
  it('blocks automatic ads at the native boundary while preserving optional rewards', async () => {
    const native = provider();
    configureAdService(native);
    configureSessionAds(false, 'durable');
    await adService.init();
    await adService.preloadInterstitial();
    expect(await adService.showBanner()).toBe(false);
    expect(await adService.maybeShowInterstitial({ minIntervalMs: 0 })).toBe(false);
    await adService.preloadRewarded();
    expect(await showRewardedAdForEconomy()).toEqual({ granted: true });
    expect(native.showBanner).not.toHaveBeenCalled();
    expect(native.preloadInterstitial).not.toHaveBeenCalled();
    expect(native.maybeShowInterstitial).not.toHaveBeenCalled();
    expect(native.init).toHaveBeenCalledOnce();
    expect(native.preloadRewarded).toHaveBeenCalledOnce();
    expect(native.showRewardedAd).toHaveBeenCalledOnce();
  });

  it('keeps normal banner and interstitial eligibility on later launches', async () => {
    const native = provider();
    configureAdService(native);
    configureSessionAds(true, 'durable');
    await adService.preloadInterstitial();
    expect(await adService.showBanner()).toBe(true);
    expect(await adService.maybeShowInterstitial({ minIntervalMs: 0 })).toBe(true);
    expect(native.preloadInterstitial).toHaveBeenCalledOnce();
    expect(native.maybeShowInterstitial).toHaveBeenCalledWith({ minIntervalMs: 0 });
  });

  it('does not enable automatic ads when install history cannot be persisted', async () => {
    const native = provider();
    configureAdService(native);
    configureSessionAds(true, 'volatile');
    expect(await adService.showBanner()).toBe(false);
    expect(await adService.maybeShowInterstitial()).toBe(false);
    expect(await showRewardedAdForEconomy()).toEqual({ granted: true });
  });
});
