import { afterEach, describe, expect, it, vi } from 'vitest';
import { analytics } from '../../src/analytics/AnalyticsService';
import { adService } from '../../src/ads/Service';
import { AppLovinMaxProvider } from '../../src/ads/AppLovinMaxProvider';
import type { AppLovinMaxPlugin } from '../../src/ads/AppLovinMaxPlugin';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ad_show_failed owned event', () => {
  it('AnalyticsService.adShowFailed emits with ad_type/placement/reason', async () => {
    const sdk = (analytics as unknown as { sdk: { track: (...args: unknown[]) => void } }).sdk;
    const spy = vi.spyOn(sdk, 'track');
    await analytics.adShowFailed({ ad_type: 'banner', placement: 'gameplay', reason: 'not_shown' });
    expect(spy).toHaveBeenCalledWith('ad_show_failed', {
      ad_type: 'banner',
      placement: 'gameplay',
      reason: 'not_shown',
    });
  });

  it('the disabled provider reports enabled=false so callers skip failure counting', () => {
    expect(adService.enabled).toBe(false);
  });
});

describe('persistent banner semantics (AppLovinMaxProvider)', () => {
  function makeProvider(showResults: boolean[]): { provider: AppLovinMaxProvider; showCalls: () => number } {
    let calls = 0;
    const plugin = {
      initialize: vi.fn(async () => ({ initialized: true })),
      showBanner: vi.fn(async () => ({ shown: showResults[Math.min(calls++, showResults.length - 1)] })),
      hideBanner: vi.fn(async () => undefined),
      preloadInterstitial: vi.fn(async () => ({ loaded: false })),
      showInterstitial: vi.fn(async () => ({ shown: false })),
      preloadRewarded: vi.fn(async () => ({ loaded: false })),
      showRewarded: vi.fn(async () => ({ granted: false })),
    } as unknown as AppLovinMaxPlugin;
    const provider = new AppLovinMaxProvider(
      {
        platform: 'ios',
        sdkKey: 'k',
        adUnitIds: { banner: 'b', interstitial: 'i', rewarded: 'r' },
        verboseLogging: false,
        privacy: { generalAudienceOnly: true, hasUserConsent: false, doNotSell: true },
        consentFlow: { enabled: false, privacyPolicyUrl: 'https://example.com/privacy', termsOfServiceUrl: 'https://example.com/terms', showTermsAndPrivacyPolicyAlertInGdpr: false },
      },
      { plugin },
    );
    return { provider, showCalls: () => calls };
  }

  it('a second showBanner while visible returns true without a native re-show', async () => {
    const { provider, showCalls } = makeProvider([true]);
    expect(await provider.showBanner()).toBe(true);
    expect(await provider.showBanner()).toBe(true); // persistent: still shown
    expect(showCalls()).toBe(1);
  });

  it('a no-fill show returns false and a later retry is allowed', async () => {
    const { provider, showCalls } = makeProvider([false, true]);
    expect(await provider.showBanner()).toBe(false);
    expect(await provider.showBanner()).toBe(true);
    expect(showCalls()).toBe(2);
  });
});
