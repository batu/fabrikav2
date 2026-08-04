import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdProvider } from './AdProvider';
import { configureAdService, initializeAdsForGameplay } from './Service';

function provider(): AdProvider {
  return {
    providerName: 'test',
    init: vi.fn(async () => {}),
    preloadInterstitial: vi.fn(async () => {}),
    maybeShowInterstitial: vi.fn(async () => false),
    showBanner: vi.fn(async () => false),
    hideBanner: vi.fn(async () => {}),
    preloadRewarded: vi.fn(async () => {}),
    showRewardedAd: vi.fn(async () => ({ granted: false })),
  };
}

describe('initializeAdsForGameplay', () => {
  let ads: AdProvider;

  beforeEach(() => {
    ads = provider();
    configureAdService(ads);
  });

  it('preloads the first interstitial after provider initialization', async () => {
    await initializeAdsForGameplay();

    expect(ads.init).toHaveBeenCalledOnce();
    expect(ads.preloadInterstitial).toHaveBeenCalledOnce();
    expect(vi.mocked(ads.init).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(ads.preloadInterstitial).mock.invocationCallOrder[0]);
  });
});
