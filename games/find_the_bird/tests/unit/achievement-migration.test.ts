import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_RECORD_VERSION,
  buildAchievementReadProjection,
} from '../../src/achievements/AchievementSystem';
import { GameState } from '../../src/core/GameState';

const K = {
  TOTAL: 'ftd_total_levels_completed',
  LEVEL: 'ftd_level',
  STREAK_DAYS: 'ftd_streak_days',
  STREAK_LAST_DATE: 'ftd_streak_last_date',
  BEST_TIMES: 'ftd_best_times',
  COINS: 'ftd_wallet_coins',
  ACHIEVEMENTS: 'ftd_achievements',
} as const;

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});
afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'localStorage');
});

describe('migration / backfill (AC4/AC5/KTD5)', () => {
  it('backfills derivable completion + streak milestones, existing save otherwise unchanged', () => {
    localStorage.setItem(K.TOTAL, '12');
    localStorage.setItem(K.STREAK_DAYS, '5');
    localStorage.setItem(K.STREAK_LAST_DATE, todayStamp());
    const gs = new GameState();
    const rec = gs.achievementRecordSnapshot();
    expect(rec.unlocked).toEqual(expect.arrayContaining(['first_completion', 'completions_10', 'streak_3']));
    expect(rec.unlocked).not.toContain('completions_25');
    expect(rec.progress['completions_10']).toBe(12);
    // No retroactive reward — wallet untouched by migration.
    expect(gs.coinBalance).toBe(0);
    expect(rec.processedOccurrenceIds).toContain(`migration:v${ACHIEVEMENT_RECORD_VERSION}`);
    expect(rec.migrationRewardIneligibleAchievementIds).toEqual(
      expect.arrayContaining(['first_completion', 'completions_10', 'streak_3']),
    );
  });

  it('sanitizes malformed legacy counters (negative → 0, no spurious unlock)', () => {
    localStorage.setItem(K.TOTAL, '-5');
    const gs = new GameState();
    expect(gs.achievementRecordSnapshot().unlocked).not.toContain('first_completion');
  });

  it('never uses the selectable currentLevelIndex as completion proof', () => {
    localStorage.setItem(K.LEVEL, '40'); // navigated far ahead
    localStorage.setItem(K.TOTAL, '2'); // but only completed 2
    const gs = new GameState();
    const rec = gs.achievementRecordSnapshot();
    expect(rec.unlocked).toContain('first_completion');
    expect(rec.unlocked).not.toContain('completions_10');
  });

  it('never backfills logical mastery from served best-times (final correction)', () => {
    localStorage.setItem(K.TOTAL, '12');
    localStorage.setItem(K.BEST_TIMES, JSON.stringify({ 'served-a': 10, 'served-b': 12, 'served-c': 8 }));
    const gs = new GameState();
    expect(gs.achievementRecordSnapshot().masteredLevelIds).toEqual([]);
    expect(gs.achievementRecordSnapshot().unlocked).not.toContain('mastery_5');
  });

  it('running migration twice yields an identical record (idempotent, AC3/AC4)', () => {
    localStorage.setItem(K.TOTAL, '12');
    const gs = new GameState();
    const first = JSON.stringify(gs.achievementRecordSnapshot());
    const gs2 = new GameState();
    expect(JSON.stringify(gs2.achievementRecordSnapshot())).toBe(first);
  });

  it('no retroactive reward: migrated unlock never grants, new post-migration achievement does (correction 7)', () => {
    localStorage.setItem(K.TOTAL, '12');
    const gs = new GameState();
    expect(gs.coinBalance).toBe(0); // migration granted nothing
    // A live completion: completions_10 is already unlocked (no re-grant); first_best
    // is genuinely new post-migration and rewards normally (20 coins) + base 45.
    const result = gs.beginLevelCompletionTransaction({ levelId: 'lvl-live', levelIndex: 12, timeSeconds: 15, baseCoinReward: 45 });
    const rewardedIds = result.achievementCommit?.rewards.map((r) => r.achievementId) ?? [];
    expect(rewardedIds).toContain('first_best');
    expect(rewardedIds).not.toContain('completions_10');
    expect(gs.coinBalance).toBe(65); // 45 base + 20 first_best
  });

  it('upgrades an older-version record without losing existing unlocks', () => {
    localStorage.setItem(K.TOTAL, '12');
    localStorage.setItem(
      K.ACHIEVEMENTS,
      JSON.stringify({
        version: 0,
        progress: { first_completion: 1 },
        masteredLevelIds: [],
        unlocked: ['first_completion'],
        processedOccurrenceIds: [],
        pendingSettlement: null,
        analyticsOutbox: [],
        nextAnalyticsEventSequence: 0,
      }),
    );
    const gs = new GameState();
    const rec = gs.achievementRecordSnapshot();
    expect(rec.version).toBe(ACHIEVEMENT_RECORD_VERSION);
    expect(rec.unlocked).toContain('first_completion');
    expect(rec.unlocked).toContain('completions_10'); // newly derivable at total 12
  });

  it('keeps already-unlocked v1 migration entries explicitly provenance-unknown', () => {
    localStorage.setItem(K.TOTAL, '12');
    localStorage.setItem(
      K.ACHIEVEMENTS,
      JSON.stringify({
        version: 1,
        progress: { first_completion: 1 },
        masteredLevelIds: [],
        unlocked: ['first_completion'],
        processedOccurrenceIds: ['migration:v1'],
        pendingSettlement: null,
        analyticsOutbox: [],
        nextAnalyticsEventSequence: 0,
      }),
    );

    const gs = new GameState();
    const rec = gs.achievementRecordSnapshot();
    expect(rec.version).toBe(ACHIEVEMENT_RECORD_VERSION);
    expect(rec.migrationRewardIneligibleAchievementIds).toContain('completions_10');
    expect(rec.migrationRewardIneligibleAchievementIds).not.toContain('first_completion');
    expect(rec.legacyRewardProvenanceUnknownAchievementIds).toEqual(['first_completion']);
    expect(
      buildAchievementReadProjection(rec).find((entry) => entry.id === 'first_completion')
        ?.rewardStatus,
    ).toBe('legacy-unlocked-reward-provenance-unknown');
    expect(
      buildAchievementReadProjection(rec).find((entry) => entry.id === 'completions_10')
        ?.rewardStatus,
    ).toBe('migration-unlocked-reward-ineligible');

    const reloaded = new GameState();
    const reloadedProjection = reloaded.achievementReadProjection();
    expect(reloadedProjection.status).toBe('ready');
    if (reloadedProjection.status !== 'ready') throw new Error('projection unavailable');
    expect(
      reloadedProjection.achievements.find((entry) => entry.id === 'first_completion')
        ?.rewardStatus,
    ).toBe('legacy-unlocked-reward-provenance-unknown');
    expect(
      reloadedProjection.achievements.find((entry) => entry.id === 'completions_10')
        ?.rewardStatus,
    ).toBe('migration-unlocked-reward-ineligible');
  });
});
