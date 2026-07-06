import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The AdMob adapter statically imports these plugin enums as values, and
// showBanner dynamically imports the size/position enums. The native seam
// itself is injected as a fake, so the real plugin is never reached; this mock
// only satisfies the enum imports.
vi.mock('@capacitor-community/admob', () => ({
  BannerAdPluginEvents: { Loaded: 'bannerLoaded', FailedToLoad: 'bannerFailed', AdImpression: 'bannerImpression' },
  InterstitialAdPluginEvents: { FailedToLoad: 'intFailed', Dismissed: 'intDismissed', FailedToShow: 'intFailedShow' },
  RewardAdPluginEvents: { FailedToLoad: 'rewFailed', Dismissed: 'rewDismissed', FailedToShow: 'rewFailedShow' },
  MaxAdContentRating: { General: 'General' },
  BannerAdSize: { ADAPTIVE_BANNER: 'ADAPTIVE_BANNER' },
  BannerAdPosition: { BOTTOM_CENTER: 'BOTTOM_CENTER' },
  AdMob: {},
}));

import { InterstitialAdPluginEvents, RewardAdPluginEvents } from '@capacitor-community/admob';
import { AdMobProvider, type AdMobAdapter } from './AdMobProvider.ts';
import type { AdConfig } from './AdMobConfig.ts';

const config: AdConfig = {
  enabled: true,
  isTesting: true,
  androidInterstitialAdUnitId: 'a-int',
  iosInterstitialAdUnitId: 'i-int',
  androidBannerAdUnitId: 'a-ban',
  iosBannerAdUnitId: 'i-ban',
  androidRewardedAdUnitId: 'a-rew',
  iosRewardedAdUnitId: 'i-rew',
  testingDevices: [],
};

type FakeAdapter = AdMobAdapter & { __emit: (event: string, info?: unknown) => void };

const makeAdapter = (overrides: Partial<AdMobAdapter> = {}): FakeAdapter => {
  const listeners = new Map<string, Set<(info: unknown) => void>>();
  const emit = (event: string, info?: unknown): void => {
    listeners.get(event)?.forEach((fn): void => fn(info));
  };
  const base: AdMobAdapter = {
    isNativePlatform: vi.fn(async (): Promise<boolean> => true),
    getPlatform: vi.fn(async (): Promise<'android' | 'ios' | 'web'> => 'android'),
    initialize: vi.fn(async (): Promise<void> => {}),
    prepareInterstitial: vi.fn(async (): Promise<void> => {}),
    showInterstitial: vi.fn(async (): Promise<void> => {
      emit(InterstitialAdPluginEvents.Dismissed);
    }),
    showBanner: vi.fn(async (): Promise<void> => {}),
    hideBanner: vi.fn(async (): Promise<void> => {}),
    prepareRewardVideoAd: vi.fn(async (): Promise<void> => {}),
    showRewardVideoAd: vi.fn(async () => {
      emit(RewardAdPluginEvents.Dismissed);
      return { type: 'coins', amount: 1 };
    }),
    addListener: vi.fn(async (eventName, listenerFunc) => {
      const key = String(eventName);
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listenerFunc as (info: unknown) => void);
      return {
        remove: async (): Promise<void> => {
          set?.delete(listenerFunc as (info: unknown) => void);
        },
      };
    }),
  };
  return { ...base, ...overrides, __emit: emit } as FakeAdapter;
};

let clock = 500_000;
const now = (): number => clock;

beforeEach(() => {
  clock = 500_000;
  vi.spyOn(console, 'info').mockImplementation((): void => {});
  vi.spyOn(console, 'warn').mockImplementation((): void => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdMobProvider lifecycle', (): void => {
  it('initializes exactly once across repeated init() calls', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now });

    await provider.init();
    await provider.init();

    expect(adapter.initialize).toHaveBeenCalledTimes(1);
  });

  it('stays uninitialized when the native init throws (swallowed)', async (): Promise<void> => {
    const adapter = makeAdapter({
      initialize: vi.fn(async (): Promise<void> => {
        throw new Error('init boom');
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now });

    await provider.init();
    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
  });

  it('skips init on a non-native platform', async (): Promise<void> => {
    const adapter = makeAdapter({ isNativePlatform: vi.fn(async (): Promise<boolean> => false) });
    const provider = new AdMobProvider(config, { adapter, now });

    await provider.init();
    expect(await provider.maybeShowInterstitial()).toBe(false);
    // init bails at the native-platform check before ever calling initialize
    expect(adapter.initialize).not.toHaveBeenCalled();
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
  });

  it('preloads on demand then shows a loaded interstitial', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now });
    await provider.init();

    // not preloaded → maybeShow preloads then shows (core AdService behavior)
    const shown = await provider.maybeShowInterstitial();

    expect(shown).toBe(true);
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);
  });

  it('returns false when the preload fails', async (): Promise<void> => {
    const adapter = makeAdapter({
      prepareInterstitial: vi.fn(async (): Promise<void> => {
        throw new Error('load boom');
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now });
    await provider.init();

    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
  });

  it('enforces the time cap via the injected clock', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now });
    await provider.preloadInterstitial();

    expect(await provider.maybeShowInterstitial()).toBe(true); // t=500_000
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);

    clock += 1_000; // within the 120s cap
    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);

    clock += 120_000; // past the cap
    expect(await provider.maybeShowInterstitial()).toBe(true);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(2);
  });

  it('grants the reward when the video completes (amount > 0)', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now });

    expect(await provider.showRewardedAd()).toEqual({ granted: true });
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
  });

  it('does not grant when the rewarded show throws', async (): Promise<void> => {
    const adapter = makeAdapter({
      showRewardVideoAd: vi.fn(async () => {
        throw new Error('cancelled');
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now });

    expect(await provider.showRewardedAd()).toEqual({ granted: false });
  });

  it('does not grant when the reward amount is zero', async (): Promise<void> => {
    const adapter = makeAdapter({
      showRewardVideoAd: vi.fn(async () => {
        adapter.__emit(RewardAdPluginEvents.Dismissed);
        return { type: 'coins', amount: 0 };
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now });

    expect(await provider.showRewardedAd()).toEqual({ granted: false });
  });

  it('fires the full-screen lifecycle hooks and waits for dismissal', async (): Promise<void> => {
    const onFullScreenAdStarted = vi.fn();
    const onFullScreenAdFinished = vi.fn();
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, {
      adapter,
      now,
      lifecycle: { onFullScreenAdStarted, onFullScreenAdFinished },
    });
    await provider.preloadInterstitial();

    await provider.maybeShowInterstitial();

    expect(onFullScreenAdStarted).toHaveBeenCalledWith('interstitial');
    expect(onFullScreenAdFinished).toHaveBeenCalledTimes(1);
  });

  it('shows and hides a banner, tracking visibility via load events', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now });

    expect(await provider.showBanner()).toBe(true);
    expect(adapter.showBanner).toHaveBeenCalledTimes(1);

    adapter.__emit('bannerLoaded'); // BannerAdPluginEvents.Loaded → bannerVisible = true
    await provider.hideBanner();
    expect(adapter.hideBanner).toHaveBeenCalledTimes(1);
  });
});
