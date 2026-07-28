export interface RewardedAdResult {
  granted: boolean;
}

export interface MaybeShowInterstitialOptions {
  /** Overrides the provider's default minimum gap between interstitials. */
  minIntervalMs?: number;
}

export type FullScreenAdType = 'interstitial' | 'rewarded';

export interface FullScreenAdLifecycle {
  onFullScreenAdStarted?: (adType: FullScreenAdType) => void;
  onFullScreenAdFinished?: (adType: FullScreenAdType) => void;
}

export interface AdProvider {
  readonly providerName: string;
  /** False when this provider never shows ads (disabled/dev) — lets callers
   *  skip counting a returned `shown === false` as a real show failure. */
  readonly enabled: boolean;
  init: () => Promise<void>;
  preloadInterstitial: () => Promise<void>;
  maybeShowInterstitial: (options?: MaybeShowInterstitialOptions) => Promise<boolean>;
  showBanner: () => Promise<boolean>;
  hideBanner: () => Promise<void>;
  preloadRewarded: () => Promise<void>;
  showRewardedAd: () => Promise<RewardedAdResult>;
  showPrivacyOptions?: () => Promise<boolean>;
}
