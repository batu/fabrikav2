import type { AdProvider, FullScreenAdLifecycle, FullScreenAdType, MaybeShowInterstitialOptions, RewardedAdResult } from './AdProvider.ts';
import type { AppLovinConfig } from './AppLovinConfig.ts';
import { AppLovinMax, type AppLovinAdRevenuePaidEvent, type AppLovinMaxPlugin } from './AppLovinMaxPlugin.ts';
import { withTimeout, isTimeoutError } from '../with-timeout.ts';

const MIN_INTERSTITIAL_INTERVAL_MS = 120_000;

// Bounds on native-bridge calls. The native layers only partially bound
// these (Android AppLovin: init 30s / load 15s / full-screen show 5min;
// iOS native: none), so the TS layer provides platform-uniform recovery.
// A hung call otherwise wedges level progression and mutes audio for the
// session (the music-unpause lives in a `finally` that never runs), and a
// hung init black out attribution (bootstrap gates attribution on ad init).
const NATIVE_INIT_TIMEOUT_MS = 10_000;
const NATIVE_LOAD_TIMEOUT_MS = 15_000;
// Full-screen SHOW resolves on dismiss (iOS native: didHide), NOT on present
// — the promise stays alive for the entire ad watch (~30s, often unskippable
// to earn the reward), and the earned reward is only carried to JS at dismiss.
// A 15s bound here would fire MID-WATCH on every rewarded ad: un-pause music
// under the still-playing ad, return {granted:false}, and DROP the {granted:true}
// the user earned when they finally close it (Promise.race can't cancel the
// native call, and the plugin exposes no dismiss). So show must be bounded
// STRICTLY GREATER than max ad length. 5min matches the Android native
// full-screen bound (the only platform that bounds show natively) and only
// fires for a genuinely wedged bridge. init/load/banner use the fast 15s bound
// — those fit a 'resolve fast or hang' contract; show does not.
const NATIVE_SHOW_TIMEOUT_MS = 300_000;

interface AppLovinProviderOptions {
  plugin?: AppLovinMaxPlugin;
  now?: () => number;
  logger?: Pick<Console, 'info' | 'warn'>;
  lifecycle?: FullScreenAdLifecycle;
  onAdRevenuePaid?: (event: NormalizedAppLovinAdRevenuePaidEvent) => void;
}

export interface NormalizedAppLovinAdRevenuePaidEvent {
  ad_type: 'banner' | 'interstitial' | 'rewarded';
  placement: string;
  revenue_usd: number;
  currency: 'USD';
  precision?: string;
  network_name?: string;
}

export class AppLovinMaxProvider implements AdProvider {
  readonly providerName = 'applovin-max';
  private readonly plugin: AppLovinMaxPlugin;
  private readonly now: () => number;
  private readonly logger: Pick<Console, 'info' | 'warn'>;
  private readonly lifecycle: FullScreenAdLifecycle;
  private readonly onAdRevenuePaid?: (event: NormalizedAppLovinAdRevenuePaidEvent) => void;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private revenueListenerRegistered = false;
  // After a hard init failure we stop retrying for the rest of the session:
  // without this every ad opportunity would re-attempt the (now-bounded)
  // native init and block for NATIVE_INIT_TIMEOUT_MS before failing again.
  // Mirrors GameAnalyticsProvider / AdjustAttributionProvider. A soft
  // disabled init (initialized:false without throwing) is NOT permanent so
  // a consent flow can still arm ads later.
  private permanentlyDisabled = false;
  private bannerVisible = false;
  private bannerRequestInFlight = false;
  private interstitialLoaded = false;
  private interstitialPreloadPromise: Promise<void> | null = null;
  private rewardedLoaded = false;
  private rewardedPreloadPromise: Promise<void> | null = null;
  private lastInterstitialShownAt = 0;

  constructor(
    private readonly config: AppLovinConfig,
    options: AppLovinProviderOptions = {},
  ) {
    this.plugin = options.plugin ?? AppLovinMax;
    this.now = options.now ?? ((): number => Date.now());
    this.logger = options.logger ?? console;
    this.lifecycle = options.lifecycle ?? {};
    this.onAdRevenuePaid = options.onAdRevenuePaid;
  }

