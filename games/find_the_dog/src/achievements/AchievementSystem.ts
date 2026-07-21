// Durable achievement domain authority for Find the Dog (card ACH-1).
//
// This module is the CONTRACT OWNER. It is a PURE domain module: it performs no
// I/O and no wallet mutation. It turns trustworthy typed facts (produced by
// GameState) into an immutable `AchievementDelta`; GameState applies post-cap
// wallet effects, persists the versioned `AchievementRecord`, and emits analytics.
// The later UI card consumes the returned `CommittedAchievementDelta` with zero
// adaptation.
//
// See docs/plans/2026-07-21-001-feat-ftd-achievement-domain-plan.md.

import type { WalletCounters } from '../core/GameState';
import type { PendingAnalyticsEvent } from './AchievementAnalytics';
import { ACHIEVEMENT_CATALOG, orderedAchievements, type Achievement } from './catalog';

export type { Achievement };
export { ACHIEVEMENT_CATALOG, orderedAchievements };

/** The current persisted `AchievementRecord.version`. Bump when the record shape
 *  changes in a way migration must upgrade. */
export const ACHIEVEMENT_RECORD_VERSION = 1;

/** Display grouping for an achievement. */
export type AchievementCategory =
  | 'completion'
  | 'progression'
  | 'dogs'
  | 'mastery'
  | 'streak';

/**
 * AC5 — explicit completion semantics. `milestoneKind` distinguishes:
 * - 'occurrence-count'    — counts discrete accepted occurrences (completions, dog finds, bests)
 * - 'logical-progression' — distinct LOGICAL levels mastered (fallback-stable identity)
 * - 'temporal'            — day-based streak milestones
 */
export type MilestoneKind = 'occurrence-count' | 'logical-progression' | 'temporal';

/**
 * Which fact field advances an achievement. Determines both which fact type is
 * relevant and how `apply()` computes the new cumulative progress value.
 */
export type ProgressSource =
  | 'totalCompletions' // absolute count from LevelCompletionFact.totalCompletions
  | 'personalBests' // +1 per LevelCompletionFact whose newBest is true
  | 'masteredLevels' // size of the persisted distinct logical-level set
  | 'streakDays' // high-water mark of LevelCompletionFact.streakDays
  | 'lifetimeDogs'; // +1 per accepted DogFoundFact

/** Modest existing-economy reward. Coins uncapped; hints respect MAX_HINT_BALANCE. */
export interface EntitledReward {
  coins?: number;
  hints?: number;
}

/**
 * Accepted dog-found occurrence. Attempt memory + analytics only in the game;
 * carries a stable, non-farmable occurrence identity. No historical count.
 */
export interface DogFoundFact {
  readonly kind: 'dog-found';
  /** Stable dedupe id: `dog:<servedLevelId>:<dogId>`. */
  readonly occurrenceId: string;
  readonly levelId: string;
  readonly dogId: string;
}

/**
 * Accepted level completion. Built by GameState's documented builder mapping from
 * the real `CompletionTransaction` + freshly-registered totals/streak (U3).
 */
export interface LevelCompletionFact {
  readonly kind: 'level-completion';
  /** Dedupe id: the completion transaction `id`. */
  readonly occurrenceId: string;
  readonly transactionId: string;
  /** Durable LOGICAL distinct-level key (intendedLevelId ?? levelId) — mastery counts this. */
  readonly masteryLevelId: string;
  /** Actually-served level id — for serving/fallback analytics only. */
  readonly servedLevelId: string;
  readonly progressionIndex: number;
  readonly totalCompletions: number;
  readonly streakDays: number;
  readonly timeSeconds: number;
  readonly previousBestSeconds?: number;
  readonly newBest: boolean;
  readonly sequenceVersion?: string | null;
  readonly fallbackReason?: string | null;
}

export type AchievementFact = DogFoundFact | LevelCompletionFact;

/** A single achievement's progress advance for this occurrence. */
export interface AchievementProgressChange {
  readonly achievementId: string;
  readonly progress: number;
  readonly threshold: number;
}

/**
 * The ACTUALLY-APPLIED reward for one unlock (hints post-cap, possibly 0), tagged
 * with its earning `achievementId`. Lives only on the committed delta GameState
 * returns — the pure `apply()` output carries the catalog `entitledReward` instead.
 */
export interface GrantedReward {
  readonly achievementId: string;
  readonly coins: number;
  readonly hints: number;
}

/**
 * Pure output of `apply()`. Immutable. Self-sufficient for record folding:
 * `masteredLevelIdsAdded` is derived here so `applyDeltaToRecord` needs no fact.
 */
export interface AchievementDelta {
  readonly occurrenceId: string;
  readonly progressChanges: readonly AchievementProgressChange[];
  readonly newlyUnlocked: readonly Achievement[];
  readonly masteredLevelIdsAdded: readonly string[];
}

/**
 * The single owned consumer shape (caller, UI card, analytics). Extends the pure
 * delta with post-cap applied rewards tagged by `achievementId`.
 */
