/**
 * Ambient type shims for the OPTIONAL native ad plugins.
 *
 * `@capacitor-community/admob` is NOT a declared dependency of this monorepo
 * (DECISION S6: adding it as an optional peer dep is a dependency change that
 * needs conductor/Batu sign-off — deferred). These shims let `tsc --noEmit`
 * resolve the AdMob adapter's static type + value imports without the package
 * installed. At runtime the real module arrives with a game's native shell,
 * and unit tests supply the runtime via `vi.mock('@capacitor-community/admob')`
 * (the adapter's native seam is injected as a fake, so the real plugin is
 * never reached in tests). Shapes are minimal — only the surface the carry
 * touches; if the real plugin renames a member, the carry breaks here at
 * compile time, which is the safety property the v1 module was designed for.
 *
 * This file also AUGMENTS `@capacitor/core` (already partially shimmed in
 * ../haptics/capacitor-shims.d.ts) with the plugin-registration surface the
 * AppLovin plugin wrapper needs. Ambient module declarations across files
 * merge, so this adds to — does not replace — the haptics shim.
 */

declare module '@capacitor/core' {
  export interface PluginListenerHandle {
    remove: () => Promise<void>;
  }
  export function registerPlugin<T>(pluginName: string): T;
}

declare module '@capacitor-community/admob' {
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

  export const AdMob: {
    initialize: (options: AdMobInitializationOptions) => Promise<void>;
    prepareInterstitial: (options: AdOptions) => Promise<void>;
    showInterstitial: () => Promise<void>;
    showBanner: (options: BannerAdOptions) => Promise<void>;
    hideBanner: () => Promise<void>;
    prepareRewardVideoAd: (options: RewardAdOptions) => Promise<void>;
    showRewardVideoAd: () => Promise<AdMobRewardItem>;
    addListener: (eventName: string, listenerFunc: (info: unknown) => void) => Promise<{ remove: () => Promise<void> }>;
  };
}
