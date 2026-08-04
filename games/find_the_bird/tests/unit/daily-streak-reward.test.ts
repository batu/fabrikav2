import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState, dailyStreakRewardForDay } from '../../src/core/GameState';

class MemStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  get length(): number { return this.values.size; }
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis as object, 'localStorage');
});

function throwOnNthWrite(key: string, occurrence: number): void {
  const storage = localStorage;
  const original = storage.setItem.bind(storage);
  let count = 0;
  vi.spyOn(storage, 'setItem').mockImplementation((writtenKey: string, value: string) => {
    if (writtenKey === key && ++count === occurrence) throw new Error('QuotaExceededError');
    original(writtenKey, value);
  });
}

describe('daily streak rewards', () => {
  it('increases through day five, then flatlines, with a hint every fifth day', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(dailyStreakRewardForDay)).toEqual([
      { coins: 10, hints: 0 }, { coins: 20, hints: 0 }, { coins: 30, hints: 0 },
      { coins: 40, hints: 0 }, { coins: 50, hints: 1 }, { coins: 50, hints: 0 },
      { coins: 50, hints: 1 },
    ]);
  });

  it('is claimable from Home once after playing today and survives reload', () => {
    localStorage.setItem('ftd_streak_days', '5');
    localStorage.setItem('ftd_streak_last_date', today());
    const state = new GameState();

    expect(state.dailyStreakRewardStatus()).toEqual({ status: 'claimable', streakDay: 5, coins: 50, hints: 1 });
    expect(state.claimDailyStreakReward()).toEqual({ streakDay: 5, coins: 50, hints: 1 });
    expect(state.walletSnapshot()).toMatchObject({ coins: 50, hints: 4 });
    expect(state.claimDailyStreakReward()).toBeNull();
    expect(new GameState().dailyStreakRewardStatus()).toEqual({ status: 'claimed', streakDay: 5, coins: 50, hints: 1 });
  });

  it('is unavailable before today has been played', () => {
    expect(new GameState().dailyStreakRewardStatus()).toEqual({ status: 'unavailable', streakDay: 0, coins: 0, hints: 0 });
  });

  it('recovers a wallet tear without duplicating or losing the daily reward', () => {
    localStorage.setItem('ftd_streak_days', '5');
    localStorage.setItem('ftd_streak_last_date', today());
    const state = new GameState();
    throwOnNthWrite('ftd_wallet_coins', 2);
    expect(() => state.claimDailyStreakReward()).toThrow();
    expect(state.achievementRecordSnapshot().pendingSettlement).not.toBeNull();

    vi.restoreAllMocks();
    const recovered = new GameState();
    expect(recovered.walletSnapshot()).toMatchObject({ coins: 50, hints: 4 });
    expect(recovered.dailyStreakRewardStatus().status).toBe('claimed');
    expect(recovered.claimDailyStreakReward()).toBeNull();
  });
});
