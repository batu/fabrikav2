import type {
  AdMobError,
  AdMobInitializationOptions,
  AdMobRewardItem,
  AdOptions,
  BannerAdOptions,
  RewardAdOptions,
} from '@capacitor-community/admob';
import {
  BannerAdPluginEvents,
  InterstitialAdPluginEvents,
  MaxAdContentRating,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type {
  AdProvider,
  FullScreenAdLifecycle,
  FullScreenAdType,
  MaybeShowInterstitialOptions,
  RewardedAdResult,
} from './AdProvider.ts';
import {
  AD_CONFIG,
  getBannerUnitId,
  getInterstitialUnitId,
  getRewardedUnitId,
  type AdConfig,
  type SupportedAdPlatform,
} from './AdMobConfig.ts';

type RuntimePlatform = SupportedAdPlatform | 'web';
type AdEventName = BannerAdPluginEvents | InterstitialAdPluginEvents | RewardAdPluginEvents;
type AdEventInfo = AdMobError | { adUnitId: string } | AdMobRewardItem | undefined;
type AdEventListener = (info: AdEventInfo) => void;
type ListenerHandle = { remove: () => Promise<void> };
type FullScreenAdDismissalWaiter = {
  wait: () => Promise<void>;
  cleanup: () => Promise<void>;
};

/**
 * Low-level native seam onto `@capacitor-community/admob`. The AdMob adapter
 * carries v1 core's `AdService` state machine and drives the native plugin
 * exclusively through this injectable interface — unit tests supply a fake and
 * never touch the real plugin. (This is v1's `AdMobAdapter`, unchanged.)
 */
export interface AdMobAdapter {
  isNativePlatform: () => Promise<boolean>;
  getPlatform: () => Promise<RuntimePlatform>;
  initialize: (options: AdMobInitializationOptions) => Promise<void>;
  prepareInterstitial: (options: AdOptions) => Promise<void>;
  showInterstitial: () => Promise<void>;
  showBanner: (options: BannerAdOptions) => Promise<void>;
  hideBanner: () => Promise<void>;
  prepareRewardVideoAd: (options: RewardAdOptions) => Promise<void>;
  showRewardVideoAd: () => Promise<AdMobRewardItem>;
  addListener: (eventName: AdEventName, listenerFunc: AdEventListener) => Promise<ListenerHandle>;
}

export const createDefaultAdMobAdapter = (): AdMobAdapter => ({
  isNativePlatform: async (): Promise<boolean> => {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  },
  getPlatform: async (): Promise<RuntimePlatform> => {
    const { Capacitor } = await import('@capacitor/core');
    const platform: string = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') {
      return platform;
    }
    return 'web';
  },
  initialize: async (options: AdMobInitializationOptions): Promise<void> => {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.initialize(options);
  },
  prepareInterstitial: async (options: AdOptions): Promise<void> => {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.prepareInterstitial(options);
  },
  showInterstitial: async (): Promise<void> => {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.showInterstitial();
  },
  showBanner: async (options: BannerAdOptions): Promise<void> => {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.showBanner(options);
  },
  hideBanner: async (): Promise<void> => {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.hideBanner();
  },
  prepareRewardVideoAd: async (options: RewardAdOptions): Promise<void> => {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.prepareRewardVideoAd(options);
  },
  showRewardVideoAd: async (): Promise<AdMobRewardItem> => {
    const { AdMob } = await import('@capacitor-community/admob');
    return AdMob.showRewardVideoAd();
  },
  addListener: async (eventName: AdEventName, listenerFunc: AdEventListener): Promise<ListenerHandle> => {
    const { AdMob } = await import('@capacitor-community/admob');
    return AdMob.addListener(eventName as never, listenerFunc as never);
  },
});

/** Minimum ms between interstitial impressions (Families policy: ads must not interfere with app use). */
const MIN_INTERSTITIAL_INTERVAL_MS = 120_000;

/**
 * Total native `prepareInterstitial` calls allowed per failure streak (the
 * initial arm plus at most two retries). Counts total attempts, not retries.
 */
