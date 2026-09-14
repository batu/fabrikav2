import { analytics, type EconomyContext, type EconomySnapshotParams, type RewardPlacement } from './AnalyticsService';
import { gameState } from '../core/GameState';
import { showRewardedAdForEconomy } from '../ads/Service';

export function economyContext(): EconomyContext {
  return {
    display_level_number: gameState.currentLevelIndex + 1,
    coins: gameState.coinBalance,
    hints: gameState.hintsRemaining,
    total_completions: gameState.totalLevelsCompleted,
    rewarded_hint_capped: gameState.isRewardedHintCapped(),
    rewarded_hints_today: gameState.rewardedHintsToday,
  };
}

export function trackEconomySnapshot(reason: EconomySnapshotParams['reason']): void {
  void analytics.economySnapshot({ reason, ...economyContext() });
}

/** A provider grant result is distinct from the later local wallet grant. */
export async function showTrackedEconomyReward(placement: RewardPlacement): Promise<{ granted: boolean }> {
  void analytics.rewardedAttempt({ placement, outcome: 'requested', ...economyContext() });
  try {
    const result = await showRewardedAdForEconomy();
    void analytics.rewardedAttempt({
      placement,
      outcome: result.granted ? 'provider_granted' : 'not_granted',
      ...economyContext(),
    });
    return result;
  } catch (error) {
    void analytics.rewardedAttempt({ placement, outcome: 'failed', ...economyContext() });
    throw error;
  }
}
