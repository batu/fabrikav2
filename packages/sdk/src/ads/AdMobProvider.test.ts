import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The AdMob adapter statically imports these plugin enums as values, and
// showBanner dynamically imports the size/position enums. The native seam
// itself is injected as a fake, so the real plugin is never reached; this mock
// only satisfies the enum imports.
vi.mock('@capacitor-community/admob', () => ({
  BannerAdPluginEvents: { Loaded: 'bannerLoaded', FailedToLoad: 'bannerFailed', AdImpression: 'bannerImpression', AdPaid: 'bannerAdPaid' },
  InterstitialAdPluginEvents: { FailedToLoad: 'intFailed', Dismissed: 'intDismissed', FailedToShow: 'intFailedShow', AdImpression: 'intPaid' },
  RewardAdPluginEvents: { FailedToLoad: 'rewFailed', Dismissed: 'rewDismissed', FailedToShow: 'rewFailedShow', Rewarded: 'rewRewarded', AdImpression: 'rewPaid' },
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
    requestConsentInfo: vi.fn(async () => ({ status: 'OBTAINED' as never, canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' as never })),
    showConsentForm: vi.fn(async () => ({ status: 'OBTAINED' as never, canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' as never })),
    showPrivacyOptionsForm: vi.fn(async (): Promise<void> => {}),
    prepareInterstitial: vi.fn(async (): Promise<void> => {}),
    showInterstitial: vi.fn(async (): Promise<void> => {
      emit(InterstitialAdPluginEvents.Dismissed);
    }),
    showBanner: vi.fn(async (): Promise<void> => {}),
    hideBanner: vi.fn(async (): Promise<void> => {}),
    prepareRewardVideoAd: vi.fn(async (): Promise<void> => {}),
    showRewardVideoAd: vi.fn(async () => {
      emit(RewardAdPluginEvents.Rewarded, { type: 'coins', amount: 1 });
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

// Deterministic backoff scheduler (no fake timers, matching the file's inject
// convention): captured retries fire only when a test invokes them, so a load
// failure never schedules a runaway real setTimeout.
interface ScheduledRetry {
  fn: () => void;
  delay: number;
  cancelled: boolean;
}
let scheduledRetries: ScheduledRetry[] = [];
const scheduleRetry = (fn: () => void, delay: number): (() => void) => {
  const entry: ScheduledRetry = { fn, delay, cancelled: false };
  scheduledRetries.push(entry);
  return (): void => {
    entry.cancelled = true;
  };
};
/** Drain pending microtasks so a `void`-fired background preload/re-arm settles. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
/** Fire the most recently scheduled, not-yet-cancelled retry. */
const flushRetry = async (): Promise<void> => {
  const entry = [...scheduledRetries].reverse().find((e) => !e.cancelled);
  if (entry) {
    entry.cancelled = true;
    entry.fn();
    await Promise.resolve();
  }
};

beforeEach(() => {
  clock = 500_000;
  scheduledRetries = [];
  vi.spyOn(console, 'info').mockImplementation((): void => {});
  vi.spyOn(console, 'warn').mockImplementation((): void => {});
});

describe('UMP consent', () => {
  it('presents a required form before initializing and exposes privacy options', async () => {
    const adapter = makeAdapter({
      requestConsentInfo: vi.fn(async () => ({ status: 'REQUIRED' as never, isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' as never })),
      showConsentForm: vi.fn(async () => ({ status: 'OBTAINED' as never, canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' as never })),
    });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry });
    await provider.init();
    expect(adapter.showConsentForm).toHaveBeenCalledOnce();
    expect(adapter.initialize).toHaveBeenCalledOnce();
    await expect(provider.showPrivacyOptions()).resolves.toBe(true);
    expect(adapter.showPrivacyOptionsForm).toHaveBeenCalledOnce();
  });

  it('does not initialize when UMP still forbids ad requests', async () => {
    const adapter = makeAdapter({ requestConsentInfo: vi.fn(async () => ({ status: 'REQUIRED' as never, isConsentFormAvailable: false, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' as never })) });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry });
    await provider.init();
    expect(adapter.initialize).not.toHaveBeenCalled();
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AdMobProvider rewarded native terminal contract', () => {
  it.each([RewardAdPluginEvents.Dismissed, RewardAdPluginEvents.FailedToShow])(
    'settles without reward on %s even when the native show promise stays pending, then allows the next ad',
    async (terminal) => {
      const finish = vi.fn();
      const adapter = makeAdapter({ showRewardVideoAd: vi.fn(() => new Promise<never>(() => {})) });
      const provider = new AdMobProvider(config, { adapter, scheduleRetry, lifecycle: { onFullScreenAdFinished: finish } });
      await provider.preloadRewarded();
      let result: { granted: boolean } | null = null;
      void provider.showRewardedAd().then((value) => { result = value; });
      await flush();
      expect(adapter.showRewardVideoAd).toHaveBeenCalledOnce();
      adapter.__emit(terminal);
      await flush();
      expect(result).toEqual({ granted: false });
      expect(finish).toHaveBeenCalledOnce();
      expect(await provider.maybeShowInterstitial()).toBe(true);
      await provider.dispose();
    },
  );

  it('observes earned reward before dismissal independently of native promise completion', async () => {
    const adapter = makeAdapter({ showRewardVideoAd: vi.fn(() => new Promise<never>(() => {})) });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry });
    await provider.preloadRewarded();
    let result: { granted: boolean } | null = null;
    void provider.showRewardedAd().then((value) => { result = value; });
    await flush();
    adapter.__emit(RewardAdPluginEvents.Rewarded, { type: 'coins', amount: 1 });
    await flush();
    expect(result).toBeNull();
    adapter.__emit(RewardAdPluginEvents.Dismissed);
    await flush();
    expect(result).toEqual({ granted: true });
    await provider.dispose();
  });

  it('never resumes an earned reward before the real dismissal, including after 30 seconds', async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter({ showRewardVideoAd: vi.fn(async () => ({ type: 'coins', amount: 1 })) });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry });
    await provider.preloadRewarded();
    let result: { granted: boolean } | null = null;
    void provider.showRewardedAd().then((value) => { result = value; });
    await flush();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(result).toBeNull();
    adapter.__emit(RewardAdPluginEvents.Dismissed);
    await flush();
    expect(result).toEqual({ granted: true });
    await provider.dispose();
  });

  it('holds exclusive fullscreen ownership across rewarded presentation and ignores late reward after dismissal', async () => {
    let resolveNative!: (reward: { type: string; amount: number }) => void;
    const adapter = makeAdapter({ showRewardVideoAd: vi.fn(() => new Promise<{ type: string; amount: number }>((resolve) => { resolveNative = resolve; })) });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry });
    await provider.preloadRewarded();
    let first: { granted: boolean } | null = null;
    let second: { granted: boolean } | null = null;
    void provider.showRewardedAd().then((value) => { first = value; });
    await flush();
    void provider.showRewardedAd().then((value) => { second = value; });
    await flush();
    expect(second).toEqual({ granted: false });
    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(adapter.showRewardVideoAd).toHaveBeenCalledOnce();
    adapter.__emit(RewardAdPluginEvents.Dismissed);
    await flush();
    expect(first).toEqual({ granted: false });
    resolveNative({ type: 'coins', amount: 1 });
    await flush();
    expect(first).toEqual({ granted: false });
    await provider.dispose();
  });

  it('disposal settles an active rewarded show once without waiting for the native promise', async () => {
    const finish = vi.fn();
    const adapter = makeAdapter({ showRewardVideoAd: vi.fn(() => new Promise<never>(() => {})) });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry, lifecycle: { onFullScreenAdFinished: finish } });
    await provider.preloadRewarded();
    let result: { granted: boolean } | null = null;
    void provider.showRewardedAd().then((value) => { result = value; });
    await flush();
    await provider.dispose();
    await flush();
    expect(result).toEqual({ granted: false });
    expect(finish).toHaveBeenCalledOnce();
    expect(await provider.showRewardedAd()).toEqual({ granted: false });
  });

  it('cannot attribute an old native promise reward to a later fullscreen owner', async () => {
    const nativeRewards: ((reward: { type: string; amount: number }) => void)[] = [];
    const adapter = makeAdapter({
      showRewardVideoAd: vi.fn(() => new Promise<{ type: string; amount: number }>((resolve) => { nativeRewards.push(resolve); })),
    });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry });
    await provider.preloadRewarded();
    const first = provider.showRewardedAd();
    await flush();
    adapter.__emit(RewardAdPluginEvents.Dismissed);
    expect(await first).toEqual({ granted: false });
    await provider.preloadRewarded();
    const second = provider.showRewardedAd();
    await flush();
    expect(nativeRewards).toHaveLength(2);
    nativeRewards[0]({ type: 'coins', amount: 1 });
    await flush();
    adapter.__emit(RewardAdPluginEvents.Dismissed);
    expect(await second).toEqual({ granted: false });
    await provider.dispose();
  });

  it('disposal also releases a pending preload and prevents late native presentation', async () => {
    let releasePreload!: () => void;
    const adapter = makeAdapter({ prepareRewardVideoAd: vi.fn(() => new Promise<void>((resolve) => { releasePreload = resolve; })) });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry });
    await provider.init();
    let result: { granted: boolean } | null = null;
    void provider.showRewardedAd().then((value) => { result = value; });
    await flush();
    await provider.dispose();
    await flush();
    expect(result).toEqual({ granted: false });
    releasePreload();
    await flush();
    expect(adapter.showRewardVideoAd).not.toHaveBeenCalled();
  });

  it('requires every terminal listener and cleans up partial registration before allowing a retry', async () => {
    const adapter = makeAdapter();
    const addListener = adapter.addListener;
    const removed = vi.fn();
    let failRegistration = true;
    adapter.addListener = vi.fn(async (event, callback) => {
      if (event === RewardAdPluginEvents.FailedToShow && failRegistration) throw new Error('bridge listener failed');
      const handle = await addListener(event, callback);
      return { remove: async () => { removed(event); await handle.remove(); } };
    });
    const provider = new AdMobProvider(config, { adapter, scheduleRetry });
    expect(await provider.showRewardedAd()).toEqual({ granted: false });
    expect(adapter.showRewardVideoAd).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith(RewardAdPluginEvents.Rewarded);
    expect(removed).toHaveBeenCalledWith(RewardAdPluginEvents.Dismissed);
    failRegistration = false;
    expect(await provider.showRewardedAd()).toEqual({ granted: true });
    await provider.dispose();
  });

  it('finishes lifecycle and releases the gate even if listener removal rejects', async () => {
    const adapter = makeAdapter();
    const addListener = adapter.addListener;
    adapter.addListener = vi.fn(async (event, callback) => {
      const handle = await addListener(event, callback);
      return { remove: async () => { await handle.remove(); throw new Error('remove failed'); } };
    });
    const finish = vi.fn();
    const provider = new AdMobProvider(config, { adapter, scheduleRetry, lifecycle: { onFullScreenAdFinished: finish } });
    expect(await provider.showRewardedAd()).toEqual({ granted: true });
    expect(finish).toHaveBeenCalledOnce();
    expect(await provider.showRewardedAd()).toEqual({ granted: true });
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(2);
    await provider.dispose();
  });
});

describe('AdMobProvider lifecycle', (): void => {
  it.each([
    ['bannerAdPaid', 'banner', 5_000, 0.005],
    ['interstitialAdImpression', 'interstitial', 12_500, 0.0125],
    ['onRewardedVideoAdImpression', 'rewarded', 1_500_000, 1.5],
  ] as const)('preserves decimal revenue from corrected %s native micros', async (event, format, valueMicros, revenue) => {
    const adapter = makeAdapter();
    const paid = vi.fn();
    const provider = new AdMobProvider(config, { adapter, onAdRevenuePaid: paid });
    await provider.init();
    adapter.__emit(event, { valueMicros, currencyCode: 'USD', precision: 3, networkName: 'Google', impressionId: 'fractional-impression' });
    expect(paid).toHaveBeenCalledWith(expect.objectContaining({ revenue, currency: 'USD', format }));
    await provider.dispose();
  });

  it('forwards paid impressions with normalized required fields', async () => {
    const adapter = makeAdapter();
    const paid = vi.fn();
    const provider = new AdMobProvider(config, { adapter, onAdRevenuePaid: paid });
    await provider.init();
    adapter.__emit('bannerAdPaid', { valueMicros: 12500, currencyCode: 'USD', precision: 3, networkName: 'Google', impressionId: 'imp-1' });
    expect(paid).toHaveBeenCalledWith({ revenue: 0.0125, currency: 'USD', format: 'banner', placement: 'banner', impressionId: 'imp-1', precision: '3', networkName: 'Google' });
  });
  it('initializes exactly once across repeated init() calls', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

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
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    await provider.init();
    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
  });

  it('skips init on a non-native platform', async (): Promise<void> => {
    const adapter = makeAdapter({ isNativePlatform: vi.fn(async (): Promise<boolean> => false) });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    await provider.init();
    expect(await provider.maybeShowInterstitial()).toBe(false);
    // init bails at the native-platform check before ever calling initialize
    expect(adapter.initialize).not.toHaveBeenCalled();
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
  });

  it('ready-only: a not-preloaded maybeShow arms in the background and does not show', async (): Promise<void> => {
    const adapter = makeAdapter({ prepareInterstitial: vi.fn(async (): Promise<void> => {}) });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.init();
    await flush(); // let the prewarm settle, then reset to the not-loaded state
    provider['interstitialLoaded'] = false;
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockClear();

    // Hold prepareInterstitial pending so the not-loaded state persists across
    // the call, proving maybeShow never awaits the load.
    let releaseLoad: () => void = (): void => {};
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => (releaseLoad = resolve)),
    );

    const shown = await provider.maybeShowInterstitial();
    await flush(); // the arm is fire-and-forget; let it reach the native call

    expect(shown).toBe(false);
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1); // background arm
    expect(adapter.showInterstitial).not.toHaveBeenCalled(); // never shows on the not-ready path
    releaseLoad();
  });

  it('ready path: shows an already-loaded interstitial exactly once', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();

    const shown = await provider.maybeShowInterstitial();

    expect(shown).toBe(true);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);
  });

  it('concurrent-show guard: overlapping calls present at most once', async (): Promise<void> => {
    let releaseShow: () => void = (): void => {};
    const adapter = makeAdapter({
      showInterstitial: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseShow = (): void => {
              adapter.__emit(InterstitialAdPluginEvents.Dismissed);
              resolve();
            };
          }),
      ),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();

    const first = provider.maybeShowInterstitial();
    // Let the first call pass its guard and reach the pending native show.
    await flush();
    const second = await provider.maybeShowInterstitial({ minIntervalMs: 0 });

    expect(second).toBe(false);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);

    releaseShow();
    expect(await first).toBe(true);
  });

  it('no lifecycle hooks: a present still waits for Dismissed before resolving', async (): Promise<void> => {
    const adapter = makeAdapter({
      showInterstitial: vi.fn(async (): Promise<void> => {}), // resolves on present, no terminal event
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();

    let settled = false;
    const pending = provider.maybeShowInterstitial().then((v) => {
      settled = true;
      return v;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false); // guarded past present, waiting for terminal event

    adapter.__emit(InterstitialAdPluginEvents.Dismissed);
    expect(await pending).toBe(true);
  });

  it('does not present when a terminal listener cannot be registered', async (): Promise<void> => {
    let addCount = 0;
    const adapter = makeAdapter({
      addListener: vi.fn(async (eventName, listenerFunc) => {
        if (eventName === InterstitialAdPluginEvents.FailedToShow) {
          throw new Error('listener boom');
        }
        addCount += 1;
        void listenerFunc;
        return { remove: async (): Promise<void> => {} };
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();

    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
    void addCount;
  });

  it('returns false when the preload fails', async (): Promise<void> => {
    const adapter = makeAdapter({
      prepareInterstitial: vi.fn(async (): Promise<void> => {
        throw new Error('load boom');
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.init();

    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
  });

  it('enforces the time cap via the injected clock', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();

    expect(await provider.maybeShowInterstitial()).toBe(true); // t=500_000
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);

    await flush(); // let the background re-arm settle a fresh ready ad

    clock += 1_000; // within the 120s cap
    expect(await provider.maybeShowInterstitial()).toBe(false);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);

    clock += 120_000; // past the cap
    expect(await provider.maybeShowInterstitial()).toBe(true);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(2);
  });

  it('grants the reward when the video completes (amount > 0)', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    expect(await provider.showRewardedAd()).toEqual({ granted: true });
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
  });

  it('does not grant when the rewarded show throws', async (): Promise<void> => {
    const adapter = makeAdapter({
      showRewardVideoAd: vi.fn(async () => {
        throw new Error('cancelled');
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    expect(await provider.showRewardedAd()).toEqual({ granted: false });
  });

  it('does not grant when the reward amount is zero', async (): Promise<void> => {
    const adapter = makeAdapter({
      showRewardVideoAd: vi.fn(async () => {
        adapter.__emit(RewardAdPluginEvents.Dismissed);
        return { type: 'coins', amount: 0 };
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    expect(await provider.showRewardedAd()).toEqual({ granted: false });
  });

  it('fires the full-screen lifecycle hooks and waits for dismissal', async (): Promise<void> => {
    const onFullScreenAdStarted = vi.fn();
    const onFullScreenAdFinished = vi.fn();
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, {
      adapter,
      now,
      scheduleRetry,
      lifecycle: { onFullScreenAdStarted, onFullScreenAdFinished },
    });
    await provider.preloadInterstitial();

    await provider.maybeShowInterstitial();

    expect(onFullScreenAdStarted).toHaveBeenCalledWith('interstitial');
    expect(onFullScreenAdFinished).toHaveBeenCalledTimes(1);
  });

  it('shows and hides a banner, tracking visibility via load events', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    expect(await provider.showBanner()).toBe(true);
    expect(adapter.showBanner).toHaveBeenCalledTimes(1);

    adapter.__emit('bannerLoaded'); // BannerAdPluginEvents.Loaded → bannerVisible = true
    await provider.hideBanner();
    expect(adapter.hideBanner).toHaveBeenCalledTimes(1);
  });
});

describe('AdMobProvider interstitial re-arm (U2)', (): void => {
  it('re-arms exactly once after a successful show', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockClear();

    expect(await provider.maybeShowInterstitial()).toBe(true);
    await flush();
    // exactly one re-arm preload after the consumed show
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);

    // and the re-armed ad shows again past the frequency cap
    clock += 200_000;
    expect(await provider.maybeShowInterstitial()).toBe(true);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(2);
  });

  it('re-arms after a show failure', async (): Promise<void> => {
    const adapter = makeAdapter({
      showInterstitial: vi.fn(async (): Promise<void> => {
        throw new Error('show boom');
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockClear();

    expect(await provider.maybeShowInterstitial()).toBe(false);
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1); // re-armed
  });

  it('present alone is not terminal; Dismissed re-arms exactly once', async (): Promise<void> => {
    const adapter = makeAdapter({
      showInterstitial: vi.fn(async (): Promise<void> => {}), // resolves on present only
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockClear();

    const pending = provider.maybeShowInterstitial();
    await flush();
    expect(adapter.prepareInterstitial).not.toHaveBeenCalled(); // no re-arm on present

    adapter.__emit(InterstitialAdPluginEvents.Dismissed);
    expect(await pending).toBe(true);
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1); // exactly one re-arm
  });

  it('a rejecting listener remove() does not strand the show promise or re-arm', async (): Promise<void> => {
    const listeners = new Map<string, Set<(info: unknown) => void>>();
    const emit = (event: string): void => listeners.get(event)?.forEach((fn) => fn(undefined));
    const adapter = makeAdapter({
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
            throw new Error('remove boom');
          },
        };
      }),
      showInterstitial: vi.fn(async (): Promise<void> => {
        emit(InterstitialAdPluginEvents.Dismissed);
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadInterstitial();
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockClear();

    // must resolve true (not reject) despite remove() throwing, and still re-arm
    expect(await provider.maybeShowInterstitial()).toBe(true);
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
  });
});

describe('AdMobProvider prewarm (U3)', (): void => {
  it('prewarms an interstitial on init success', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    await provider.init();
    await flush();

    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
  });

  it('does not prewarm when init fails', async (): Promise<void> => {
    const adapter = makeAdapter({
      initialize: vi.fn(async (): Promise<void> => {
        throw new Error('init boom');
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    await provider.init();
    await flush();

    expect(adapter.prepareInterstitial).not.toHaveBeenCalled();
  });

  it('does not prewarm on a non-native platform', async (): Promise<void> => {
    const adapter = makeAdapter({ isNativePlatform: vi.fn(async (): Promise<boolean> => false) });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });

    await provider.init();
    await flush();

    expect(adapter.prepareInterstitial).not.toHaveBeenCalled();
  });
});

describe('AdMobProvider load backoff (U4)', (): void => {
  const failingAdapter = (): FakeAdapter =>
    makeAdapter({
      prepareInterstitial: vi.fn(async (): Promise<void> => {
        throw new Error('load boom');
      }),
    });

  it('schedules a bounded, doubling backoff up to three total attempts', async (): Promise<void> => {
    const adapter = failingAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.init();
    await provider.preloadInterstitial(); // dedups with prewarm; attempt #1

    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
    expect(scheduledRetries.filter((e) => !e.cancelled)).toHaveLength(1);
    expect(scheduledRetries[scheduledRetries.length - 1].delay).toBe(2_000);

    await flushRetry(); // attempt #2
    await provider.preloadInterstitial().catch(() => {});
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(2);
    const pending2 = scheduledRetries.filter((e) => !e.cancelled);
    expect(pending2).toHaveLength(1);
    expect(pending2[0].delay).toBe(4_000);

    await flushRetry(); // attempt #3 → budget exhausted
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(3);
    expect(scheduledRetries.filter((e) => !e.cancelled)).toHaveLength(0); // no fourth

    // explicit arms after exhaustion do not exceed three
    await provider.preloadInterstitial();
    await provider.maybeShowInterstitial({ minIntervalMs: 0 });
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(3);
  });

  it('a pending retry blocks explicit arms without stacking timers', async (): Promise<void> => {
    const adapter = failingAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.init(); // attempt #1 via prewarm

    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
    await provider.preloadInterstitial();
    await provider.maybeShowInterstitial({ minIntervalMs: 0 });
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1); // still blocked by pending retry
    expect(scheduledRetries.filter((e) => !e.cancelled)).toHaveLength(1);
  });

  it('load success resets the attempt budget', async (): Promise<void> => {
    let failNext = true;
    const adapter = makeAdapter({
      prepareInterstitial: vi.fn(async (): Promise<void> => {
        if (failNext) {
          failNext = false;
          throw new Error('load boom');
        }
      }),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.init(); // attempt #1 fails, schedules retry
    await flushRetry(); // attempt #2 succeeds → attempts reset to 0

    // a later failure schedules again at the base delay (streak reset)
    failNext = true;
    provider['interstitialLoaded'] = false;
    await provider.preloadInterstitial();
    const pending = scheduledRetries.filter((e) => !e.cancelled);
    expect(pending).toHaveLength(1);
    expect(pending[0].delay).toBe(2_000);
  });
});

describe('AdMobProvider app-resume re-arm (U5)', (): void => {
  const makeResumeSeam = (): {
    addAppResumeListener: (onResume: () => void) => Promise<{ remove: () => Promise<void> }>;
    fire: () => void;
    removed: () => boolean;
  } => {
    let handler: (() => void) | null = null;
    let removed = false;
    return {
      addAppResumeListener: async (onResume) => {
        handler = onResume;
        return { remove: async (): Promise<void> => { removed = true; } };
      },
      fire: (): void => handler?.(),
      removed: (): boolean => removed,
    };
  };

  it('resume re-arms a stale interstitial and never shows', async (): Promise<void> => {
    const seam = makeResumeSeam();
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, addAppResumeListener: seam.addAppResumeListener });
    await provider.init();
    await flush();
    provider['interstitialLoaded'] = false;
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockClear();

    seam.fire();
    await flush();

    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
  });

  it('resume is a no-op while already loaded', async (): Promise<void> => {
    const seam = makeResumeSeam();
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, addAppResumeListener: seam.addAppResumeListener });
    await provider.init();
    await flush();
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockClear();

    seam.fire();
    await flush();
    expect(adapter.prepareInterstitial).not.toHaveBeenCalled();
  });

  it('no crash and no registration when the seam is absent', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await expect(provider.init()).resolves.toBeUndefined();
  });
});

describe('AdMobProvider dispose (U6)', (): void => {
  it('removes every registered listener and cancels a pending retry', async (): Promise<void> => {
    const seam = { removed: false };
    const adapter = makeAdapter({
      prepareInterstitial: vi.fn(async (): Promise<void> => {
        throw new Error('load boom');
      }),
    });
    const provider = new AdMobProvider(config, {
      adapter,
      now,
      scheduleRetry,
      addAppResumeListener: async () => ({ remove: async (): Promise<void> => { seam.removed = true; } }),
    });
    await provider.init(); // registers 5 global + 1 resume listener; prewarm fails → pending retry
    const removeSpy = adapter.addListener as ReturnType<typeof vi.fn>;

    await provider.dispose();

    // pending retry cancelled
    expect(scheduledRetries.filter((e) => !e.cancelled)).toHaveLength(0);
    expect(seam.removed).toBe(true);
    void removeSpy;
  });

  it('is idempotent and inert to later resume / re-arm after dispose', async (): Promise<void> => {
    const handlerRef: { fn: (() => void) | null } = { fn: null };
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, {
      adapter,
      now,
      scheduleRetry,
      addAppResumeListener: async (onResume) => {
        handlerRef.fn = onResume;
        return { remove: async (): Promise<void> => {} };
      },
    });
    await provider.init();
    await flush();

    await provider.dispose();
    await provider.dispose(); // idempotent
    (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mockClear();

    handlerRef.fn?.();
    await flush();
    expect(adapter.prepareInterstitial).not.toHaveBeenCalled();
    expect(await provider.maybeShowInterstitial({ minIntervalMs: 0 })).toBe(false);
  });

  it('dispose during native preload keeps loaded state false', async (): Promise<void> => {
    let releaseLoad: () => void = (): void => {};
    const adapter = makeAdapter({
      prepareInterstitial: vi.fn(() => new Promise<void>((resolve) => (releaseLoad = resolve))),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.init(); // prewarm preload is pending

    await provider.dispose();
    releaseLoad(); // late success
    await flush();

    expect(await provider.maybeShowInterstitial({ minIntervalMs: 0 })).toBe(false);
  });

  it('dispose during terminal-listener registration prevents a late native show', async (): Promise<void> => {
    let releaseDismissedListener: (() => void) | undefined;
    const lateHandleRemove = vi.fn(async (): Promise<void> => {});
    const baseAdapter = makeAdapter();
    const addListener = baseAdapter.addListener as ReturnType<typeof vi.fn>;
    addListener.mockImplementation(async (eventName, listenerFunc) => {
      if (eventName === InterstitialAdPluginEvents.Dismissed) {
        await new Promise<void>((resolve) => {
          releaseDismissedListener = resolve;
        });
        return { remove: lateHandleRemove };
      }
      return { remove: async (): Promise<void> => { void listenerFunc; } };
    });
    const provider = new AdMobProvider(config, { adapter: baseAdapter, now, scheduleRetry });
    await provider.preloadInterstitial();

    const pendingShow = provider.maybeShowInterstitial({ minIntervalMs: 0 });
    await flush();
    await provider.dispose();
    releaseDismissedListener?.();

    await expect(pendingShow).resolves.toBe(false);
    expect(baseAdapter.showInterstitial).not.toHaveBeenCalled();
    expect(lateHandleRemove).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2026-09-08 Find The Dog monetization repair: cache lifetime, banner state,
// exhausted-retry recovery and the lifecycle telemetry seam.
// ---------------------------------------------------------------------------

type LifecycleEvent = { format: string; stage: string; reason?: string; loadId?: string; attempt?: number; cacheAgeMs?: number };
const HOUR = 60 * 60 * 1_000;

const makeResumeSeam = (): {
  addAppResumeListener: (onResume: () => void) => Promise<{ remove: () => Promise<void> }>;
  fire: () => void;
} => {
  let handler: (() => void) | null = null;
  return {
    addAppResumeListener: async (onResume) => {
      handler = onResume;
      return { remove: async (): Promise<void> => {} };
    },
    fire: (): void => handler?.(),
  };
};

describe('AdMobProvider rewarded cache reuse (P2)', (): void => {
  it('keeps a loaded rewarded ad across repeated preload calls until it is consumed', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.preloadRewarded();
    await provider.preloadRewarded();
    await Promise.all([provider.preloadRewarded(), provider.preloadRewarded()]);
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(1);

    // Consumption frees the slot; the next preload loads fresh inventory.
    await expect(provider.showRewardedAd()).resolves.toEqual({ granted: true });
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(1); // cached ad was shown, not re-prepared
    await provider.preloadRewarded();
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent rewarded preloads into a single native prepare', async (): Promise<void> => {
    let release: () => void = (): void => {};
    const adapter = makeAdapter({
      prepareRewardVideoAd: vi.fn(() => new Promise<void>((resolve) => { release = resolve; })),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    const first = provider.preloadRewarded();
    const second = provider.preloadRewarded();
    await flush();
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
  });

  it('reloads a rewarded ad older than one hour before presenting instead of showing stale inventory', async (): Promise<void> => {
    const adapter = makeAdapter();
    const events: LifecycleEvent[] = [];
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: (e) => events.push(e) });
    await provider.preloadRewarded();
    clock += HOUR + 1;
    await provider.preloadRewarded(); // expiry frees the slot and reloads
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.stage === 'expired')).toHaveLength(1);

    clock += HOUR + 1;
    await expect(provider.showRewardedAd()).resolves.toEqual({ granted: true });
    // Stale ad from the second load was replaced by a third load before show.
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(3);
    expect(adapter.showRewardVideoAd).toHaveBeenCalledTimes(1);
    const shown = events.find((e) => e.stage === 'show_requested');
    expect(shown?.cacheAgeMs).toBe(0);
  });

  it('a rewarded ad within its lifetime is reused with its cache age reported', async (): Promise<void> => {
    const adapter = makeAdapter();
    const events: LifecycleEvent[] = [];
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: (e) => events.push(e) });
    await provider.preloadRewarded();
    clock += 10 * 60 * 1_000;
    await expect(provider.showRewardedAd()).resolves.toEqual({ granted: true });
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.stage === 'show_requested')?.cacheAgeMs).toBe(10 * 60 * 1_000);
  });
});

describe('AdMobProvider interstitial cache lifetime (P2)', (): void => {
  it('never presents an interstitial older than one hour; it re-arms and reports expiry instead', async (): Promise<void> => {
    const adapter = makeAdapter();
    const events: LifecycleEvent[] = [];
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: (e) => events.push(e) });
    await provider.init();
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);

    clock += HOUR + 1;
    await expect(provider.maybeShowInterstitial()).resolves.toBe(false);
    await flush();
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.stage)).toContain('expired');
    expect(events.find((e) => e.stage === 'skipped')?.reason).toBe('not_loaded');

    // The replacement ad is fresh and shows at the next eligible gate.
    await expect(provider.maybeShowInterstitial()).resolves.toBe(true);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);
  });

  it('preload preserves a loaded, fresh interstitial', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.init();
    await flush();
    await provider.preloadInterstitial();
    await provider.preloadInterstitial();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
  });

  it('resume replaces an expired cached interstitial and keeps a fresh one', async (): Promise<void> => {
    const seam = makeResumeSeam();
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, addAppResumeListener: seam.addAppResumeListener });
    await provider.init();
    await flush();
    seam.fire();
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
    clock += HOUR + 1;
    seam.fire();
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(2);
    expect(adapter.showInterstitial).not.toHaveBeenCalled();
  });
});

describe('AdMobProvider interstitial recovery after exhausted retries (P2)', (): void => {
  it('three consecutive load failures stop loading; a foreground resume re-opens exactly one bounded budget', async (): Promise<void> => {
    const seam = makeResumeSeam();
    let failing = true;
    const adapter = makeAdapter({
      prepareInterstitial: vi.fn(async (): Promise<void> => {
        if (failing) throw new Error('no fill');
      }),
    });
    const events: LifecycleEvent[] = [];
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, addAppResumeListener: seam.addAppResumeListener, onAdEvent: (e) => events.push(e) });
    await provider.init();
    await flush();
    await flushRetry();
    await flush();
    await flushRetry();
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(3);
    expect(scheduledRetries.filter((r) => !r.cancelled)).toHaveLength(0);

    // Eligible gates while exhausted: no storm, no show, reason is explicit.
    clock += 200_000;
    await expect(provider.maybeShowInterstitial()).resolves.toBe(false);
    await expect(provider.maybeShowInterstitial()).resolves.toBe(false);
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => e.stage === 'skipped').map((e) => e.reason)).toEqual(['load_budget_exhausted', 'load_budget_exhausted']);

    // Connectivity restored + foreground resume: one fresh attempt succeeds and
    // the next eligible gate presents.
    failing = false;
    seam.fire();
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(4);
    await expect(provider.maybeShowInterstitial()).resolves.toBe(true);
    expect(adapter.showInterstitial).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.stage === 'load_failed').map((e) => e.attempt)).toEqual([1, 2, 3]);
    expect(events.filter((e) => e.stage === 'load_failed').every((e) => e.reason === 'no fill')).toBe(true);
  });

  it('a resume while a backoff retry is pending does not add a second load', async (): Promise<void> => {
    const seam = makeResumeSeam();
    const adapter = makeAdapter({ prepareInterstitial: vi.fn(async (): Promise<void> => { throw new Error('no fill'); }) });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, addAppResumeListener: seam.addAppResumeListener });
    await provider.init();
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
    seam.fire();
    seam.fire();
    await flush();
    expect(adapter.prepareInterstitial).toHaveBeenCalledTimes(1);
    expect(scheduledRetries.filter((r) => !r.cancelled)).toHaveLength(1);
  });
});

