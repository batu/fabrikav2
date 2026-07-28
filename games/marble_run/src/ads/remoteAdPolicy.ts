/**
 * Remote-config adapter for the ad policies. Keeps `interstitialPolicy.ts` pure
 * (and unit-testable without the config service) while giving call sites one
 * import instead of five `remoteConfigService.value(...)` reads.
 */
import { remoteConfigService } from '../config/RemoteConfigService';
import type { InterstitialPolicyConfig } from './interstitialPolicy';

export function readInterstitialPolicyConfig(): InterstitialPolicyConfig {
  return {
    enabled: remoteConfigService.value('interstitialAdsEnabled'),
    firstLevel: remoteConfigService.value('interstitialFirstLevel'),
    failOnlyUntilLevel: remoteConfigService.value('interstitialFailOnlyUntilLevel'),
    failCooldownS: remoteConfigService.value('interstitialFailCooldownS'),
    levelEndCooldownS: remoteConfigService.value('interstitialLevelEndCooldownS'),
  };
}

/** Master remote switch for every rewarded placement. */
export function rewardedAdsEnabled(): boolean {
  return remoteConfigService.value('rewardedAdsEnabled');
}
