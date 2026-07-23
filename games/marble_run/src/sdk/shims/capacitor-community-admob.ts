/** Web/CI resolver for the SDK's optional AdMob enum import. marble_run never calls
 * this module: web selects Disabled and iOS selects AppLovin by construction. */
export enum MaxAdContentRating { General = 'General' }
export enum BannerAdSize { ADAPTIVE_BANNER = 'ADAPTIVE_BANNER' }
export enum BannerAdPosition { BOTTOM_CENTER = 'BOTTOM_CENTER' }
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
  throw new Error('@capacitor-community/admob is native-only (marble_run web stub)');
};

export const AdMob = {
  initialize: unavailable,
  prepareInterstitial: unavailable,
  showInterstitial: unavailable,
  showBanner: unavailable,
  hideBanner: unavailable,
  prepareRewardVideoAd: unavailable,
  showRewardVideoAd: unavailable,
  addListener: unavailable,
};
