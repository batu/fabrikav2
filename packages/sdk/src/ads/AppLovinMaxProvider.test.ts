import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AppLovinMaxPlugin.ts calls registerPlugin at module load; the provider only
// uses the real plugin as a fallback (we always inject a fake), but the import
// must still resolve at runtime.
vi.mock('@capacitor/core', () => ({
  registerPlugin: (): unknown => ({}),
}));

import { AppLovinMaxProvider } from './AppLovinMaxProvider.ts';
import type { AppLovinMaxPlugin } from './AppLovinMaxPlugin.ts';
import type { AppLovinConfig } from './AppLovinConfig.ts';
import { TimeoutError } from './withTimeout.ts';

const config: AppLovinConfig = {
  platform: 'ios',
  sdkKey: 'sdk-key-abcdef',
  adUnitIds: { banner: 'b', interstitial: 'i', rewarded: 'r' },
  verboseLogging: false,
  privacy: { generalAudienceOnly: true, hasUserConsent: true, doNotSell: false },
  consentFlow: { enabled: true, privacyPolicyUrl: '', termsOfServiceUrl: '', showTermsAndPrivacyPolicyAlertInGdpr: true },
};

const silentLogger = { info: vi.fn(), warn: vi.fn() };

const makePlugin = (overrides: Partial<AppLovinMaxPlugin> = {}): AppLovinMaxPlugin => ({
  initialize: vi.fn(async () => ({ initialized: true })),
  showBanner: vi.fn(async () => ({ shown: true })),
  hideBanner: vi.fn(async () => {}),
  preloadInterstitial: vi.fn(async () => ({ loaded: true })),
  showInterstitial: vi.fn(async () => ({ shown: true })),
  preloadRewarded: vi.fn(async () => ({ loaded: true })),
  showRewarded: vi.fn(async () => ({ granted: true })),
  showPrivacyOptions: vi.fn(async () => ({ shown: true })),
  addListener: vi.fn(async () => ({ remove: async (): Promise<void> => {} })),
  ...overrides,
});

let clock = 500_000;
const now = (): number => clock;

beforeEach(() => {
  clock = 500_000;
  silentLogger.info.mockClear();
  silentLogger.warn.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('AppLovinMaxProvider lifecycle', (): void => {
  it('initializes exactly once across repeated init() calls', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });

    await provider.init();
    await provider.init();

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
  });

  it('permanently disables after a definitive (non-timeout) init failure', async (): Promise<void> => {
    const plugin = makePlugin({
      initialize: vi.fn(async () => {
        throw new Error('plugin exploded');
      }),
    });
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });

    await provider.init();
    await provider.init(); // must NOT retry — permanentlyDisabled

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(await provider.maybeShowInterstitial()).toBe(false);
  });

  it('does NOT permanently disable after a transient timeout init failure (retries)', async (): Promise<void> => {
    const plugin = makePlugin({
      initialize: vi.fn(async () => {
        throw new TimeoutError('AppLovin initialize', 10_000);
      }),
    });
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });

    await provider.init();
    await provider.init(); // re-attempts because a timeout is transient

    expect(plugin.initialize).toHaveBeenCalledTimes(2);
  });

  it('preload marks loaded=true; a failed preload leaves it false', async (): Promise<void> => {
    const plugin = makePlugin({
      preloadInterstitial: vi.fn(async () => ({ loaded: false })),
    });
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });

    await provider.preloadInterstitial();
    // not loaded → maybeShow returns false without calling showInterstitial
    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(plugin.showInterstitial).not.toHaveBeenCalled();
  });

  it('not-loaded interstitial resolves false fast and kicks a background preload', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });
    await provider.init();

    const shown = await provider.maybeShowInterstitial();

    expect(shown).toBe(false);
    expect(plugin.showInterstitial).not.toHaveBeenCalled();
    expect(plugin.preloadInterstitial).toHaveBeenCalled();
  });

  it('shows a loaded interstitial, records the timestamp, and re-arms', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });
    await provider.preloadInterstitial();

    const shown = await provider.maybeShowInterstitial();

    expect(shown).toBe(true);
    expect(plugin.showInterstitial).toHaveBeenCalledTimes(1);
    // re-arm preload fired in finally (initial preload + re-arm = 2)
    expect((plugin.preloadInterstitial as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('enforces the time cap via the injected clock', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });
    await provider.preloadInterstitial();

    expect(await provider.maybeShowInterstitial()).toBe(true); // first show at t=500_000
    expect(plugin.showInterstitial).toHaveBeenCalledTimes(1);

    clock += 1_000; // well within the 120s cap
    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(plugin.showInterstitial).toHaveBeenCalledTimes(1);

    clock += 120_000; // now past the cap
    // AppLovin only shows an ALREADY-loaded ad (unlike AdMob it won't await a
    // preload inline); ensure it's armed after the previous show consumed it.
    await provider.preloadInterstitial();
    expect(await provider.maybeShowInterstitial()).toBe(true);
    expect(plugin.showInterstitial).toHaveBeenCalledTimes(2);
  });

  it('grants the reward when the native result is granted', async (): Promise<void> => {
    const plugin = makePlugin({ showRewarded: vi.fn(async () => ({ granted: true })) });
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });

    expect(await provider.showRewardedAd()).toEqual({ granted: true });
  });

  it('does not grant when the rewarded show fails', async (): Promise<void> => {
    const plugin = makePlugin({
      showRewarded: vi.fn(async () => {
        throw new Error('user cancelled');
      }),
    });
    const provider = new AppLovinMaxProvider(config, { plugin, now, logger: silentLogger });

    expect(await provider.showRewardedAd()).toEqual({ granted: false });
  });

  it('fires the full-screen lifecycle start/finish hooks around a show', async (): Promise<void> => {
    const onFullScreenAdStarted = vi.fn();
    const onFullScreenAdFinished = vi.fn();
    const plugin = makePlugin();
    const provider = new AppLovinMaxProvider(config, {
      plugin,
      now,
      logger: silentLogger,
      lifecycle: { onFullScreenAdStarted, onFullScreenAdFinished },
    });
    await provider.preloadInterstitial();

    await provider.maybeShowInterstitial();

    expect(onFullScreenAdStarted).toHaveBeenCalledTimes(1);
    expect(onFullScreenAdStarted).toHaveBeenCalledWith('interstitial');
    expect(onFullScreenAdFinished).toHaveBeenCalledTimes(1);
  });
});