const MAX_INTERSTITIAL_LOAD_ATTEMPTS = 3;
/** Backoff base for the first retry; doubles per attempt, capped. */
const INTERSTITIAL_BACKOFF_BASE_MS = 2_000;
const INTERSTITIAL_BACKOFF_CAP_MS = 30_000;

/** Cancels a scheduled retry (returned by an injectable `scheduleRetry`). */
type CancelRetry = () => void;

export interface AdMobProviderOptions {
  adapter?: AdMobAdapter;
  lifecycle?: FullScreenAdLifecycle;
  /**
   * Injected clock for the interstitial frequency cap. Defaults to `Date.now`.
   * v1's core `AdService` called `Date.now()` directly, which made the cap
   * non-deterministic to unit-test; injecting `now` (matching the AppLovin
   * adapter) makes the time-cap testable with a fake clock, no fake timers.
   */
  now?: () => number;
  /**
   * Injectable scheduler for bounded interstitial load backoff. Returns a
   * cancel function. Defaults to a `setTimeout`/`clearTimeout` wrapper. Injected
   * (matching `now`) so backoff is deterministic under unit test with no fake
   * timers.
   */
  scheduleRetry?: (fn: () => void, delayMs: number) => CancelRetry;
  /**
   * Injectable app-foreground (resume) seam. When provided, `init` registers a
   * handler that re-arms a stale interstitial on resume — it never shows. The
   * SDK package stays free of a hard `@capacitor/app` dependency; the production
   * composition root supplies this from `App.addListener('resume', ...)`.
   */
  addAppResumeListener?: (onResume: () => void) => Promise<ListenerHandle>;
}

/**
 * AdMob provider. Carries v1 core `AdService`'s full-screen ad state machine
 * (init / preload / show / dismissal-wait for interstitial + rewarded + banner)
 * behind the provider-agnostic `AdProvider` face. All native calls go through
 * the injectable `AdMobAdapter` seam. Every method swallows its errors —
 * gameplay is never blocked by an ad failure.
 */
export class AdMobProvider implements AdProvider {
  readonly providerName = 'admob';
  private readonly adapter: AdMobAdapter;
  private readonly lifecycle: FullScreenAdLifecycle;
  private readonly now: () => number;
  private readonly scheduleRetry: (fn: () => void, delayMs: number) => CancelRetry;
  private readonly addAppResumeListener?: (onResume: () => void) => Promise<ListenerHandle>;
  private initialized = false;
  private interstitialLoaded = false;
  private rewardedLoaded = false;
  private bannerVisible = false;
  private initPromise: Promise<void> | null = null;
  private preloadPromise: Promise<void> | null = null;
  private rewardedPreloadPromise: Promise<void> | null = null;
  private listenersRegistered = false;
  private bannerRequestInFlight = false;
  private lastInterstitialShownAt = 0;
  private showInProgress = false;
  private interstitialLoadAttempts = 0;
  private pendingRetryCancel: CancelRetry | null = null;
  /** Retained listener handles removed on `dispose`. */
  private readonly disposables: ListenerHandle[] = [];
  private disposed = false;
  /**
   * Monotonic lifecycle generation. Advanced by `dispose`; every async
   * operation captures it before awaiting and discards its result if it no
   * longer matches, so an in-flight init/preload/registration cannot resurrect
   * state after teardown (KTD7).
   */
  private generation = 0;
  /** Settles the active interstitial terminal waiter (so `dispose` can unblock a hung show). */
  private activeShowSettle: (() => void) | null = null;

  constructor(
    private readonly config: AdConfig = AD_CONFIG,
    options: AdMobProviderOptions = {},
  ) {
    this.adapter = options.adapter ?? createDefaultAdMobAdapter();
    this.lifecycle = options.lifecycle ?? {};
    this.now = options.now ?? ((): number => Date.now());
    this.scheduleRetry =
      options.scheduleRetry ??
      ((fn, delayMs): CancelRetry => {
        const id = setTimeout(fn, delayMs);
        return (): void => clearTimeout(id);
      });
    this.addAppResumeListener = options.addAppResumeListener;
  }