export interface CommittedAchievementDelta extends AchievementDelta {
  readonly rewards: readonly GrantedReward[];
}

/** Narrow, settlement-only absolute wallet snapshot (reuses WalletCounters exactly). */
export interface SettlementSnapshot {
  readonly coins: number;
  readonly hints: number;
  readonly counters: WalletCounters;
}

/** The single in-flight write-ahead settlement (KTD2). Null when idle. */
export interface PendingSettlement {
  readonly occurrenceId: string;
  readonly before: SettlementSnapshot;
  readonly after: SettlementSnapshot;
}

/**
 * The durable journal — one localStorage key (`ftd_achievements`). Its internal
 * fields are mutually consistent by construction (per-key writes are atomic).
 */
export interface AchievementRecord {
  readonly version: number;
  readonly progress: Readonly<Record<string, number>>;
  /** Persisted distinct LOGICAL-level identity set — mastery progress is its size. */
  readonly masteredLevelIds: readonly string[];
  readonly unlocked: readonly string[];
  readonly processedOccurrenceIds: readonly string[];
  readonly pendingSettlement: PendingSettlement | null;
  readonly analyticsOutbox: readonly PendingAnalyticsEvent[];
  /** Monotonic counter minting durable, collision-free analytics event ids. */
  readonly nextAnalyticsEventSequence: number;
}

/** The derivable durable state migration is allowed to read (KTD5). */
export interface MigrationDerivableState {
  readonly totalCompletions: number;
  readonly streakDays: number;
}

export function emptyAchievementRecord(): AchievementRecord {
  return {
    version: ACHIEVEMENT_RECORD_VERSION,
    progress: {},
    masteredLevelIds: [],
    unlocked: [],
    processedOccurrenceIds: [],
    pendingSettlement: null,
    analyticsOutbox: [],
    nextAnalyticsEventSequence: 0,
  };
}

function clampNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function currentProgress(record: AchievementRecord, id: string): number {
  const value = record.progress[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function masteredCount(record: AchievementRecord, added: readonly string[]): number {
  return record.masteredLevelIds.length + added.length;
}

/**
 * Compute the new cumulative progress an achievement would hold after this fact,
 * or `null` when the fact is irrelevant to the achievement.
 */
function computeProgress(
  achievement: Achievement,
  fact: AchievementFact,
  record: AchievementRecord,
  masteredLevelIdsAdded: readonly string[],
): number | null {
  switch (achievement.progressSource) {
    case 'totalCompletions':
      return fact.kind === 'level-completion' ? Math.max(0, Math.floor(fact.totalCompletions)) : null;
    case 'personalBests':
      return fact.kind === 'level-completion'
        ? currentProgress(record, achievement.id) + (fact.newBest ? 1 : 0)
        : null;
    case 'masteredLevels':
      return fact.kind === 'level-completion' ? masteredCount(record, masteredLevelIdsAdded) : null;
    case 'streakDays':
      return fact.kind === 'level-completion'
        ? Math.max(currentProgress(record, achievement.id), Math.max(0, Math.floor(fact.streakDays)))
        : null;
    case 'lifetimeDogs':
      return fact.kind === 'dog-found' ? currentProgress(record, achievement.id) + 1 : null;
  }
}

/**
 * PURE authority. Given a fact and the current record, return the immutable delta:
 * progress changes, newly-unlocked achievements (catalog order, with entitled
 * reward), and the derived mastery additions. No I/O, no wallet, no dedupe (the
 * caller guards `processedOccurrenceIds`).
 */
export function apply(fact: AchievementFact, record: AchievementRecord): AchievementDelta {
  // Forward-only logical mastery: on EVERY accepted completion add masteryLevelId
  // iff not already mastered — independent of newBest. Never for dog-found.
  const masteredLevelIdsAdded: string[] =
    fact.kind === 'level-completion' && !record.masteredLevelIds.includes(fact.masteryLevelId)
      ? [fact.masteryLevelId]
      : [];

  const progressChanges: AchievementProgressChange[] = [];
  const newlyUnlocked: Achievement[] = [];

  for (const achievement of orderedAchievements()) {
    const next = computeProgress(achievement, fact, record, masteredLevelIdsAdded);
    if (next === null) continue;
    const previous = currentProgress(record, achievement.id);
    if (next !== previous) {
      progressChanges.push({ achievementId: achievement.id, progress: next, threshold: achievement.threshold });
    }
    const alreadyUnlocked = record.unlocked.includes(achievement.id);
    if (!alreadyUnlocked && next >= achievement.threshold) {
      newlyUnlocked.push(achievement);
    }
  }

  return {
    occurrenceId: fact.occurrenceId,
    progressChanges,
    newlyUnlocked,
    masteredLevelIdsAdded,
  };
}

/**
 * PURE record fold (correction 3). Produces the next record by folding EVERY
 * progressChange into `progress[id]`, adding `newlyUnlocked` ids to `unlocked`,
 * adding `delta.masteredLevelIdsAdded` to `masteredLevelIds`, and appending the
 * occurrence to `processedOccurrenceIds` — all together, with NO fact dependency.
 * It never touches pendingSettlement / analyticsOutbox / nextAnalyticsEventSequence
 * / wallet (those are GameState's). The input record is not mutated.
 */
export function applyDeltaToRecord(record: AchievementRecord, delta: AchievementDelta): AchievementRecord {
  const progress: Record<string, number> = { ...record.progress };
  for (const change of delta.progressChanges) {
    progress[change.achievementId] = change.progress;
  }

  const unlocked = [...record.unlocked];
  for (const achievement of delta.newlyUnlocked) {
    if (!unlocked.includes(achievement.id)) unlocked.push(achievement.id);
  }

  const masteredLevelIds = [...record.masteredLevelIds];
  for (const levelId of delta.masteredLevelIdsAdded) {
    if (!masteredLevelIds.includes(levelId)) masteredLevelIds.push(levelId);
  }

  const processedOccurrenceIds = record.processedOccurrenceIds.includes(delta.occurrenceId)
    ? [...record.processedOccurrenceIds]
    : [...record.processedOccurrenceIds, delta.occurrenceId];

  return {
    ...record,
    progress,
    masteredLevelIds,
    unlocked,
    processedOccurrenceIds,
  };
}

/**
 * KTD5 — migration/backfill. Builds/upgrades a record from ONLY durable derivable
 * state (`totalCompletions`, `streakDays`). Grants NO retroactive reward
 * (correction 7): derivable milestones are marked `unlocked` with progress set,
 * but no pendingSettlement, no wallet mutation, no reward event — so a later live
 * fact for a migrated achievement cannot mint its catalog reward. Mastery and
 * lifetime-dog facts are NOT backfilled (final correction) — they begin from this
 * release forward. Idempotent occurrence `migration:v<N>`.
 */
export function migrate(
  derivable: MigrationDerivableState,
  existing?: AchievementRecord,
): AchievementRecord {
  const base = existing ?? emptyAchievementRecord();
  const totalCompletions = clampNonNegativeInt(derivable.totalCompletions);
  const streakDays = clampNonNegativeInt(derivable.streakDays);

  const progress: Record<string, number> = { ...base.progress };
  const unlocked = [...base.unlocked];

  for (const achievement of orderedAchievements()) {
    let derivedProgress: number | null = null;
    if (achievement.progressSource === 'totalCompletions') derivedProgress = totalCompletions;
    else if (achievement.progressSource === 'streakDays') derivedProgress = streakDays;
    if (derivedProgress === null) continue; // dogs / mastery / personalBests are non-derivable

    // Keep the higher of any already-persisted progress and the derived value so a
    // version bump never regresses an existing unlock.
    const merged = Math.max(currentProgress(base, achievement.id), derivedProgress);
    progress[achievement.id] = merged;
    if (merged >= achievement.threshold && !unlocked.includes(achievement.id)) {
      unlocked.push(achievement.id);
    }
  }

  const occurrenceId = `migration:v${ACHIEVEMENT_RECORD_VERSION}`;
  const processedOccurrenceIds = base.processedOccurrenceIds.includes(occurrenceId)
    ? [...base.processedOccurrenceIds]
    : [...base.processedOccurrenceIds, occurrenceId];

  return {
    version: ACHIEVEMENT_RECORD_VERSION,
    progress,
    // Mastery is forward-only and never backfilled from served best-times.
    masteredLevelIds: [...base.masteredLevelIds],
    unlocked,
    processedOccurrenceIds,
    pendingSettlement: base.pendingSettlement,
    analyticsOutbox: [...base.analyticsOutbox],
    nextAnalyticsEventSequence: sanitizeSequence(base),
  };
}

/**
 * Repair `nextAnalyticsEventSequence` to one past the max sequence already present
 * in the journaled outbox (so a recovered outbox never re-mints a live id), or 0
 * when fresh. Absent/NaN/negative counters are treated as 0 before the max.
 */
export function sanitizeSequence(record: AchievementRecord): number {
  const stored =
    typeof record.nextAnalyticsEventSequence === 'number' &&
    Number.isFinite(record.nextAnalyticsEventSequence) &&
    record.nextAnalyticsEventSequence >= 0
      ? Math.floor(record.nextAnalyticsEventSequence)
      : 0;
  let maxOutbox = 0;
  for (const event of record.analyticsOutbox) {
    const seq = sequenceFromEventId(event.eventId);
    if (seq + 1 > maxOutbox) maxOutbox = seq + 1;
  }
  return Math.max(stored, maxOutbox);
}

/** Parse the `<sequence>` out of an `ach:<sequence>:<kind>:<id>` event id. */
export function sequenceFromEventId(eventId: string): number {
  const match = /^ach:(\d+):/.exec(eventId);
  if (match === null) return 0;
  const seq = Number(match[1]);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
}
