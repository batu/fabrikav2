import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameState } from '../../src/core/GameState';

class MemStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  get length(): number { return this.values.size; }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'localStorage');
});

describe('claimable achievement rewards', () => {
  it('unlocks without paying, then pays exactly once when claimed', () => {
    const state = new GameState();
    state.beginLevelCompletionTransaction({ levelId: 'level-a', levelIndex: 0, timeSeconds: 20, baseCoinReward: 45 });

    expect(state.coinBalance).toBe(45);
    expect(state.achievementReadProjection()).toMatchObject({
      status: 'ready',
      achievements: expect.arrayContaining([
        expect.objectContaining({ id: 'first_completion', rewardStatus: 'unlocked-reward-claimable' }),
      ]),
    });

    expect(state.claimAchievementReward('first_completion')).toEqual({ achievementId: 'first_completion', coins: 25, hints: 0 });
    expect(state.coinBalance).toBe(70);
    expect(state.claimAchievementReward('first_completion')).toBeNull();
    expect(new GameState().coinBalance).toBe(70);
  });

  it('does not cap achievement hint rewards', () => {
    const state = new GameState();
    state.setHintsForTest(12);
    state.grantHints(4, 'achievement');
    expect(state.hintsRemaining).toBe(16);
  });
});