  private log(message: string, details?: Record<string, unknown>): void {
    console.info(`[ads:admob] ${message}`, details ?? '');
  }

  private warn(message: string, err: unknown): void {
    console.warn(`[ads:admob] ${message}`, err);
  }

  private beginFullScreenAd(adType: FullScreenAdType): () => void {
    let finished = false;
    try {
      this.lifecycle.onFullScreenAdStarted?.(adType);
    } catch (err: unknown) {
      this.warn('full-screen ad start listener failed', err);
    }

    return (): void => {
      if (finished) return;
      finished = true;
      try {
        this.lifecycle.onFullScreenAdFinished?.(adType);
      } catch (err: unknown) {
        this.warn('full-screen ad finish listener failed', err);
      }
    };
  }

  private async registerEventListeners(generation: number): Promise<void> {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    try {
      const handles = await Promise.all([
        this.adapter.addListener(BannerAdPluginEvents.Loaded, (): void => {
          if (this.disposed || this.generation !== generation) return;
          this.bannerVisible = true;
          this.bannerRequestInFlight = false;
          this.log('banner loaded');
        }),
        this.adapter.addListener(BannerAdPluginEvents.FailedToLoad, (info: AdEventInfo): void => {
          if (this.disposed || this.generation !== generation) return;
          this.bannerVisible = false;
          this.bannerRequestInFlight = false;
          this.warn('banner load failed', info);
        }),
        this.adapter.addListener(BannerAdPluginEvents.AdImpression, (): void => {
          if (this.disposed || this.generation !== generation) return;
          this.log('banner impression recorded');
        }),
        this.adapter.addListener(InterstitialAdPluginEvents.FailedToLoad, (info: AdEventInfo): void => {
          if (this.disposed || this.generation !== generation) return;
          this.interstitialLoaded = false;
          this.warn('interstitial load event failed', info);
        }),
        this.adapter.addListener(RewardAdPluginEvents.FailedToLoad, (info: AdEventInfo): void => {
          if (this.disposed || this.generation !== generation) return;
          this.rewardedLoaded = false;
          this.warn('rewarded load event failed', info);
        }),
      ]);
      // A dispose that landed while registration was awaiting must not leave
      // live listeners behind — remove late handles instead of retaining them.
      if (this.disposed || this.generation !== generation) {
        await Promise.all(handles.map((handle) => this.removeHandleSafely(handle)));
        return;
      }
      this.disposables.push(...handles);
    } catch (err: unknown) {
      this.warn('failed to register AdMob event listeners', err);
    }
  }

  private async removeHandleSafely(handle: ListenerHandle): Promise<void> {
    try {
      await handle.remove();
    } catch (err: unknown) {
      this.warn('listener removal failed', err);
    }
  }

