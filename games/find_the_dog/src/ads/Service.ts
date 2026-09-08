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

  get providerName(): string {
    return this.delegate.providerName;
  }

  get enabled(): boolean {
    return this.delegate.enabled ?? this.delegate.providerName !== 'disabled';
  }

  install(provider: ComposedAdProvider): void {
    this.delegate = provider;
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

  /**
   * Banner visibility is owned by the delegate, which observes the native
   * load/failure callbacks. A wrapper-side "visible" boolean cannot see an
   * asynchronous native load failure and would suppress the next request
   * until a hide reset it, so none is kept here.
   */
  showBanner(): Promise<boolean> {
    return this.delegate.showBanner();
  }

  hideBanner(): Promise<void> {
    return this.delegate.hideBanner();
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
