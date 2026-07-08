import { attribution } from './AttributionService';

export interface RewardedAttributionResult {
  granted: boolean;
}

export function trackRewardedWatchedIfGranted(
  result: RewardedAttributionResult,
  placement: string,
  tracker: Pick<typeof attribution, 'rewardedWatched'> = attribution,
): void {
  if (!result.granted) return;
  void tracker.rewardedWatched({ placement });
}

export function trackRewardedWatchedAfterGrant(
  result: RewardedAttributionResult,
  placement: string,
  grant: () => boolean,
  tracker: Pick<typeof attribution, 'rewardedWatched'> = attribution,
): boolean {
  if (!result.granted) return false;
  const locallyGranted = grant();
  if (!locallyGranted) return false;
  void tracker.rewardedWatched({ placement });
  return true;
}
