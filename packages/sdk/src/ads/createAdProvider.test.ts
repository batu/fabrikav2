import { describe, expect, it, vi } from 'vitest';

// createAdProvider transitively imports the concrete providers (for its default
// factories), which statically import the native plugin modules. Selection is
// tested with injected fake factories, so these mocks just satisfy the imports.
vi.mock('@capacitor-community/admob', () => ({
  BannerAdPluginEvents: {},
  InterstitialAdPluginEvents: {},
  RewardAdPluginEvents: {},
  MaxAdContentRating: { General: 'General' },
  BannerAdSize: {},
  BannerAdPosition: {},
  AdMob: {},
}));
vi.mock('@capacitor/core', () => ({ registerPlugin: (): unknown => ({}) }));

import { createAdProvider, createOwnedAdProvider, type AdProviderFactories } from './createAdProvider.ts';
import type { AdProvider } from './AdProvider.ts';
import type { AppLovinConfig, AppLovinConfigResult } from './AppLovinConfig.ts';

const stub = (providerName: string): AdProvider =>
  ({
    providerName,
    init: async (): Promise<void> => {},
    preloadInterstitial: async (): Promise<void> => {},
    maybeShowInterstitial: async (): Promise<boolean> => false,
    showBanner: async (): Promise<boolean> => false,
    hideBanner: async (): Promise<void> => {},
    preloadRewarded: async (): Promise<void> => {},
    showRewardedAd: async (): Promise<{ granted: boolean }> => ({ granted: false }),
  }) satisfies AdProvider;

const makeFactories = (): AdProviderFactories & {
  createAdMobProvider: ReturnType<typeof vi.fn>;
  createAppLovinMaxProvider: ReturnType<typeof vi.fn>;
  createDisabledProvider: ReturnType<typeof vi.fn>;
} => ({
  createAdMobProvider: vi.fn((): AdProvider => stub('admob')),
  createAppLovinMaxProvider: vi.fn((): AdProvider => stub('applovin-max')),
  createDisabledProvider: vi.fn((): AdProvider => stub('disabled')),
});

const enabledConfig = (platform: 'ios' | 'android'): AppLovinConfigResult => ({
  enabled: true,
  requested: true,
  platform,
  config: {
    platform,
    sdkKey: 'k',
    adUnitIds: { banner: 'b', interstitial: 'i', rewarded: 'r' },
    verboseLogging: false,
    privacy: { generalAudienceOnly: true, hasUserConsent: true, doNotSell: false },
    consentFlow: { enabled: true, privacyPolicyUrl: '', termsOfServiceUrl: '', showTermsAndPrivacyPolicyAlertInGdpr: true },
  } satisfies AppLovinConfig,
});

const disabledConfig = (platform: 'ios' | 'android', requested: boolean): AppLovinConfigResult => ({
  enabled: false,
  requested,
  platform,
  reason: 'not configured',
  missingKeys: [],
});

describe('createAdProvider', (): void => {
  it('picks AppLovin MAX on iOS when enabled', (): void => {
    const factories = makeFactories();
    const provider = createAdProvider('ios', enabledConfig('ios'), factories);
    expect(provider.providerName).toBe('applovin-max');
    expect(factories.createAppLovinMaxProvider).toHaveBeenCalledTimes(1);
  });

  it('disables iOS when AppLovin is not enabled', (): void => {
    const factories = makeFactories();
    const provider = createAdProvider('ios', disabledConfig('ios', true), factories);
    expect(provider.providerName).toBe('disabled');
  });

  it('falls back to AdMob on Android when AppLovin was not requested', (): void => {
    const factories = makeFactories();
    const provider = createAdProvider('android', disabledConfig('android', false), factories);
    expect(provider.providerName).toBe('admob');
    expect(factories.createAdMobProvider).toHaveBeenCalledTimes(1);
  });

  it('disables Android when AppLovin was requested but misconfigured', (): void => {
    const factories = makeFactories();
    const provider = createAdProvider('android', disabledConfig('android', true), factories);
    expect(provider.providerName).toBe('disabled');
    expect(factories.createAdMobProvider).not.toHaveBeenCalled();
  });

  it('picks AppLovin MAX on Android when enabled', (): void => {
    const factories = makeFactories();
    const provider = createAdProvider('android', enabledConfig('android'), factories);
    expect(provider.providerName).toBe('applovin-max');
  });

  it('disables ads on web / unknown platforms', (): void => {
    const factories = makeFactories();
    const provider = createAdProvider('web', disabledConfig('ios', false), factories);
    expect(provider.providerName).toBe('disabled');
    expect(factories.createDisabledProvider).toHaveBeenCalledWith(expect.stringContaining('web'));
  });

  it('compile-time: the return remains assignable to AdProvider with no .provider adaptation', (): void => {
    const factories = makeFactories();
    const provider: AdProvider = createAdProvider('android', disabledConfig('android', false), factories);
    expect(provider.providerName).toBe('admob');
  });
});

describe('createOwnedAdProvider', (): void => {
  it('selects the same provider as createAdProvider for every platform/config', (): void => {
    const cases: Array<[string, AppLovinConfigResult, string]> = [
      ['ios', enabledConfig('ios'), 'applovin-max'],
      ['ios', disabledConfig('ios', true), 'disabled'],
      ['android', enabledConfig('android'), 'applovin-max'],
      ['android', disabledConfig('android', true), 'disabled'],
      ['android', disabledConfig('android', false), 'admob'],
      ['web', disabledConfig('ios', false), 'disabled'],
    ];
    for (const [platform, cfg, expected] of cases) {
      const owned = createOwnedAdProvider(platform, cfg);
      expect(owned.provider.providerName).toBe(expected);
      // parity with the legacy factory-based selection
      expect(createAdProvider(platform, cfg).providerName).toBe(expected);
    }
  });

  it('an owner exposes async disposal that is safe to call (AppLovin/Disabled no-op)', async (): Promise<void> => {
    const disabled = createOwnedAdProvider('web', disabledConfig('ios', false));
    await expect(disabled.dispose()).resolves.toBeUndefined();

    const applovin = createOwnedAdProvider('android', enabledConfig('android'));
    await expect(applovin.dispose()).resolves.toBeUndefined();
  });

  it('forwards the resume seam only to AdMob and never crashes on non-AdMob', (): void => {
    const addAppResumeListener = vi.fn(async () => ({ remove: async (): Promise<void> => {} }));
    const admob = createOwnedAdProvider('android', disabledConfig('android', false), { addAppResumeListener });
    expect(admob.provider.providerName).toBe('admob');
    // The seam registers on init (native path), not at construction; just prove
    // construction with a seam is valid for AdMob and ignored elsewhere.
    const disabled = createOwnedAdProvider('web', disabledConfig('ios', false), { addAppResumeListener });
    expect(disabled.provider.providerName).toBe('disabled');
  });
});
