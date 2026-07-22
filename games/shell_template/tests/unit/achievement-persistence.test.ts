import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../../src/core/GameState';
import { analytics } from '../../src/analytics/AnalyticsService';
import {
  ACHIEVEMENT_RECORD_VERSION,
  type AchievementRecord,
} from '../../src/achievements/AchievementSystem';

const K = {
  COINS: 'ftd_wallet_coins',
  HINTS: 'ftd_hints',
  COUNTERS: 'ftd_wallet_counters',
  ACHIEVEMENTS: 'ftd_achievements',
  ACTIVE_TX: 'ftd_active_completion_transaction',
  BEST_TIMES: 'ftd_best_times',
  STREAK_DAYS: 'ftd_streak_days',
  STREAK_LAST_DATE: 'ftd_streak_last_date',
  TOTAL_COMPLETIONS: 'ftd_total_levels_completed',
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

function completionFact(occurrenceId: string, totalCompletions = 1, newBest = true) {
  return {
    kind: 'level-completion' as const,
    occurrenceId,
    transactionId: occurrenceId,
    masteryLevelId: `logical-${occurrenceId}`,
    servedLevelId: `served-${occurrenceId}`,
    progressionIndex: 0,
    totalCompletions,
    streakDays: 1,
    timeSeconds: 20,
    newBest,
  };
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

function throwOnGetKey(key: string): void {
  const ls = store();
  const original = ls.getItem.bind(ls);
  vi.spyOn(ls, 'getItem').mockImplementation((k: string) => {
    if (k === key) throw new Error('SecurityError');
    return original(k);
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
    version: ACHIEVEMENT_RECORD_VERSION,
    progress: {},
    masteredLevelIds: [],
    unlocked: ['first_completion'],
    migrationRewardIneligibleAchievementIds: [],
    legacyRewardProvenanceUnknownAchievementIds: [],
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

  it.each([K.BEST_TIMES, K.STREAK_DAYS, K.STREAK_LAST_DATE, K.TOTAL_COMPLETIONS])(
    'checkpoint-0pre failure at %s leaves the durable transaction intent recoverable',
    (key) => {
      const gs = new GameState();
      throwAlwaysOnKey(key);
      const first = gs.beginLevelCompletionTransaction(completionInput());
      expect(first.achievementCommitError).toBe('persistence-unavailable');
      expect(first.transaction.completionStatsRegistered).toBe(true);
      expect(first.transaction.completionProgressAfter).toBeDefined();

      vi.restoreAllMocks();
      const recovered = new GameState();
      expect(recovered.completionTransactionSnapshot()?.id).toBe(first.transaction.id);
      const retry = recovered.beginLevelCompletionTransaction(completionInput());
      expect(retry.transaction.id).toBe(first.transaction.id);
      expect(retry.completionStatsRegisteredNow).toBe(false);
      expect(retry.achievementCommitError).toBeUndefined();
    },
  );

  it.each([K.HINTS, K.COINS, K.COUNTERS])(
    'checkpoint-0b baseline failure at %s aborts before achievement state commits',
    (key) => {
      const gs = new GameState();
      throwOnNthKey(key, 1);
      expect(() => gs.applyAchievementFact(completionFact(`baseline-${key}`))).toThrow();
      expect(gs.achievementRecordSnapshot().processedOccurrenceIds).not.toContain(`baseline-${key}`);
      expect(gs.achievementRecordSnapshot().pendingSettlement).toBeNull();

      vi.restoreAllMocks();
      const retry = gs.applyAchievementFact(completionFact(`baseline-${key}`));
      expect(retry.rewards.length).toBeGreaterThan(0);
      expect(gs.achievementRecordSnapshot().pendingSettlement).toBeNull();
    },
  );

  it.each([K.HINTS, K.COINS, K.COUNTERS])(
    'checkpoint-2 wallet tear at %s recovers once on a fresh load',
    (key) => {
      const gs = new GameState();
      throwOnNthKey(key, 2);
      expect(() => gs.applyAchievementFact(completionFact(`wallet-${key}`))).toThrow();
      expect(gs.achievementRecordSnapshot().pendingSettlement).not.toBeNull();

      vi.restoreAllMocks();
      const recovered = new GameState();
      expect(recovered.coinBalance).toBe(45);
      expect(recovered.achievementRecordSnapshot().pendingSettlement).toBeNull();
      const duplicate = recovered.applyAchievementFact(completionFact(`wallet-${key}`));
      expect(duplicate.rewards).toHaveLength(0);
      expect(recovered.coinBalance).toBe(45);
    },
  );

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
    expect(gs.achievementReadProjection()).toEqual({
      status: 'unavailable',
      reason: 'settlement-pending',
    });
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
    expect(gs.achievementReadProjection().status).toBe('ready');
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

  it('fails the read projection closed without overwriting a journal that cannot be read', () => {
    const original = new GameState();
    original.recordDogFound('lvl-a', 'dog-a');
    const durableJournal = localStorage.getItem(K.ACHIEVEMENTS);
    expect(durableJournal).not.toBeNull();

    throwOnGetKey(K.ACHIEVEMENTS);
    const degraded = new GameState();
    expect(degraded.achievementReadProjection()).toEqual({
      status: 'unavailable',
      reason: 'persistence-unavailable',
    });
    vi.restoreAllMocks();
    degraded.grantCoins(1, 'test');
    expect(degraded.recordDogFound('lvl-b', 'dog-b')).toBeNull();
    expect(localStorage.getItem(K.ACHIEVEMENTS)).toBe(durableJournal);
  });

  it('does not downgrade or overwrite an achievement journal from a future record version', () => {
    const futureRecord = {
      version: 99,
      progress: { future_catalog_entry: 7 },
      masteredLevelIds: [],
      unlocked: ['future_catalog_entry'],
      processedOccurrenceIds: ['future:1'],
      pendingSettlement: null,
      analyticsOutbox: [],
      nextAnalyticsEventSequence: 42,
      futureField: { preserved: true },
    };
    const durableJournal = JSON.stringify(futureRecord);
    localStorage.setItem(K.ACHIEVEMENTS, durableJournal);

    const degraded = new GameState();
    expect(degraded.achievementReadProjection()).toEqual({
      status: 'unavailable',
      reason: 'persistence-unavailable',
    });
    expect(
      degraded.allocateAchievementViewEvent({ name: 'achievement_page_viewed' }),
    ).toBeNull();
    degraded.grantCoins(1, 'test');
    expect(degraded.recordDogFound('lvl-a', 'dog-a')).toBeNull();
    expect(localStorage.getItem(K.ACHIEVEMENTS)).toBe(durableJournal);
  });

  it('keeps the ordinary base grant recoverable when checkpoint 0pre interrupts after 0a', () => {
    const gs = new GameState();
    throwAlwaysOnKey(K.BEST_TIMES);
    const first = gs.beginLevelCompletionTransaction(completionInput());
    expect(first.achievementCommitError).toBe('persistence-unavailable');
    expect(first.baseCoinsGrantedNow).toBe(true);
    const durableTransaction = JSON.parse(localStorage.getItem(K.ACTIVE_TX) ?? '{}') as { baseCoinsGranted?: boolean };
    expect(durableTransaction.baseCoinsGranted).toBe(false);

    vi.restoreAllMocks();
    const recovered = new GameState();
    const retry = recovered.beginLevelCompletionTransaction(completionInput());
    expect(retry.transaction.id).toBe(first.transaction.id);
    expect(retry.baseCoinsGrantedNow).toBe(true);
    expect(recovered.coinBalance).toBe(90);
    expect(recovered.walletSnapshot().counters.levelCompleteCoinGrants).toBe(1);
  });
});

describe('reward cap and analytics retry', () => {
  it('records only the actually applied hint reward at the wallet cap', () => {
    const seeded: AchievementRecord = {
      version: ACHIEVEMENT_RECORD_VERSION,
      progress: {
        first_completion: 49,
        completions_10: 49,
        completions_25: 49,
        completions_50: 49,
        first_best: 1,
      },
      masteredLevelIds: [],
      unlocked: ['first_completion', 'completions_10', 'completions_25', 'first_best'],
      migrationRewardIneligibleAchievementIds: [],
      legacyRewardProvenanceUnknownAchievementIds: [],
      processedOccurrenceIds: [`migration:v${ACHIEVEMENT_RECORD_VERSION}`],
      pendingSettlement: null,
      analyticsOutbox: [],
      nextAnalyticsEventSequence: 0,
    };
    localStorage.setItem(K.ACHIEVEMENTS, JSON.stringify(seeded));
    localStorage.setItem(K.HINTS, '2');
    const gs = new GameState();
    const committed = gs.applyAchievementFact(completionFact('cap-50', 50, false));
    expect(committed.rewards).toContainEqual({ achievementId: 'completions_50', coins: 100, hints: 1 });
    expect(gs.hintsRemaining).toBe(3);
    expect(gs.walletSnapshot().counters.hintsGranted).toBe(1);

    const recovered = new GameState();
    expect(recovered.hintsRemaining).toBe(3);
    expect(recovered.walletSnapshot().counters.hintsGranted).toBe(1);
  });

  it('retains only failed local dispatches and retries them after reload', () => {
    const gs = new GameState();
    gs.beginLevelCompletionTransaction(completionInput());
    const firstEventId = gs.achievementRecordSnapshot().analyticsOutbox[0]?.eventId;
    expect(firstEventId).toBeDefined();
    const dispatch = vi.spyOn(analytics, 'dispatchAchievementEvent').mockImplementation((event) => {
      if (event.eventId === firstEventId) throw new Error('dispatch unavailable');
    });
    gs.drainAnalyticsOutbox();
    expect(gs.achievementRecordSnapshot().analyticsOutbox.map((event) => event.eventId)).toEqual([firstEventId]);
    expect(dispatch).toHaveBeenCalled();

    vi.restoreAllMocks();
    const recovered = new GameState();
    const retry = vi.spyOn(analytics, 'dispatchAchievementEvent').mockImplementation(() => undefined);
    recovered.drainAnalyticsOutbox();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(recovered.achievementRecordSnapshot().analyticsOutbox).toHaveLength(0);
  });
});

describe('ACH-2 read and view-event contract', () => {
  it('exposes the canonical projection and persists unique UI analytics allocations across reload', () => {
    const gs = new GameState();
    const projection = gs.achievementReadProjection();
    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') throw new Error('achievement projection unavailable');
    expect(projection.achievements[0]).toMatchObject({
      id: 'first_completion',
      rewardStatus: 'locked',
    });

    const viewed = gs.allocateAchievementViewEvent({
      name: 'achievement_viewed',
      achievementId: 'first_completion',
    });
    const page = gs.allocateAchievementViewEvent({ name: 'achievement_page_viewed' });
    expect(viewed?.payload).toMatchObject({ achievement_id: 'first_completion' });
    expect(page?.payload).toEqual({ event_id: page?.eventId });

    const reloaded = new GameState();
    const viewedAgain = reloaded.allocateAchievementViewEvent({
      name: 'achievement_viewed',
      achievementId: 'first_completion',
    });
    const ids = [viewed?.eventId, page?.eventId, viewedAgain?.eventId];
    expect(new Set(ids).size).toBe(3);
    expect(reloaded.achievementRecordSnapshot().nextAnalyticsEventSequence).toBe(32);
  });

  it('returns no event and restores the durable sequence when allocation persistence fails', () => {
    const gs = new GameState();
    throwAlwaysOnKey(K.ACHIEVEMENTS);
    expect(
      gs.allocateAchievementViewEvent({
        name: 'achievement_viewed',
        achievementId: 'first_completion',
      }),
    ).toBeNull();
    expect(gs.achievementRecordSnapshot().nextAnalyticsEventSequence).toBe(0);

    vi.restoreAllMocks();
    const retry = gs.allocateAchievementViewEvent({
      name: 'achievement_viewed',
      achievementId: 'first_completion',
    });
    expect(retry?.eventId).toBe('ach:0:viewed:first_completion');
  });

  it('keeps reserved UI ids disjoint from interleaved domain outbox ids', () => {
    const gs = new GameState();
    const viewed = gs.allocateAchievementViewEvent({
      name: 'achievement_viewed',
      achievementId: 'first_completion',
    });

    gs.recordDogFound('level-a', 'dog-a');
    const domainIds = gs.achievementRecordSnapshot().analyticsOutbox.map((event) => event.eventId);
    const page = gs.allocateAchievementViewEvent({ name: 'achievement_page_viewed' });

    expect(viewed?.eventId).toBe('ach:0:viewed:first_completion');
    expect(page?.eventId).toBe('ach:1:page:achievement_system');
    expect(domainIds.length).toBeGreaterThan(0);
    expect(domainIds.every((id) => Number(id.split(':')[1]) >= 16)).toBe(true);
    expect(new Set([viewed?.eventId, page?.eventId, ...domainIds]).size).toBe(
      domainIds.length + 2,
    );
  });

  it('retries the next reservation boundary without consuming an id', () => {
    const gs = new GameState();
    const allocated = Array.from({ length: 16 }, () =>
      gs.allocateAchievementViewEvent({ name: 'achievement_page_viewed' }),
    );
    expect(allocated.at(-1)?.eventId).toBe('ach:15:page:achievement_system');

    throwAlwaysOnKey(K.ACHIEVEMENTS);
    expect(gs.allocateAchievementViewEvent({ name: 'achievement_page_viewed' })).toBeNull();
    vi.restoreAllMocks();

    expect(gs.allocateAchievementViewEvent({ name: 'achievement_page_viewed' })?.eventId).toBe(
      'ach:16:page:achievement_system',
    );
  });

  it('fails closed when a reservation block would exceed the safe integer range', () => {
    const gs = new GameState();
    localStorage.setItem(
      K.ACHIEVEMENTS,
      JSON.stringify({
        ...gs.achievementRecordSnapshot(),
        nextAnalyticsEventSequence: Number.MAX_SAFE_INTEGER - 8,
      }),
    );

    const reloaded = new GameState();
    const durableJournal = localStorage.getItem(K.ACHIEVEMENTS);
    expect(
      reloaded.allocateAchievementViewEvent({ name: 'achievement_page_viewed' }),
    ).toBeNull();
    expect(localStorage.getItem(K.ACHIEVEMENTS)).toBe(durableJournal);
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
    const first = gs.achievementRecordSnapshot().progress['collection_25'];
    gs.recordDogFound('lvl-a', 'dog-1'); // same occurrence
    expect(gs.achievementRecordSnapshot().progress['collection_25']).toBe(first);
    expect(gs.achievementRecordSnapshot().processedOccurrenceIds).toContain('dog:lvl-a:dog-1');
  });
});