  async init(): Promise<void> {
    if (this.disposed) return;
    if (this.initialized || !this.config.enabled) {
      if (!this.config.enabled) {
        this.log('init skipped; ads disabled by config');
      }
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    const generation = this.generation;
    this.initPromise = (async (): Promise<void> => {
      const isNativePlatform: boolean = await this.adapter.isNativePlatform();
      if (!isNativePlatform) {
        this.log('init skipped; non-native platform');
        return;
      }

      const initializeOptions: AdMobInitializationOptions = {
        initializeForTesting: this.config.isTesting,
        testingDevices: this.config.testingDevices,
        tagForChildDirectedTreatment: true,
        tagForUnderAgeOfConsent: true,
        maxAdContentRating: MaxAdContentRating.General,
      };

      try {
        this.log('initializing AdMob', {
          initializeForTesting: initializeOptions.initializeForTesting,
          testingDeviceCount: initializeOptions.testingDevices?.length ?? 0,
        });
        await this.adapter.initialize(initializeOptions);
        await this.registerEventListeners(generation);
        // A dispose that landed mid-init must not resurrect initialized state
        // or start prewarm/resume registration (KTD7).
        if (this.disposed || this.generation !== generation) return;
        this.initialized = true;
        this.log('AdMob initialized');
        await this.registerAppResumeListener(generation);
        // Prewarm so the first eligible opportunity can find a ready ad.
        // Fire-and-forget — awaiting it would block init (KTD3).
        void this.preloadInterstitial();
      } catch (err: unknown) {
        this.initialized = false;
        this.warn('AdMob initialization failed', err);
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /** Register the injected app-foreground seam so resume re-arms a stale ad. */
  private async registerAppResumeListener(generation: number): Promise<void> {
    if (this.addAppResumeListener === undefined) return;
    try {
      const handle = await this.addAppResumeListener((): void => this.onAppResume(generation));
      if (this.disposed || this.generation !== generation) {
        await this.removeHandleSafely(handle);
        return;
      }
      this.disposables.push(handle);
    } catch (err: unknown) {
      this.warn('app resume listener registration failed', err);
    }
  }

  /** Foreground re-arm: reload a stale interstitial on resume; never shows. */
  private onAppResume(generation: number): void {
    if (this.disposed || this.generation !== generation) return;
    if (this.interstitialLoaded || this.showInProgress) return;
    // A pending backoff retry owns the schedule; don't bypass its delay.
    if (this.pendingRetryCancel !== null) return;
    // Only a resume after an exhausted streak opens a fresh attempt budget.
    if (this.interstitialLoadAttempts >= MAX_INTERSTITIAL_LOAD_ATTEMPTS) {
      this.interstitialLoadAttempts = 0;
    }
    void this.preloadInterstitial();
  }

  async preloadInterstitial(): Promise<void> {
    // A pending backoff retry or an exhausted attempt budget owns the next load;
    // explicit show/preload/resume arms must not bypass either (KTD4).
    if (this.disposed) return;
    if (this.pendingRetryCancel !== null) return;
    if (this.interstitialLoadAttempts >= MAX_INTERSTITIAL_LOAD_ATTEMPTS) return;
    if (this.preloadPromise) {
      return this.preloadPromise;
    }

    const generation = this.generation;
    this.preloadPromise = (async (): Promise<void> => {
      await this.init();
      if (!this.initialized || this.disposed || this.generation !== generation) {
        return;
      }

      const platform: RuntimePlatform = await this.adapter.getPlatform();
      if (platform === 'web' || this.disposed || this.generation !== generation) {
        return;
      }

      const interstitialOptions: AdOptions = {
        adId: getInterstitialUnitId(platform, this.config),
        isTesting: this.config.isTesting,
        npa: true,
      };

      this.interstitialLoadAttempts += 1;
      try {
        this.log('preloading interstitial', {
          platform,
          adId: interstitialOptions.adId,
          isTesting: interstitialOptions.isTesting,
          attempt: this.interstitialLoadAttempts,
        });
        await this.adapter.prepareInterstitial(interstitialOptions);
        if (this.disposed || this.generation !== generation) return;
        this.interstitialLoaded = true;
        this.interstitialLoadAttempts = 0;
        this.clearPendingRetry();
        this.log('interstitial preloaded');
      } catch (err: unknown) {
        this.interstitialLoaded = false;
        this.warn('interstitial preload failed', err);
        this.scheduleInterstitialRetry(generation);
      }
    })();

    try {
      await this.preloadPromise;
    } finally {
      this.preloadPromise = null;
    }
  }

  private clearPendingRetry(): void {
    if (this.pendingRetryCancel !== null) {
      try {
        this.pendingRetryCancel();
      } catch (err: unknown) {
        this.warn('retry cancel failed', err);
      }
      this.pendingRetryCancel = null;
    }
  }

  /** Schedule the next bounded backoff retry after a load failure (KTD4). */
  private scheduleInterstitialRetry(generation: number): void {
    if (this.disposed || this.generation !== generation) return;
    if (this.pendingRetryCancel !== null) return; // one pending retry at a time
    if (this.interstitialLoadAttempts >= MAX_INTERSTITIAL_LOAD_ATTEMPTS) return; // budget spent
    const delay = Math.min(
      INTERSTITIAL_BACKOFF_CAP_MS,
      INTERSTITIAL_BACKOFF_BASE_MS * 2 ** (this.interstitialLoadAttempts - 1),
    );
    this.pendingRetryCancel = this.scheduleRetry((): void => {
      this.pendingRetryCancel = null;
      if (this.disposed || this.generation !== generation) return;
      void this.preloadInterstitial();
    }, delay);
  }

  async showBanner(): Promise<boolean> {
    await this.init();
    if (!this.initialized) {
      this.log('banner skipped; AdMob not initialized');
      return false;
    }
    if (this.bannerVisible || this.bannerRequestInFlight) {
      this.log('banner skipped; already visible or loading');
      return true;
    }

    const platform: RuntimePlatform = await this.adapter.getPlatform();
    if (platform === 'web') {
      this.log('banner skipped; web platform');
      return false;
    }

    try {
      const { BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob');
      const adId = getBannerUnitId(platform, this.config);
      this.log('showing banner', { platform, adId, isTesting: this.config.isTesting });
      this.bannerRequestInFlight = true;
      await this.adapter.showBanner({
        adId,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        isTesting: this.config.isTesting,
        npa: true,
      });
      this.log('banner requested');
      return true;
    } catch (err: unknown) {
      // Banner failures should never affect gameplay
      this.bannerRequestInFlight = false;
      this.bannerVisible = false;
      this.warn('banner show failed', err);
      return false;
    }
  }

  async hideBanner(): Promise<void> {
    await this.init();
    if (!this.initialized) return;
    try {
      await this.adapter.hideBanner();
    } catch (err: unknown) {
      // Ignore
      this.warn('banner hide failed', err);
    } finally {
      this.bannerVisible = false;
    }
  }

  /**
   * Show an interstitial at a natural break (death, level complete, etc).
   * Respects the frequency cap and silently no-ops if ads aren't initialized,
   * the cap is active, or the preload fails. The caller never has to handle
   * errors — gameplay must not be blocked by ad failure.
   */
  async maybeShowInterstitial(options?: MaybeShowInterstitialOptions): Promise<boolean> {
    if (this.disposed) return false;

    // Immediate ready/not-ready decision — never await init or a network
    // preload on the not-ready path (R1). A call made during cold init starts
    // init in the background and returns now, so the ad can never surface after
    // the caller's break has passed.
    if (!this.initialized) {
      void this.init();
      return false;
    }

    // Frequency cap: don't show interstitials more often than the configured
    // interval (Families policy: ads must not interfere with app use).
    const now = this.now();
    if (now - this.lastInterstitialShownAt < (options?.minIntervalMs ?? MIN_INTERSTITIAL_INTERVAL_MS)) {
      return false;
    }

    // Concurrent-show guard: a second call while the first ad is still onscreen
    // (present through terminal dismissal) must not arm or present again (KTD2).
    if (this.showInProgress) {
      return false;
    }

    // Show only an already-loaded ad; otherwise background-arm the next gate
    // and return immediately (AppLovin parity).
    if (!this.interstitialLoaded) {
      void this.preloadInterstitial();
      return false;
    }

    const generation = this.generation;
    this.showInProgress = true;

    // Always create the interstitial-only terminal waiter (Dismissed /
    // FailedToShow, no synthetic timeout) even without lifecycle hooks: AdMob's
    // native show resolves on PRESENT, so the guard and re-arm must span through
    // a terminal event (KTD1). Both listeners are required — if either fails to
    // register we do not present and leave the ready state retryable.
    const waiter = await this.createInterstitialTerminalWaiter(generation);
    if (waiter === null) {
      this.showInProgress = false;
      return false;
    }
    this.activeShowSettle = waiter.settle;

    const finishFullScreenAd = this.beginFullScreenAd('interstitial');
    try {
      await this.adapter.showInterstitial();
      this.lastInterstitialShownAt = this.now();
      await waiter.wait();
      return true;
    } catch (err: unknown) {
      // Keep flow non-blocking; ad failures should never affect gameplay.
      this.warn('interstitial show failed', err);
      return false;
    } finally {
      // Cleanup must never throw the safe-value contract; swallow removal errors
      // independently so state and re-arm always settle.
      await waiter.cleanup();
      this.activeShowSettle = null;
      finishFullScreenAd();
      this.interstitialLoaded = false;
      this.showInProgress = false;
      // Re-arm exactly once for the next gate now that this ad is consumed —
      // but not if a dispose landed during the show (KTD1/KTD7).
      if (!this.disposed && this.generation === generation) {
        void this.preloadInterstitial();
      }
    }
  }

  /**
   * Preload a rewarded-video ad so `showRewardedAd` can return quickly when the
   * player taps "Watch ad for hint". Safe to call multiple times; idempotent
   * while a preload is in flight. Failures are swallowed — gameplay is never
   * blocked by an ad load.
   */
  async preloadRewarded(): Promise<void> {
    if (this.rewardedPreloadPromise) {
      return this.rewardedPreloadPromise;
    }

    this.rewardedPreloadPromise = (async (): Promise<void> => {
      await this.init();
      if (!this.initialized) return;

      const platform: RuntimePlatform = await this.adapter.getPlatform();
      if (platform === 'web') return;

      const options: RewardAdOptions = {
        adId: getRewardedUnitId(platform, this.config),
        isTesting: this.config.isTesting,
        npa: true,
      };

      try {
        this.log('preloading rewarded ad', {
          platform,
          adId: options.adId,
          isTesting: options.isTesting,
        });
        await this.adapter.prepareRewardVideoAd(options);
        this.rewardedLoaded = true;
        this.log('rewarded ad preloaded');
      } catch (err: unknown) {
        this.rewardedLoaded = false;
        this.warn('rewarded preload failed', err);
      }
    })();

    try {
      await this.rewardedPreloadPromise;
    } finally {
      this.rewardedPreloadPromise = null;
    }
  }

  /**
   * Show a rewarded-video ad. Resolves with `{ granted: true }` if the user
   * watched long enough to earn the reward, `{ granted: false }` otherwise
   * (cancelled, failed to load, web platform, ads disabled).
   */
  async showRewardedAd(): Promise<RewardedAdResult> {
    await this.init();
    if (!this.initialized) return { granted: false };

    const platform: RuntimePlatform = await this.adapter.getPlatform();
    if (platform === 'web') return { granted: false };

    if (!this.rewardedLoaded) {
      await this.preloadRewarded();
    }
    if (!this.rewardedLoaded) return { granted: false };

    const dismissal = await this.createFullScreenAdDismissalWaiter(
      RewardAdPluginEvents.Dismissed,
      RewardAdPluginEvents.FailedToShow,
      'rewarded',
    );
    const finishFullScreenAd = this.beginFullScreenAd('rewarded');
    try {
      // Adapter contract: resolves with an AdMobRewardItem iff the player
      // completed the video; rejects on cancel / load failure. The reward can
      // arrive before the full-screen ad is dismissed, so wait for Dismissed
      // before returning to callers that animate rewards into the game UI.
      const reward = await this.adapter.showRewardVideoAd();
      const granted = reward.amount > 0;
      await dismissal.wait();
      return { granted };
    } catch (err: unknown) {
      this.warn('rewarded show failed', err);
      return { granted: false };
    } finally {
      await dismissal.cleanup();
      finishFullScreenAd();
      // One rewarded show consumes the preloaded ad — always mark as
      // consumed so the next showRewardedAd triggers a fresh preload.
      this.rewardedLoaded = false;
    }
  }

  /** AdMob has no privacy-options entry point; parity no-op returns false. */
  async showPrivacyOptions(): Promise<boolean> {
    return false;
  }

  /**
   * AdMob-local teardown (KTD6/KTD7). Removes every registered listener, cancels
   * a pending backoff retry, advances the lifecycle generation so in-flight
   * async work is fenced, and settles an active show once without re-arming.
   * Exposed through the additive owned-provider helper, NOT the shared
   * `AdProvider` interface. Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    // Mark disposed and advance the generation before any await so an in-flight
    // init/preload/registration cannot resurrect state or leak a listener.
    this.disposed = true;
    this.generation += 1;
    this.clearPendingRetry();
    this.interstitialLoaded = false;
    // Unblock a show that is awaiting a terminal event whose listeners we are
    // about to remove; its finally finishes lifecycle once and skips re-arm
    // (generation advanced above).
    if (this.activeShowSettle !== null) {
      try {
        this.activeShowSettle();
      } catch (err: unknown) {
        this.warn('active show settle during dispose failed', err);
      }
    }
    const handles = this.disposables.splice(0);
    await Promise.all(handles.map((handle) => this.removeHandleSafely(handle)));
  }

  /**
   * Interstitial-only terminal waiter (Dismissed / FailedToShow, no synthetic
   * timeout). Both listeners are required; returns null (and cleans up any
   * partially registered handle) if either cannot be registered, so the caller
   * does not present. Distinct from `createFullScreenAdDismissalWaiter`, which
   * keeps its 30-second timeout for rewarded ads.
   */
  private async createInterstitialTerminalWaiter(generation: number): Promise<{
    wait: () => Promise<void>;
    settle: () => void;
    cleanup: () => Promise<void>;
  } | null> {
    const handles: ListenerHandle[] = [];
    let settled = false;
    let resolveWait: () => void = (): void => {};
    const waitPromise = new Promise<void>((resolve) => {
      resolveWait = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
    });

    const onTerminal = (): void => {
      if (this.disposed || this.generation !== generation) return;
      resolveWait();
    };

    try {
      const dismissedHandle = await this.adapter.addListener(InterstitialAdPluginEvents.Dismissed, onTerminal);
      if (this.disposed || this.generation !== generation) {
        await this.removeHandleSafely(dismissedHandle);
        return null;
      }
      handles.push(dismissedHandle);

      const failedToShowHandle = await this.adapter.addListener(
        InterstitialAdPluginEvents.FailedToShow,
        onTerminal,
      );
      if (this.disposed || this.generation !== generation) {
        await this.removeHandleSafely(failedToShowHandle);
        while (handles.length > 0) {
          const handle = handles.pop();
          if (handle !== undefined) await this.removeHandleSafely(handle);
        }
        return null;
      }
      handles.push(failedToShowHandle);
    } catch (err: unknown) {
      this.warn('interstitial terminal listener registration failed', err);
      while (handles.length > 0) {
        const handle = handles.pop();
        if (handle !== undefined) await this.removeHandleSafely(handle);
      }
      return null;
    }

    return {
      wait: (): Promise<void> => waitPromise,
      settle: resolveWait,
      cleanup: async (): Promise<void> => {
        resolveWait();
        while (handles.length > 0) {
          const handle = handles.pop();
          if (handle !== undefined) await this.removeHandleSafely(handle);
        }
      },
    };
  }

  private async createFullScreenAdDismissalWaiter(
    dismissedEventName: AdEventName,
    failedToShowEventName: AdEventName,
    adType: FullScreenAdType,
    timeoutMs = 30_000,
  ): Promise<FullScreenAdDismissalWaiter> {
    const handles: ListenerHandle[] = [];
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let resolveWait: () => void = (): void => {};

    const waitPromise = new Promise<void>((resolve) => {
      resolveWait = (): void => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimeout(timeout);
        resolve();
      };
      timeout = setTimeout(resolveWait, timeoutMs);
    });

    try {
      handles.push(await this.adapter.addListener(dismissedEventName, resolveWait));
    } catch (err: unknown) {
      this.warn(`${adType} dismissal listener registration failed`, err);
    }

    try {
      handles.push(await this.adapter.addListener(failedToShowEventName, resolveWait));
    } catch (err: unknown) {
      this.warn(`${adType} failed-to-show listener registration failed`, err);
    }

    if (handles.length === 0) {
      resolveWait();
    }

    return {
      wait: (): Promise<void> => waitPromise,
      cleanup: async (): Promise<void> => {
        if (timeout !== null) {
          clearTimeout(timeout);
          timeout = null;
        }
        resolveWait();
        while (handles.length > 0) {
          const handle = handles.pop();
          if (handle !== undefined) {
            await handle.remove();
          }
        }
      },
    };
  }
}

export const createAdMobProvider = (config: AdConfig = AD_CONFIG, options: AdMobProviderOptions = {}): AdMobProvider =>
  new AdMobProvider(config, options);