describe('AdMobProvider banner state (P2)', (): void => {
  it('an asynchronous load failure clears state so the next showBanner requests again', async (): Promise<void> => {
    const adapter = makeAdapter();
    const events: LifecycleEvent[] = [];
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: (e) => events.push(e) });
    await provider.init();
    await expect(provider.showBanner()).resolves.toBe(true);
    adapter.__emit('bannerFailed', { code: 3, message: 'No ad to show' });
    await expect(provider.showBanner()).resolves.toBe(true);
    expect(adapter.showBanner).toHaveBeenCalledTimes(2);
    const failed = events.find((e) => e.stage === 'load_failed');
    expect(failed).toMatchObject({ format: 'banner', reason: 'native_3' });
    expect(events.filter((e) => e.format === 'banner' && e.stage === 'load_requested').map((e) => e.loadId)).toHaveLength(2);
  });

  it('request acceptance is never reported as an impression; the native impression callback is', async (): Promise<void> => {
    const adapter = makeAdapter();
    const events: LifecycleEvent[] = [];
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: (e) => events.push(e) });
    await provider.init();
    await provider.showBanner();
    const banner = (): LifecycleEvent[] => events.filter((e) => e.format === 'banner');
    expect(banner().map((e) => e.stage)).toEqual(['load_requested']);
    adapter.__emit('bannerLoaded');
    adapter.__emit('bannerImpression');
    expect(banner().map((e) => e.stage)).toEqual(['load_requested', 'loaded', 'impression']);
    expect(new Set(banner().map((e) => e.loadId)).size).toBe(1);
  });

  it('hide during a pending load wins: the late Loaded is re-hidden and never marks the banner visible', async (): Promise<void> => {
    const adapter = makeAdapter();
    const events: LifecycleEvent[] = [];
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: (e) => events.push(e) });
    await provider.init();
    await provider.showBanner();
    await provider.hideBanner();
    expect(adapter.hideBanner).toHaveBeenCalledTimes(1);
    adapter.__emit('bannerLoaded');
    await flush();
    expect(adapter.hideBanner).toHaveBeenCalledTimes(2);
    expect(provider['bannerVisible']).toBe(false);
    expect(events.filter((e) => e.stage === 'hidden').map((e) => e.reason)).toContain('loaded_after_hide');
    // A later show is a fresh request, not a suppressed "already visible".
    await expect(provider.showBanner()).resolves.toBe(true);
    expect(adapter.showBanner).toHaveBeenCalledTimes(2);
  });

  it('hide that lands while init is still pending prevents the banner request entirely', async (): Promise<void> => {
    let releaseInit: () => void = (): void => {};
    const adapter = makeAdapter({ initialize: vi.fn(() => new Promise<void>((resolve) => { releaseInit = resolve; })) });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    const show = provider.showBanner();
    await flush();
    await provider.hideBanner();
    releaseInit();
    await expect(show).resolves.toBe(false);
    expect(adapter.showBanner).not.toHaveBeenCalled();
  });

  it('hideBanner never initializes the SDK (no consent, init or prewarm for an entitled player)', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.hideBanner();
    await flush();
    expect(adapter.requestConsentInfo).not.toHaveBeenCalled();
    expect(adapter.initialize).not.toHaveBeenCalled();
    expect(adapter.prepareInterstitial).not.toHaveBeenCalled();
    expect(adapter.hideBanner).not.toHaveBeenCalled();
  });
});

