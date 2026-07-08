import type { AdProvider, RewardedAdResult } from './AdProvider';

export class DisabledAdProvider implements AdProvider {
  readonly providerName = 'disabled';
  private didLogReason = false;

  constructor(private readonly reason: string) {}

  async init(): Promise<void> {
    this.logReasonOnce();
  }

  async preloadInterstitial(): Promise<void> {
    this.logReasonOnce();
  }

  async maybeShowInterstitial(): Promise<boolean> {
    this.logReasonOnce();
    return false;
  }

  async showBanner(): Promise<boolean> {
    this.logReasonOnce();
    return false;
  }

  async hideBanner(): Promise<void> {
    this.logReasonOnce();
  }

  async preloadRewarded(): Promise<void> {
    this.logReasonOnce();
  }

  async showRewardedAd(): Promise<RewardedAdResult> {
    this.logReasonOnce();
    return { granted: false };
  }

  async showPrivacyOptions(): Promise<boolean> {
    this.logReasonOnce();
    return false;
  }

  private logReasonOnce(): void {
    if (this.didLogReason) return;
    this.didLogReason = true;
    console.info(`[ads:disabled] ${this.reason}`);
  }
}
