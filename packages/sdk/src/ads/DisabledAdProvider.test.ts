import { describe, expect, it, vi } from 'vitest';
import { DisabledAdProvider } from './DisabledAdProvider.ts';

describe('DisabledAdProvider', (): void => {
  it('no-ops every method and never grants a reward', async (): Promise<void> => {
    const provider = new DisabledAdProvider('web platform');

    await expect(provider.init()).resolves.toBeUndefined();
    await expect(provider.preloadInterstitial()).resolves.toBeUndefined();
    await expect(provider.maybeShowInterstitial()).resolves.toBe(false);
    await expect(provider.showBanner()).resolves.toBe(false);
    await expect(provider.hideBanner()).resolves.toBeUndefined();
    await expect(provider.preloadRewarded()).resolves.toBeUndefined();
    await expect(provider.showRewardedAd()).resolves.toEqual({ granted: false });
    await expect(provider.showPrivacyOptions()).resolves.toBe(false);
    expect(provider.providerName).toBe('disabled');
  });

  it('logs its reason at most once', async (): Promise<void> => {
    const info = vi.spyOn(console, 'info').mockImplementation((): void => {});
    const provider = new DisabledAdProvider('ads off');

    await provider.init();
    await provider.maybeShowInterstitial();
    await provider.showRewardedAd();

    const adLogs = info.mock.calls.filter((call): boolean => String(call[0]).includes('[ads:disabled]'));
    expect(adLogs).toHaveLength(1);
    info.mockRestore();
  });
});
