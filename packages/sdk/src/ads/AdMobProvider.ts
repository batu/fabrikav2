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

  constructor(
    private readonly config: AdConfig = AD_CONFIG,
    options: AdMobProviderOptions = {},
  ) {
    this.adapter = options.adapter ?? createDefaultAdMobAdapter();
    this.lifecycle = options.lifecycle ?? {};
    this.now = options.now ?? ((): number => Date.now());
  }

  private log(message: string, details?: Record<string, unknown>): void {
    console.info(`[ads:admob] ${message}`, details ?? '');
  }

  private warn(message: string, err: unknown): void {
    console.warn(`[ads:admob] ${message}`, err);
  }

  private hasFullScreenAdLifecycleHooks(): boolean {
    return Boolean(this.lifecycle.onFullScreenAdStarted || this.lifecycle.onFullScreenAdFinished);
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

  private async registerEventListeners(): Promise<void> {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    try {
      await Promise.all([
        this.adapter.addListener(BannerAdPluginEvents.Loaded, (): void => {
          this.bannerVisible = true;
          this.bannerRequestInFlight = false;
          this.log('banner loaded');
        }),
        this.adapter.addListener(BannerAdPluginEvents.FailedToLoad, (info: AdEventInfo): void => {
          this.bannerVisible = false;
          this.bannerRequestInFlight = false;
          this.warn('banner load failed', info);
        }),
        this.adapter.addListener(BannerAdPluginEvents.AdImpression, (): void => {
          this.log('banner impression recorded');
        }),
        this.adapter.addListener(InterstitialAdPluginEvents.FailedToLoad, (info: AdEventInfo): void => {
          this.interstitialLoaded = false;
          this.warn('interstitial load event failed', info);
        }),
        this.adapter.addListener(RewardAdPluginEvents.FailedToLoad, (info: AdEventInfo): void => {
          this.rewardedLoaded = false;
          this.warn('rewarded load event failed', info);
        }),
      ]);
    } catch (err: unknown) {
      this.warn('failed to register AdMob event listeners', err);
    }
  }

  async init(): Promise<void> {
    if (this.initialized || !this.config.enabled) {
      if (!this.config.enabled) {
        this.log('init skipped; ads disabled by config');
      }
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

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
        await this.registerEventListeners();
        this.initialized = true;
        this.log('AdMob initialized');
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

  async preloadInterstitial(): Promise<void> {
    if (this.preloadPromise) {
      return this.preloadPromise;
    }

    this.preloadPromise = (async (): Promise<void> => {
      await this.init();
      if (!this.initialized) {
        return;
      }

      const platform: RuntimePlatform = await this.adapter.getPlatform();
      if (platform === 'web') {
        return;
      }

      const interstitialOptions: AdOptions = {
        adId: getInterstitialUnitId(platform, this.config),
        isTesting: this.config.isTesting,
        npa: true,
      };

      try {
        this.log('preloading interstitial', {
          platform,
          adId: interstitialOptions.adId,
          isTesting: interstitialOptions.isTesting,
        });
        await this.adapter.prepareInterstitial(interstitialOptions);
        this.interstitialLoaded = true;
        this.log('interstitial preloaded');
      } catch (err: unknown) {
        this.interstitialLoaded = false;
        this.warn('interstitial preload failed', err);
      }
    })();

    try {
      await this.preloadPromise;
    } finally {
      this.preloadPromise = null;
    }
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
    await this.init();
    if (!this.initialized) {
      return false;
    }

    // Frequency cap: don't show interstitials more often than the configured
    // interval (Families policy: ads must not interfere with app use).
    const now = this.now();
    if (now - this.lastInterstitialShownAt < (options?.minIntervalMs ?? MIN_INTERSTITIAL_INTERVAL_MS)) {
      return false;
    }

    if (!this.interstitialLoaded) {
      await this.preloadInterstitial();
    }

    if (!this.interstitialLoaded) {
      return false;
    }

    const dismissal = this.hasFullScreenAdLifecycleHooks()
      ? await this.createFullScreenAdDismissalWaiter(
          InterstitialAdPluginEvents.Dismissed,
          InterstitialAdPluginEvents.FailedToShow,
          'interstitial',
        )
      : null;
    const finishFullScreenAd = this.beginFullScreenAd('interstitial');
    try {
      await this.adapter.showInterstitial();
      this.lastInterstitialShownAt = this.now();
      if (dismissal !== null) {
        await dismissal.wait();
      }
      return true;
    } catch (err: unknown) {
      // Keep flow non-blocking; ad failures should never affect gameplay.
      this.warn('interstitial show failed', err);
      return false;
    } finally {
      if (dismissal !== null) {
        await dismissal.cleanup();
      }
      finishFullScreenAd();
      this.interstitialLoaded = false;
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