describe('AdMobProvider lifecycle telemetry seam (P3)', (): void => {
  it('emits a correlated load → show → impression → dismissal sequence for an interstitial', async (): Promise<void> => {
    const events: LifecycleEvent[] = [];
    const adapter = makeAdapter({
      showInterstitial: vi.fn(async (): Promise<void> => {}),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: (e) => events.push(e) });
    await provider.init();
    await flush();
    const show = provider.maybeShowInterstitial();
    await flush();
    adapter.__emit('interstitialAdImpression', { adUnitId: 'i-int', valueMicros: 1200, currencyCode: 'USD', precision: 3, networkName: 'g', impressionId: 'imp-1' });
    adapter.__emit('intDismissed');
    await expect(show).resolves.toBe(true);
    await flush();
    const stages = events.filter((e) => e.format === 'interstitial').map((e) => e.stage);
    expect(stages).toEqual(['load_requested', 'loaded', 'show_requested', 'shown', 'impression', 'dismissed', 'load_requested', 'loaded']);
    const firstLoad = events[0].loadId;
    expect(events.slice(0, 6).every((e) => e.loadId === firstLoad)).toBe(true);
    expect(events[6].loadId).not.toBe(firstLoad);
  });

  it('reports reward_earned before dismissal and a closed_before_reward dismissal otherwise', async (): Promise<void> => {
    const events: LifecycleEvent[] = [];
    const adapter = makeAdapter({
      showRewardVideoAd: vi.fn(async () => {
        emitRewarded(adapter, false);
        return { type: 'coins', amount: 0 };
      }),
    });
    const emitRewarded = (a: FakeAdapter, earned: boolean): void => {
      if (earned) a.__emit(RewardAdPluginEvents.Rewarded, { type: 'coins', amount: 1 });
      a.__emit(RewardAdPluginEvents.Dismissed);
    };
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: (e) => events.push(e) });
    await expect(provider.showRewardedAd()).resolves.toEqual({ granted: false });
    expect(events.filter((e) => e.format === 'rewarded').map((e) => e.stage)).toEqual(['load_requested', 'loaded', 'show_requested', 'dismissed']);
    expect(events.find((e) => e.stage === 'dismissed')?.reason).toBe('closed_before_reward');

    events.length = 0;
    (adapter.showRewardVideoAd as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      emitRewarded(adapter, true);
      return { type: 'coins', amount: 1 };
    });
    await expect(provider.showRewardedAd()).resolves.toEqual({ granted: true });
    expect(events.map((e) => e.stage)).toEqual(['load_requested', 'loaded', 'show_requested', 'reward_earned', 'dismissed']);
  });

  it('a throwing event listener never affects ad flow', async (): Promise<void> => {
    const adapter = makeAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, onAdEvent: () => { throw new Error('sink down'); } });
    await provider.init();
    await flush();
    await expect(provider.maybeShowInterstitial()).resolves.toBe(true);
    await expect(provider.showBanner()).resolves.toBe(true);
    await expect(provider.showRewardedAd()).resolves.toEqual({ granted: true });
  });
});

