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
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdMobProvider lifecycle', (): void => {
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
});
