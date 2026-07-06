/**
 * Provider-agnostic ad interface.
 *
 * Lifted verbatim from find_the_dog's `AdProvider.ts` (the generalization
 * already existed there, stranded). Every method swallows its own errors and
 * resolves to a safe value (`false` / `{ granted: false }` / void) — gameplay
 * must NEVER be blocked by an ad failure, and callers `void`-fire these. Do
 * not "improve" any implementation into throwing.
 */

export interface RewardedAdResult {
  granted: boolean;
}

export interface MaybeShowInterstitialOptions {
  /** Overrides the provider's default minimum gap between interstitials. */
  minIntervalMs?: number;
}

export interface AdProvider {
  readonly providerName: string;
  init: () => Promise<void>;
  preloadInterstitial: () => Promise<void>;
  maybeShowInterstitial: (options?: MaybeShowInterstitialOptions) => Promise<boolean>;
  showBanner: () => Promise<boolean>;
  hideBanner: () => Promise<void>;
  preloadRewarded: () => Promise<void>;
  showRewardedAd: () => Promise<RewardedAdResult>;
  showPrivacyOptions?: () => Promise<boolean>;
}

export type FullScreenAdType = 'interstitial' | 'rewarded';

/**
 * Injected hook so a game can pause audio / analytics around a full-screen ad
 * without the ad layer depending on those subsystems. Both adapters call these
 * exactly once per ad (start, then finish) and swallow listener errors.
 */
export interface FullScreenAdLifecycle {
  onFullScreenAdStarted?: (adType: FullScreenAdType) => void;
  onFullScreenAdFinished?: (adType: FullScreenAdType) => void;
}
