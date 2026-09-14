import { beforeEach, describe, expect, it } from 'vitest';
import { GameState } from '../../src/core/GameState';

describe('balance-based rewarded hints', () => {
  beforeEach(() => localStorage.clear());
  it.each([[0, 2], [1, 1], [2, 1], [3, 1], [10, 1], [27, 1]])('grants the offer at balance %i and counts one opportunity', (balance, amount) => {
    const state = new GameState();
    state.setHintsForTest(balance);
    expect(state.grantRewardedHint()).toBe(true);
    expect(state.hintsRemaining).toBe(balance + amount);
    expect(state.rewardedHintsToday).toBe(1);
    expect(state.walletSnapshot().counters.rewardedHintGrants).toBe(amount);
    expect(new GameState().hintsRemaining).toBe(balance + amount);
  });
  it('settles the promised amount once even if the balance changes during the ad', () => {
    const state = new GameState();
    state.setHintsForTest(0);
    const finish = state.beginRewardedHint(2)!;
    expect(state.beginRewardedHint(2)).toBeNull();
    state.setHintsForTest(10); // late purchase/other grant while the ad is open
    expect(finish(true)).toBe(2);
    expect(finish(true)).toBe(0);
    expect(state.hintsRemaining).toBe(12);
    expect(state.rewardedHintsToday).toBe(1);
    expect(new GameState().hintsRemaining).toBe(12);
  });
  it('does not turn a promised +1 into +2 after the last hint is spent', () => {
    const state = new GameState();
    state.setHintsForTest(1);
    const finish = state.beginRewardedHint(1)!;
    state.spendHint('gameplayHint');
    expect(finish(true)).toBe(1);
    expect(state.hintsRemaining).toBe(1);
  });
  it('cancellation grants nothing, consumes no slot, and cannot later reward', () => {
    const state = new GameState();
    state.setHintsForTest(0);
    const finish = state.beginRewardedHint(2)!;
    expect(finish(false)).toBe(0);
    expect(finish(true)).toBe(0);
    expect(state.rewardedHintsToday).toBe(0);
    expect(state.hintsRemaining).toBe(0);
    expect(state.beginRewardedHint(2)).not.toBeNull();
  });
  it('allows five successful ads, not five resource units', () => {
    const state = new GameState();
    for (let i = 0; i < 5; i++) {
      state.setHintsForTest(0);
      expect(state.beginRewardedHint(2)!(true)).toBe(2);
    }
    expect(state.walletSnapshot().counters.rewardedHintGrants).toBe(10);
    expect(state.beginRewardedHint(1)).toBeNull();
    expect(new GameState().isRewardedHintCapped()).toBe(true);
  });

  it('rolls the daily opportunity limit over without changing reward units', () => {
    const state = new GameState();
    state.setHintsForTest(0);
    const finish = state.beginRewardedHint(2)!;
    expect(finish(true)).toBe(2);
    localStorage.setItem('ftd_rewarded_hints_date', '2000-01-01');
    localStorage.setItem('ftd_rewarded_hints_today', '5');
    const tomorrow = new GameState();
    tomorrow.setHintsForTest(0);
    expect(tomorrow.beginRewardedHint(2)!(true)).toBe(2);
    expect(tomorrow.rewardedHintsToday).toBe(1);
  });
  it.each([0, 3, -1, NaN])('rejects invalid promised amount %s', (amount) => {
    const state = new GameState();
    state.setHintsForTest(0);
    expect(state.beginRewardedHint(amount)).toBeNull();
    expect(state.rewardedHintsToday).toBe(0);
  });

  it('keeps ordinary free grants capped while admitting rewarded top-ups above that cap', () => {
    const state = new GameState();
    state.setHintsForTest(2);
    expect(state.grantHints(2, 'gameplayHint')).toBe(1);
    for (const balance of [3, 10, 27]) {
      state.setHintsForTest(balance);
      expect(state.grantHints(1, 'gameplayHint')).toBe(0);
      expect(state.ensureMinimumHints(30, 'gameplayHint')).toBe(0);
      expect(state.hintsRemaining).toBe(balance);
      expect(state.canStartRewardedHint()).toBe(true);
      expect(state.beginRewardedHint(1)!(true)).toBe(1);
      expect(state.hintsRemaining).toBe(balance + 1);
    }
    expect(state.rewardedHintsToday).toBe(3);
  });

});
