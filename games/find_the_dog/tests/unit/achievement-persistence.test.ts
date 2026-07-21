import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../../src/core/GameState';
import { analytics } from '../../src/analytics/AnalyticsService';
import type { AchievementRecord } from '../../src/achievements/AchievementSystem';

const K = {
  COINS: 'ftd_wallet_coins',
  HINTS: 'ftd_hints',
  COUNTERS: 'ftd_wallet_counters',
  ACHIEVEMENTS: 'ftd_achievements',
  ACTIVE_TX: 'ftd_active_completion_transaction',
} as const;

const EMPTY_COUNTERS = {
  coinsGranted: 0,
  coinsSpent: 0,
  hintsGranted: 0,
  hintsSpent: 0,
  levelCompleteCoinGrants: 0,
  rewardedHintGrants: 0,
};

function completionInput(levelId = 'lvl-a', levelIndex = 0) {
  return { levelId, levelIndex, timeSeconds: 20, baseCoinReward: 45 };
}

// happy-dom here provides no localStorage — install a minimal in-memory polyfill.
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

function store(): MemStorage {
  return (globalThis as unknown as { localStorage: MemStorage }).localStorage;
}

/** Install a setItem spy that throws on the Nth write to `key` after installation. */
function throwOnNthKey(key: string, n: number): void {
  let count = 0;
  const ls = store();
  const original = ls.setItem.bind(ls);
  vi.spyOn(ls, 'setItem').mockImplementation((k: string, v: string) => {
    if (k === key) {
      count += 1;
      if (count === n) throw new Error('QuotaExceededError');
    }
    original(k, v);
  });
}

function throwAlwaysOnKey(key: string): void {
  const ls = store();
  const original = ls.setItem.bind(ls);
  vi.spyOn(ls, 'setItem').mockImplementation((k: string, v: string) => {
    if (k === key) throw new Error('QuotaExceededError');
    original(k, v);
  });
}

/** Hand-write a torn storage state: an achievement record with a pending settlement
 *  plus explicit wallet keys, to drive load-time recovery deterministically. */
function writeTornState(opts: {
  coins: string;
  counters?: object;
  before: { coins: number; hints: number; counters?: object };
  after: { coins: number; hints: number; counters: object };
}): void {
  const record: AchievementRecord = {
    version: 1,
    progress: {},
    masteredLevelIds: [],
    unlocked: ['first_completion'],
    processedOccurrenceIds: ['occ-r'],
    pendingSettlement: {
      occurrenceId: 'occ-r',
      before: { coins: opts.before.coins, hints: opts.before.hints, counters: { ...EMPTY_COUNTERS, ...(opts.before.counters ?? {}) } },
      after: { coins: opts.after.coins, hints: opts.after.hints, counters: { ...EMPTY_COUNTERS, ...opts.after.counters } },
    },
    analyticsOutbox: [],
    nextAnalyticsEventSequence: 5,
  };
  localStorage.setItem(K.ACHIEVEMENTS, JSON.stringify(record));
  localStorage.setItem(K.COINS, opts.coins);
  if (opts.counters !== undefined) localStorage.setItem(K.COUNTERS, JSON.stringify({ ...EMPTY_COUNTERS, ...opts.counters }));
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis as object, 'localStorage');
});

describe('happy path completion (AC2/AC6)', () => {
  it('grants base + achievement reward once and persists (first_completion 25 + first_best 20)', () => {
    const gs = new GameState();
    const result = gs.beginLevelCompletionTransaction(completionInput());
    expect(result.achievementCommit).toBeDefined();
    expect(result.achievementCommitError).toBeUndefined();
    expect(gs.coinBalance).toBe(90); // 45 base + 45 achievement
    const rec = gs.achievementRecordSnapshot();
    expect(rec.unlocked).toEqual(expect.arrayContaining(['first_completion', 'first_best']));
    expect(rec.pendingSettlement).toBeNull();
    expect(rec.progress['completions_10']).toBe(1);
    // Reward advances only coinsGranted, never the levelCompleteCoinGrants counter
    // beyond the single base grant.
    const wallet = gs.walletSnapshot();
    expect(wallet.counters.levelCompleteCoinGrants).toBe(1);
    expect(wallet.counters.coinsGranted).toBe(90);
  });

  it('duplicate completion callback grants once (AC3)', () => {
    const gs = new GameState();
    gs.beginLevelCompletionTransaction(completionInput());
    const dup = gs.beginLevelCompletionTransaction(completionInput());
    expect(dup.achievementCommit).toBeUndefined();
    expect(gs.coinBalance).toBe(90);
  });

  it('reload persists reward and re-apply is a no-op (AC3)', () => {
    const gs = new GameState();
    const result = gs.beginLevelCompletionTransaction(completionInput());
    const fact = result.achievementCommit!;
    const gs2 = new GameState();
    expect(gs2.coinBalance).toBe(90);
    expect(gs2.achievementRecordSnapshot().unlocked).toContain('first_completion');
    // Re-applying the same occurrence returns empty.
    const empty = gs2.applyAchievementFact({
      kind: 'level-completion',
      occurrenceId: fact.occurrenceId,
      transactionId: fact.occurrenceId,
      masteryLevelId: 'lvl-a',
      servedLevelId: 'lvl-a',
      progressionIndex: 0,
      totalCompletions: 1,
      streakDays: 1,
      timeSeconds: 20,
      newBest: true,
    });
    expect(empty.newlyUnlocked).toHaveLength(0);
    expect(gs2.coinBalance).toBe(90);
  });

  it('journals analytics events durably (break #6)', () => {
    const gs = new GameState();
    gs.beginLevelCompletionTransaction(completionInput());
    const outbox = gs.achievementRecordSnapshot().analyticsOutbox;
    expect(outbox.some((e) => e.name === 'achievement_unlocked')).toBe(true);
    expect(outbox.some((e) => e.name === 'achievement_reward_granted')).toBe(true);
    // A fresh load retains them (load never dispatches).
    const gs2 = new GameState();
    expect(gs2.achievementRecordSnapshot().analyticsOutbox.length).toBe(outbox.length);
  });
});

