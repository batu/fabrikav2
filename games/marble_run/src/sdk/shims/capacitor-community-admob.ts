/**
 * Web build/test stub for the OPTIONAL native `@capacitor-community/admob`
 * plugin. It is deliberately NOT a monorepo dependency (sdk DECISION S6 —
 * adding the native plugin needs Batu sign-off), yet the ads SDK's
 * `AdMobProvider` statically imports these enums at module scope, so any web
 * consumer of `@fabrikav2/sdk/ads` (marble_run is the first) needs the specifier
 * to resolve. This stub satisfies it for `tsc` (tsconfig `paths`), Vite build/
 * dev, and Vitest (`resolve.alias`).
 *
 * On web the ad provider resolves to `DisabledAdProvider` by construction, so
 * `AdMob.*` is never called and the dynamic `import('@capacitor-community/admob')`
 * seams inside `AdMobProvider` (banner/interstitial/rewarded) never run. The
 * enum string values mirror the real plugin so a native shell that swaps the
 * real module in behaves identically. Longer-term this stub belongs in
 * `@fabrikav2/sdk` (a shared web fallback for every future consumer) — see
 * handoff.
 */

export interface AdMobError {
  code?: string;
  message?: string;
}

export interface AdMobInitializationOptions {
  initializeForTesting?: boolean;
  testingDevices?: string[];
  tagForChildDirectedTreatment?: boolean;
  tagForUnderAgeOfConsent?: boolean;
  maxAdContentRating?: MaxAdContentRating;
}

export interface AdMobRewardItem {
  type: string;
  amount: number;
}

export interface AdOptions {
  adId: string;
  isTesting?: boolean;
  npa?: boolean;
}

export interface RewardAdOptions {
  adId: string;
  isTesting?: boolean;
  npa?: boolean;
}

export interface BannerAdOptions {
  adId: string;
  adSize?: BannerAdSize;
  position?: BannerAdPosition;
  isTesting?: boolean;
  npa?: boolean;
}

export enum MaxAdContentRating {
  General = 'General',
}

export enum BannerAdSize {
  ADAPTIVE_BANNER = 'ADAPTIVE_BANNER',
}

export enum BannerAdPosition {
  BOTTOM_CENTER = 'BOTTOM_CENTER',
}

export enum BannerAdPluginEvents {
  Loaded = 'bannerViewDidReceiveAd',
  FailedToLoad = 'bannerViewDidFailToReceiveAd',
  AdImpression = 'bannerAdImpression',
}

export enum InterstitialAdPluginEvents {
  FailedToLoad = 'interstitialAdFailedToLoad',
  Dismissed = 'interstitialAdDismissed',
  FailedToShow = 'interstitialAdFailedToShow',
}

export enum RewardAdPluginEvents {
  FailedToLoad = 'onRewardedVideoAdFailedToLoad',
  Dismissed = 'onRewardedVideoAdDismissed',
  FailedToShow = 'onRewardedVideoAdFailedToShow',
}

const unavailable = (): never => {
  // Reached only if a native ad method runs on web — it must not, because web
  // resolves to DisabledAdProvider. Fail loud rather than silently no-op.
  throw new Error('@capacitor-community/admob is native-only (web stub)');
};

export const AdMob: {
  initialize: (options: AdMobInitializationOptions) => Promise<void>;
  prepareInterstitial: (options: AdOptions) => Promise<void>;
  showInterstitial: () => Promise<void>;
  showBanner: (options: BannerAdOptions) => Promise<void>;
  hideBanner: () => Promise<void>;
  prepareRewardVideoAd: (options: RewardAdOptions) => Promise<void>;
  showRewardVideoAd: () => Promise<AdMobRewardItem>;
  addListener: (
    eventName: string,
    listenerFunc: (info: unknown) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
} = {
  initialize: unavailable,
  prepareInterstitial: unavailable,
  showInterstitial: unavailable,
  showBanner: unavailable,
  hideBanner: unavailable,
  prepareRewardVideoAd: unavailable,
  showRewardVideoAd: unavailable,
  addListener: unavailable,
};
