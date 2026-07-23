import { setMusicPausedForAd } from '../audio/AudioManager';
import type { AdProvider, MaybeShowInterstitialOptions, RewardedAdResult } from './AdProvider';
import { DisabledAdProvider } from './DisabledAdProvider';

export interface RewardedAdResultForTest {
  granted: boolean;
  delayMs?: number;
}

let provider: AdProvider = new DisabledAdProvider('ads not composed yet; SdkContext installs the provider at bootstrap');

/** SdkContext installs the selected provider (AppLovin MAX / AdMob / disabled). */
export function configureAdService(next: AdProvider): void {
  provider = next;
}

/** Stable facade: consumers hold `adService` across provider installation. */
export const adService: AdProvider = {
  get providerName(): string {
    return provider.providerName;
  },
  init: (): Promise<void> => provider.init(),
  preloadInterstitial: (): Promise<void> => provider.preloadInterstitial(),
  maybeShowInterstitial: (options?: MaybeShowInterstitialOptions): Promise<boolean> =>
    provider.maybeShowInterstitial(options),
  showBanner: (): Promise<boolean> => provider.showBanner(),
  hideBanner: (): Promise<void> => provider.hideBanner(),
  preloadRewarded: (): Promise<void> => provider.preloadRewarded(),
  showRewardedAd: (): Promise<RewardedAdResult> => provider.showRewardedAd(),
  showPrivacyOptions: (): Promise<boolean> => provider.showPrivacyOptions?.() ?? Promise.resolve(false),
};

let rewardedAdResultForTest: RewardedAdResultForTest | null = null;

export function setRewardedAdResultForTest(result: RewardedAdResultForTest | null): void {
  rewardedAdResultForTest = result;
}

export async function showRewardedAdForEconomy(): Promise<{ granted: boolean }> {
  if (rewardedAdResultForTest !== null) {
    const result = rewardedAdResultForTest;
    if (result.delayMs !== undefined) {
      await new Promise((resolve) => window.setTimeout(resolve, result.delayMs));
    }
    return { granted: result.granted };
  }
  setMusicPausedForAd(true);
  try {
    return await adService.showRewardedAd();
  } finally {
    setMusicPausedForAd(false);
  }
}

export async function showAdPrivacyOptions(): Promise<boolean> {
  return adService.showPrivacyOptions?.() ?? false;
}