  async init(): Promise<void> {
    if (this.initialized || this.permanentlyDisabled) return;
    if (this.initPromise !== null) return this.initPromise;

    this.initPromise = (async (): Promise<void> => {
      try {
        this.log('initializing AppLovin MAX', {
          sdkKey: redact(this.config.sdkKey),
          verboseLogging: this.config.verboseLogging,
        });
        const result = await withTimeout(
          this.plugin.initialize({
            sdkKey: this.config.sdkKey,
            verboseLogging: this.config.verboseLogging,
            adUnitIds: this.config.adUnitIds,
            privacy: this.config.privacy,
            consentFlow: this.config.consentFlow,
          }),
          NATIVE_INIT_TIMEOUT_MS,
          'AppLovin initialize',
        );
        this.initialized = result.initialized === true;
        if (this.initialized) {
          void this.registerAdRevenueListener();
        }
        this.log(this.initialized ? 'AppLovin MAX initialized' : 'AppLovin MAX init returned disabled');
      } catch (err: unknown) {
        this.initialized = false;
        // Only a definitive (non-timeout) plugin error permanently disables
        // ads for the session. A transient cold-start timeout (slow network /
        // SDK warmup) must NOT permanently kill all ad revenue + rewarded hints
        // — the next ad opportunity re-attempts init. NOTE this is INTENTIONALLY
        // more tolerant than the sibling providers: GameAnalyticsProvider and
        // AdjustAttributionProvider both set permanentlyDisabled on ANY init
        // error (timeout included). That is acceptable for them because a
        // disabled analytics/attribution provider only loses telemetry (cheap,
        // deduped server-side); a disabled ad provider loses revenue + blocks
        // rewarded progression, so AppLovin alone tolerates transient timeouts.
        if (!isTimeoutError(err)) {
          this.permanentlyDisabled = true;
        }
        this.warn('AppLovin MAX initialization failed', err);
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async preloadInterstitial(): Promise<void> {
    if (this.interstitialPreloadPromise !== null) {
      return this.interstitialPreloadPromise;
    }

    if (this.config.adUnitIds.interstitial === '') {
      this.logUnitNotConfiguredOnce('interstitial');
      return;
    }

    this.interstitialPreloadPromise = (async (): Promise<void> => {
      await this.init();
      if (!this.initialized) return;

      try {
        this.log('preloading interstitial');
        const result = await withTimeout(
          this.plugin.preloadInterstitial({
            adUnitId: this.config.adUnitIds.interstitial,
          }),
          NATIVE_LOAD_TIMEOUT_MS,
          'AppLovin interstitial preload',
        );
        this.interstitialLoaded = result.loaded === true;
      } catch (err: unknown) {
        this.interstitialLoaded = false;
        this.warn('interstitial preload failed', err);
      }
    })();

    try {
      await this.interstitialPreloadPromise;
    } finally {
      this.interstitialPreloadPromise = null;
    }
  }

  async maybeShowInterstitial(options?: MaybeShowInterstitialOptions): Promise<boolean> {
    await this.init();
    if (!this.initialized) return false;
    if (this.config.adUnitIds.interstitial === '') {
      this.logUnitNotConfiguredOnce('interstitial');
      return false;
    }

    const now = this.now();
    if (now - this.lastInterstitialShownAt < (options?.minIntervalMs ?? MIN_INTERSTITIAL_INTERVAL_MS)) {
      return false;
    }

    // Show only when an ad is ALREADY loaded. Awaiting a network preload
    // here is what let the next level start (and its audio play) before
    // the ad finally appeared — the caller now blocks the level
    // transition on this promise, so it must resolve fast on the
    // not-loaded path. The background preload arms the next gate.
    if (!this.interstitialLoaded) {
      void this.preloadInterstitial();
      return false;
    }

    const finishFullScreenAd = this.beginFullScreenAd('interstitial');
    try {
      const result = await withTimeout(
        this.plugin.showInterstitial({
          adUnitId: this.config.adUnitIds.interstitial,
          placement: 'level_break',
        }),
        NATIVE_SHOW_TIMEOUT_MS,
        'AppLovin interstitial show',
      );
      const shown = result.shown === true;
      if (shown) {
        this.lastInterstitialShownAt = this.now();
      }
      return shown;
    } catch (err: unknown) {
      this.warn('interstitial show failed', err);
      return false;
    } finally {
      finishFullScreenAd();
      this.interstitialLoaded = false;
      // Re-arm for the next gate now that this ad is consumed.
      void this.preloadInterstitial();
    }
  }

  async showBanner(): Promise<boolean> {
    await this.init();
    if (!this.initialized) return false;
    if (this.config.adUnitIds.banner === '') {
      this.logUnitNotConfiguredOnce('banner');
      return false;
    }
    if (this.bannerVisible || this.bannerRequestInFlight) return false;

    this.bannerRequestInFlight = true;
    try {
      const result = await withTimeout(
        this.plugin.showBanner({
          adUnitId: this.config.adUnitIds.banner,
        }),
        NATIVE_LOAD_TIMEOUT_MS,
        'AppLovin banner show',
      );
      this.bannerVisible = result.shown === true;
      return this.bannerVisible;
    } catch (err: unknown) {
      this.bannerVisible = false;
      this.warn('banner show failed', err);
      return false;
    } finally {
      this.bannerRequestInFlight = false;
    }
  }

  async hideBanner(): Promise<void> {
    await this.init();
    if (!this.initialized && !this.bannerVisible) return;

    try {
      await withTimeout(this.plugin.hideBanner(), NATIVE_LOAD_TIMEOUT_MS, 'AppLovin banner hide');
    } catch (err: unknown) {
      this.warn('banner hide failed', err);
    } finally {
      this.bannerVisible = false;
      this.bannerRequestInFlight = false;
    }
  }

  async preloadRewarded(): Promise<void> {
    if (this.rewardedPreloadPromise !== null) {
      return this.rewardedPreloadPromise;
    }

    if (this.config.adUnitIds.rewarded === '') {
      this.logUnitNotConfiguredOnce('rewarded');
      return;
    }

    this.rewardedPreloadPromise = (async (): Promise<void> => {
      await this.init();
      if (!this.initialized) return;

      try {
        this.log('preloading rewarded ad');
        const result = await withTimeout(
          this.plugin.preloadRewarded({
            adUnitId: this.config.adUnitIds.rewarded,
          }),
          NATIVE_LOAD_TIMEOUT_MS,
          'AppLovin rewarded preload',
        );
        this.rewardedLoaded = result.loaded === true;
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

  async showRewardedAd(): Promise<RewardedAdResult> {
    await this.init();
    if (!this.initialized) return { granted: false };
    if (this.config.adUnitIds.rewarded === '') {
      this.logUnitNotConfiguredOnce('rewarded');
      return { granted: false };
    }

    if (!this.rewardedLoaded) {
      await this.preloadRewarded();
    }
    if (!this.rewardedLoaded) return { granted: false };

    const finishFullScreenAd = this.beginFullScreenAd('rewarded');
    try {
      const result = await withTimeout(
        this.plugin.showRewarded({
          adUnitId: this.config.adUnitIds.rewarded,
          placement: 'economy_reward',
        }),
        NATIVE_SHOW_TIMEOUT_MS,
        'AppLovin rewarded show',
      );
      return { granted: result.granted === true };
    } catch (err: unknown) {
      this.warn('rewarded show failed', err);
      return { granted: false };
    } finally {
      finishFullScreenAd();
      this.rewardedLoaded = false;
    }
  }

  async showPrivacyOptions(): Promise<boolean> {
    await this.init();
    if (!this.initialized) return false;

    if (this.plugin.showPrivacyOptions === undefined) return false;

    try {
      const result = await withTimeout(
        this.plugin.showPrivacyOptions(),
        NATIVE_SHOW_TIMEOUT_MS,
        'AppLovin privacy options show',
      );
      return result.shown === true;
    } catch (err: unknown) {
      this.warn('privacy options show failed', err);
      return false;
    }
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

  private async registerAdRevenueListener(): Promise<void> {
    if (this.revenueListenerRegistered || this.plugin.addListener === undefined || this.onAdRevenuePaid === undefined) return;
    this.revenueListenerRegistered = true;
    try {
      await this.plugin.addListener('adRevenuePaid', (event): void => {
        const normalized = normalizeAdRevenuePaidEvent(event);
        if (normalized === null) return;
        try {
          this.onAdRevenuePaid?.(normalized);
        } catch (err: unknown) {
          this.warn('ad revenue listener failed', err);
        }
      });
    } catch (err: unknown) {
      this.revenueListenerRegistered = false;
      this.warn('ad revenue listener registration failed', err);
    }
  }

  private readonly unitNotConfiguredLogged = new Set<string>();

  private logUnitNotConfiguredOnce(format: 'banner' | 'interstitial' | 'rewarded'): void {
    if (this.unitNotConfiguredLogged.has(format)) return;
    this.unitNotConfiguredLogged.add(format);
    this.log(`${format} ad unit not configured; skipping`);
  }

  private log(message: string, details?: Record<string, unknown>): void {
    this.logger.info(`[ads:applovin] ${message}`, details ?? '');
  }

  private warn(message: string, err: unknown): void {
    this.logger.warn(`[ads:applovin] ${message}`, err);
  }
}

function redact(value: string): string {
  if (value.length <= 6) return '<redacted>';
  return `<redacted:${value.slice(-4)}>`;
}

function normalizeAdRevenuePaidEvent(event: AppLovinAdRevenuePaidEvent): NormalizedAppLovinAdRevenuePaidEvent | null {
  const revenueUsd = Number(event.revenue_usd);
  if (!Number.isFinite(revenueUsd) || revenueUsd <= 0) return null;

  const adType = normalizeAdType(event.ad_type);
  if (adType === null) return null;

  const placement = nonEmpty(event.placement) ?? defaultPlacementFor(adType);
  const precision = nonEmpty(event.precision);
  const networkName = nonEmpty(event.network_name);
  return {
    ad_type: adType,
    placement,
    revenue_usd: revenueUsd,
    currency: 'USD',
    ...(precision === undefined ? {} : { precision }),
    ...(networkName === undefined ? {} : { network_name: networkName }),
  };
}

function normalizeAdType(value: string | undefined): NormalizedAppLovinAdRevenuePaidEvent['ad_type'] | null {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (normalized === 'banner') return 'banner';
  if (normalized === 'interstitial') return 'interstitial';
  if (normalized === 'rewarded' || normalized === 'rewarded_video') return 'rewarded';
  return null;
}

function defaultPlacementFor(adType: NormalizedAppLovinAdRevenuePaidEvent['ad_type']): string {
  switch (adType) {
    case 'banner':
      return 'gameplay';
    case 'interstitial':
      return 'level_break';
    case 'rewarded':
      return 'economy_reward';
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