describe('AdMobProvider audience treatment (owner decision 2026-09-08)', (): void => {
  const iosAdapter = (overrides: Partial<AdMobAdapter> = {}): FakeAdapter & { calls: string[] } => {
    const calls: string[] = [];
    const adapter = makeAdapter({
      getPlatform: vi.fn(async (): Promise<'android' | 'ios' | 'web'> => 'ios'),
      initialize: vi.fn(async (): Promise<void> => { calls.push('initialize'); }),
      requestConsentInfo: vi.fn(async () => { calls.push('consent'); return { status: 'OBTAINED' as never, canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' as never }; }),
      requestTrackingAuthorization: vi.fn(async (): Promise<void> => { calls.push('att'); }),
      trackingAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' })),
      ...overrides,
    });
    return Object.assign(adapter, { calls });
  };

  it('defaults to child treatment: both age tags, under-age consent, npa on every request', async (): Promise<void> => {
    const adapter = iosAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry });
    await provider.init();
    await flush();
    expect(provider.audience).toBe('child');
    expect(adapter.initialize).toHaveBeenCalledWith(expect.objectContaining({ tagForChildDirectedTreatment: true, tagForUnderAgeOfConsent: true, maxAdContentRating: 'General' }));
    expect(adapter.requestConsentInfo).toHaveBeenCalledWith(expect.objectContaining({ tagForUnderAgeOfConsent: true }));
    expect(adapter.requestTrackingAuthorization).not.toHaveBeenCalled();
    expect(adapter.prepareInterstitial).toHaveBeenCalledWith(expect.objectContaining({ npa: true }));
    await provider.showBanner();
    await provider.preloadRewarded();
    expect(adapter.showBanner).toHaveBeenCalledWith(expect.objectContaining({ npa: true }));
    expect(adapter.prepareRewardVideoAd).toHaveBeenCalledWith(expect.objectContaining({ npa: true }));
  });

  it('general audience: no age tags, consent not under-age, ATT after consent and before initialize, no npa', async (): Promise<void> => {
    const adapter = iosAdapter();
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, audience: 'general' });
    await provider.init();
    await flush();
    expect(provider.audience).toBe('general');
    const initOptions = (adapter.initialize as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(initOptions).not.toHaveProperty('tagForChildDirectedTreatment');
    expect(initOptions).not.toHaveProperty('tagForUnderAgeOfConsent');
    expect(initOptions.maxAdContentRating).toBe('General');
    expect(adapter.requestConsentInfo).toHaveBeenCalledWith(expect.objectContaining({ tagForUnderAgeOfConsent: false }));
    expect(adapter.calls).toEqual(['consent', 'att', 'initialize']);
    const interstitial = (adapter.prepareInterstitial as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(interstitial).not.toHaveProperty('npa');
    await provider.showBanner();
    await provider.preloadRewarded();
    expect((adapter.showBanner as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty('npa');
    expect((adapter.prepareRewardVideoAd as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty('npa');
  });

  it('general audience: ATT refusal or failure never blocks initialization', async (): Promise<void> => {
    const adapter = iosAdapter({
      requestTrackingAuthorization: vi.fn(async (): Promise<void> => { throw new Error('prompt unavailable'); }),
      trackingAuthorizationStatus: vi.fn(async () => ({ status: 'denied' })),
    });
    const provider = new AdMobProvider(config, { adapter, now, scheduleRetry, audience: 'general' });
    await provider.init();
    await flush();
    expect(adapter.initialize).toHaveBeenCalledOnce();
    expect(adapter.prepareInterstitial).toHaveBeenCalledOnce();
  });

  it('general audience: no ATT request on Android or when consent forbids ads', async (): Promise<void> => {
    const android = iosAdapter({ getPlatform: vi.fn(async (): Promise<'android' | 'ios' | 'web'> => 'android') });
    await new AdMobProvider(config, { adapter: android, now, scheduleRetry, audience: 'general' }).init();
    expect(android.requestTrackingAuthorization).not.toHaveBeenCalled();
    expect(android.initialize).toHaveBeenCalledOnce();

    const blocked = iosAdapter({
      requestConsentInfo: vi.fn(async () => ({ status: 'REQUIRED' as never, isConsentFormAvailable: false, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' as never })),
    });
    await new AdMobProvider(config, { adapter: blocked, now, scheduleRetry, audience: 'general' }).init();
    expect(blocked.requestTrackingAuthorization).not.toHaveBeenCalled();
    expect(blocked.initialize).not.toHaveBeenCalled();
  });
});
