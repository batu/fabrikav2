import { setMusicPausedForAd } from '../audio/AudioManager';
import type { AdProvider } from './AdProvider';
import { DisabledAdProvider } from './DisabledAdProvider';

type ComposedAdProvider = Omit<AdProvider, 'enabled'> & { readonly enabled?: boolean };

export interface RewardedAdResultForTest {
  granted: boolean;
  delayMs?: number;
}

class CompatibleAdProvider implements AdProvider {
  private delegate: ComposedAdProvider = new DisabledAdProvider('SdkContext has not installed an ad provider');
  private bannerVisible = false;

  get providerName(): string {
    return this.delegate.providerName;
  }

  get enabled(): boolean {
    return this.delegate.enabled ?? this.delegate.providerName !== 'disabled';
  }

  install(provider: ComposedAdProvider): void {
    this.delegate = provider;
    this.bannerVisible = false;
  }

  init(): Promise<void> {
    return this.delegate.init();
  }

  preloadInterstitial(): Promise<void> {
    return this.delegate.preloadInterstitial();
  }

  maybeShowInterstitial(options?: Parameters<AdProvider['maybeShowInterstitial']>[0]): Promise<boolean> {
    return this.delegate.maybeShowInterstitial(options);
  }

  async showBanner(): Promise<boolean> {
    if (this.bannerVisible) return true;
    this.bannerVisible = await this.delegate.showBanner();
    return this.bannerVisible;
  }

  async hideBanner(): Promise<void> {
    await this.delegate.hideBanner();
    this.bannerVisible = false;
  }

  preloadRewarded(): Promise<void> {
    return this.delegate.preloadRewarded();
  }

  showRewardedAd(): Promise<{ granted: boolean }> {
    return this.delegate.showRewardedAd();
  }

  showPrivacyOptions(): Promise<boolean> {
    return this.delegate.showPrivacyOptions?.() ?? Promise.resolve(false);
  }
}

export const adService = new CompatibleAdProvider();

export function configureAdService(provider: ComposedAdProvider): void {
  adService.install(provider);
}

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