describe('write-ahead recovery (AC3/KTD2)', () => {
  it('crash after checkpoint 1 (wallet never written) recovers the grant once', () => {
    writeTornState({
      coins: '100', // wallet still at before
      before: { coins: 100, hints: 3 },
      after: { coins: 145, hints: 3, counters: { coinsGranted: 45 } },
    });
    const gs = new GameState();
    expect(gs.coinBalance).toBe(145);
    expect(gs.walletSnapshot().counters.coinsGranted).toBe(45);
    expect(gs.achievementRecordSnapshot().pendingSettlement).toBeNull();
    // A second fresh load never re-applies (idempotent, grant not lost).
    const gs2 = new GameState();
    expect(gs2.coinBalance).toBe(145);
    expect(gs2.achievementRecordSnapshot().pendingSettlement).toBeNull();
  });

  it('crash after checkpoint 2 (finalize never ran) clears pending with no reapply', () => {
    writeTornState({
      coins: '145', // wallet already at after
      counters: { coinsGranted: 45 },
      before: { coins: 100, hints: 3 },
      after: { coins: 145, hints: 3, counters: { coinsGranted: 45 } },
    });
    const gs = new GameState();
    expect(gs.coinBalance).toBe(145); // not doubled
    expect(gs.achievementRecordSnapshot().pendingSettlement).toBeNull();
  });

  it('mixed per-key tear resolves component-by-component', () => {
    // COINS advanced to after, WALLET_COUNTERS still at before.
    writeTornState({
      coins: '145',
      before: { coins: 100, hints: 3 },
      after: { coins: 145, hints: 3, counters: { coinsGranted: 45 } },
    });
    const gs = new GameState();
    expect(gs.coinBalance).toBe(145);
    expect(gs.walletSnapshot().counters.coinsGranted).toBe(45); // recovered independently
  });

  it('component matching neither snapshot journals a system-scoped anomaly and drains it', () => {
    writeTornState({
      coins: '999', // neither before (100) nor after (145)
      before: { coins: 100, hints: 3 },
      after: { coins: 145, hints: 3, counters: { coinsGranted: 45 } },
    });
    const gs = new GameState();
    expect(gs.coinBalance).toBe(999); // trusted, no reapply
    const outbox = gs.achievementRecordSnapshot().analyticsOutbox;
    const anomaly = outbox.find((e) => e.name === 'achievement_reconciliation_anomaly');
    expect(anomaly).toBeDefined();
    expect(gs.achievementRecordSnapshot().pendingSettlement).toBeNull();

    const spy = vi.spyOn((analytics as unknown as { sdk: { track: (...a: unknown[]) => void } }).sdk, 'track');
    gs.drainAnalyticsOutbox();
    expect(spy).toHaveBeenCalledWith('achievement_reconciliation_anomaly', expect.objectContaining({ wallet_component: 'coins' }));
    expect(gs.achievementRecordSnapshot().analyticsOutbox).toHaveLength(0);
  });
});

