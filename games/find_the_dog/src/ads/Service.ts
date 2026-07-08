import { setMusicPausedForAd } from '../audio/AudioManager';
import type { AdProvider } from './AdProvider';
import { DisabledAdProvider } from './DisabledAdProvider';

export interface RewardedAdResultForTest {
  granted: boolean;
  delayMs?: number;
}

export const adService: AdProvider = new DisabledAdProvider('v2 port uses package SDK ad seam; native providers require device-stage wiring');

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
