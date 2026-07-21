import { describe, expect, it } from 'vitest';
import {
  apply,
  applyDeltaToRecord,
  emptyAchievementRecord,
  orderedAchievements,
  type AchievementRecord,
  type DogFoundFact,
  type LevelCompletionFact,
} from '../../src/achievements/AchievementSystem';
import {
  ACHIEVEMENT_CATALOG,
  MAX_ACHIEVEMENT_ID_LENGTH,
  catalogRewardTotals,
} from '../../src/achievements/catalog';

function completion(overrides: Partial<LevelCompletionFact> = {}): LevelCompletionFact {
  return {
    kind: 'level-completion',
    occurrenceId: 'completion:1:0:level-a',
    transactionId: 'completion:1:0:level-a',
    masteryLevelId: 'level-a',
    servedLevelId: 'level-a',
    progressionIndex: 0,
    totalCompletions: 1,
    streakDays: 1,
    timeSeconds: 20,
    newBest: true,
    ...overrides,
  };
}

function dogFound(occurrenceId: string): DogFoundFact {
  return { kind: 'dog-found', occurrenceId, levelId: 'level-a', dogId: occurrenceId };
}

describe('achievement catalog (AC1)', () => {
  it('has unique stable ids and a total order', () => {
    const ids = new Set(ACHIEVEMENT_CATALOG.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENT_CATALOG.length);
    const orders = ACHIEVEMENT_CATALOG.map((a) => a.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('orderedAchievements() is deterministic and sorted by order', () => {
    const first = orderedAchievements();
    const second = orderedAchievements();
    expect(first).toBe(second); // cached, stable reference
    const orders = first.map((a) => a.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('every id is bounded so analytics event ids stay <=96 (break #3)', () => {
    for (const achievement of ACHIEVEMENT_CATALOG) {
      expect(achievement.id.length).toBeLessThanOrEqual(MAX_ACHIEVEMENT_ID_LENGTH);
    }
  });

  it('reward totals stay modest (AC6)', () => {
    const totals = catalogRewardTotals();
    expect(totals.coins).toBeLessThanOrEqual(800);
    expect(totals.hints).toBeLessThanOrEqual(20);
  });
});

describe('apply() progress + threshold (AC2)', () => {
  it('below threshold advances progress, unlocks nothing, grants nothing', () => {
    const delta = apply(completion({ totalCompletions: 3 }), emptyAchievementRecord());
    const completions10 = delta.progressChanges.find((c) => c.achievementId === 'completions_10');
    expect(completions10?.progress).toBe(3);
    expect(delta.newlyUnlocked.map((a) => a.id)).not.toContain('completions_10');
  });

  it('crossing a threshold returns the achievement with its catalog entitledReward', () => {
    const delta = apply(completion({ totalCompletions: 1 }), emptyAchievementRecord());
    const unlocked = delta.newlyUnlocked.find((a) => a.id === 'first_completion');
    expect(unlocked).toBeDefined();
    expect(unlocked?.entitledReward).toEqual({ coins: 25 });
    // The PURE delta carries no applied rewards[] — that is the committed delta's job.
    expect((delta as { rewards?: unknown }).rewards).toBeUndefined();
  });

  it('threshold exactly-met vs off-by-one', () => {
    const under = apply(completion({ totalCompletions: 9 }), emptyAchievementRecord());
    expect(under.newlyUnlocked.map((a) => a.id)).not.toContain('completions_10');
    const exact = apply(completion({ totalCompletions: 10 }), emptyAchievementRecord());
    expect(exact.newlyUnlocked.map((a) => a.id)).toContain('completions_10');
  });

  it('multiple thresholds crossed by one fact are returned in catalog order', () => {
    const delta = apply(completion({ totalCompletions: 10 }), emptyAchievementRecord());
    const ids = delta.newlyUnlocked.map((a) => a.id);
    expect(ids).toContain('first_completion');
    expect(ids).toContain('completions_10');
    expect(ids.indexOf('first_completion')).toBeLessThan(ids.indexOf('completions_10'));
  });

  it('streak milestone uses the fact streakDays', () => {
    const delta = apply(completion({ streakDays: 3 }), emptyAchievementRecord());
    expect(delta.newlyUnlocked.map((a) => a.id)).toContain('streak_3');
  });

  it('already-unlocked achievement is not re-reported', () => {
    const record: AchievementRecord = { ...emptyAchievementRecord(), unlocked: ['first_completion'] };
    const delta = apply(completion({ totalCompletions: 1 }), record);
    expect(delta.newlyUnlocked.map((a) => a.id)).not.toContain('first_completion');
  });
});

describe('applyDeltaToRecord (correction 3)', () => {
  it('folds progress, unlocks, and processed without mutating the input', () => {
    const record = emptyAchievementRecord();
    const delta = apply(completion({ totalCompletions: 3, occurrenceId: 'occ-1' }), record);
    const next = applyDeltaToRecord(record, delta);
    expect(next.progress['completions_10']).toBe(3);
    expect(next.processedOccurrenceIds).toContain('occ-1');
    expect(record.progress['completions_10']).toBeUndefined(); // input not mutated

    // Feeding the returned record back continues from the folded progress.
    const delta2 = apply(completion({ totalCompletions: 10, occurrenceId: 'occ-2' }), next);
    expect(delta2.newlyUnlocked.map((a) => a.id)).toContain('completions_10');
  });

  it('lifetime dog progress accumulates across occurrences', () => {
    let record = emptyAchievementRecord();
    for (let i = 0; i < 25; i += 1) {
      const delta = apply(dogFound(`dog:level-a:d${i}`), record);
      record = applyDeltaToRecord(record, delta);
    }
    expect(record.progress['dogs_25']).toBe(25);
    expect(record.unlocked).toContain('dogs_25');
  });
});

describe('mastery (break #1 + split identity)', () => {
  it('mastery additions ride on the delta, folded without the fact', () => {
    const record = emptyAchievementRecord();
    const delta = apply(completion({ masteryLevelId: 'level-a' }), record);
    expect(delta.masteredLevelIdsAdded).toEqual(['level-a']);
    const next = applyDeltaToRecord(record, delta);
    expect(next.masteredLevelIds).toEqual(['level-a']);
  });

  it('is added on every accepted completion, independent of newBest', () => {
    const delta = apply(completion({ masteryLevelId: 'level-x', newBest: false }), emptyAchievementRecord());
    expect(delta.masteredLevelIdsAdded).toEqual(['level-x']);
  });

  it('a repeat completion of a mastered level adds nothing', () => {
    const record: AchievementRecord = { ...emptyAchievementRecord(), masteredLevelIds: ['level-a'] };
    const delta = apply(completion({ masteryLevelId: 'level-a' }), record);
    expect(delta.masteredLevelIdsAdded).toEqual([]);
  });

  it('keys on masteryLevelId, not servedLevelId', () => {
    let record = emptyAchievementRecord();
    // (a) two intended levels sharing one fallback servedLevelId count as two.
    for (const intended of ['intended-1', 'intended-2']) {
      const delta = apply(
        completion({ masteryLevelId: intended, servedLevelId: 'fallback-x', occurrenceId: `occ-${intended}` }),
        record,
      );
      record = applyDeltaToRecord(record, delta);
    }
    expect(record.masteredLevelIds).toEqual(['intended-1', 'intended-2']);

    // (b) one intended level served by several servedLevelIds counts once.
    let record2 = emptyAchievementRecord();
    for (const served of ['served-a', 'served-b', 'served-c']) {
      const delta = apply(
        completion({ masteryLevelId: 'intended-9', servedLevelId: served, occurrenceId: `occ-${served}` }),
        record2,
      );
      record2 = applyDeltaToRecord(record2, delta);
    }
    expect(record2.masteredLevelIds).toEqual(['intended-9']);
  });
});