describe('in-process retry after record-write throw (corrections 4/8)', () => {
  it('checkpoint-3 throw then in-process retry finalizes without double grant', () => {
    const gs = new GameState();
    throwOnNthKey(K.ACHIEVEMENTS, 2); // cp1 write #1 ok, cp3 write #2 throws
    const result = gs.beginLevelCompletionTransaction(completionInput());
    expect(result.achievementCommitError).toBe('persistence-unavailable');
    vi.restoreAllMocks();
    // Wallet already at `after`; a same-fact retry recovers pending then dedupes.
    const rec = gs.achievementRecordSnapshot();
    expect(rec.pendingSettlement).not.toBeNull();
    const retry = gs.applyAchievementFact({
      kind: 'level-completion',
      occurrenceId: rec.pendingSettlement!.occurrenceId,
      transactionId: rec.pendingSettlement!.occurrenceId,
      masteryLevelId: 'lvl-a', servedLevelId: 'lvl-a', progressionIndex: 0,
      totalCompletions: 1, streakDays: 1, timeSeconds: 20, newBest: true,
    });
    expect(retry.rewards).toHaveLength(0); // deduped, no second grant
    expect(gs.coinBalance).toBe(90);
    expect(gs.achievementRecordSnapshot().pendingSettlement).toBeNull();
  });

  it('checkpoint-1 throw then retry grants exactly once (occurrence rolled back)', () => {
    const gs = new GameState();
    throwOnNthKey(K.ACHIEVEMENTS, 1); // cp1 write #1 throws
    const result = gs.beginLevelCompletionTransaction(completionInput());
    expect(result.achievementCommitError).toBe('persistence-unavailable');
    // Occurrence was rolled back to unprocessed; no reward granted yet.
    expect(gs.coinBalance).toBe(45); // base only
    vi.restoreAllMocks();
    const fact = {
      kind: 'level-completion' as const,
      occurrenceId: 'completion:1:0:lvl-a', transactionId: 'completion:1:0:lvl-a',
      masteryLevelId: 'lvl-a', servedLevelId: 'lvl-a', progressionIndex: 0,
      totalCompletions: 1, streakDays: 1, timeSeconds: 20, newBest: true,
    };
    const retry = gs.applyAchievementFact(fact);
    expect(retry.rewards.length).toBeGreaterThan(0);
    expect(gs.coinBalance).toBe(90); // base + achievement, single grant
  });
});

describe('persistence-unavailable degradation (final correction)', () => {
  it('checkpoint-0a throw yields achievementCommitError, finale continues, wallet unchanged', () => {
    const gs = new GameState();
    throwAlwaysOnKey(K.ACTIVE_TX);
    const result = gs.beginLevelCompletionTransaction(completionInput());
    // Finale never throws; core fields intact.
    expect(result.transaction).toBeDefined();
    expect(result.achievementCommitError).toBe('persistence-unavailable');
    expect(result.achievementCommit).toBeUndefined();
    // No achievement reward applied (base coins only).
    expect(gs.coinBalance).toBe(45);
    expect(gs.achievementRecordSnapshot().unlocked).toHaveLength(0);
  });
});

describe('cumulative + mastery survive reload', () => {
  it('progress continues from the persisted value (correction 3)', () => {
    const gs = new GameState();
    // Nine distinct completions → completions_10 progress at 9, not yet unlocked.
    for (let i = 0; i < 9; i += 1) {
      gs.beginLevelCompletionTransaction(completionInput(`lvl-${i}`, i));
      gs.markActiveCompletionAdvanced(i + 1);
    }
    expect(gs.achievementRecordSnapshot().progress['completions_10']).toBe(9);
    const gs2 = new GameState();
    gs2.beginLevelCompletionTransaction(completionInput('lvl-9', 9));
    expect(gs2.achievementRecordSnapshot().unlocked).toContain('completions_10');
  });

  it('mastery does not re-increment on a repeat completion after reload (break #5)', () => {
    const gs = new GameState();
    gs.beginLevelCompletionTransaction(completionInput('lvl-a', 0));
    gs.markActiveCompletionAdvanced(1);
    gs.beginLevelCompletionTransaction(completionInput('lvl-b', 1));
    gs.markActiveCompletionAdvanced(2);
    expect(gs.achievementRecordSnapshot().masteredLevelIds).toEqual(['lvl-a', 'lvl-b']);
    const gs2 = new GameState();
    // Repeat completion of lvl-a → mastery stays 2.
    gs2.beginLevelCompletionTransaction(completionInput('lvl-a', 0));
    expect(gs2.achievementRecordSnapshot().masteredLevelIds).toEqual(['lvl-a', 'lvl-b']);
  });
});

describe('dog-found (AC3)', () => {
  it('duplicate dog-found callback advances progress once', () => {
    const gs = new GameState();
    gs.recordDogFound('lvl-a', 'dog-1');
    const first = gs.achievementRecordSnapshot().progress['dogs_25'];
    gs.recordDogFound('lvl-a', 'dog-1'); // same occurrence
    expect(gs.achievementRecordSnapshot().progress['dogs_25']).toBe(first);
    expect(gs.achievementRecordSnapshot().processedOccurrenceIds).toContain('dog:lvl-a:dog-1');
  });
});
