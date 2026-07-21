// Owned achievement analytics contract (card ACH-1, U6 / KTD6).
//
// This module owns the payload types the later UI card imports with ZERO
// adaptation, the durable-outbox `PendingAnalyticsEvent` discriminated union, and
// the pure `deltaToEvents` mapper. Every wire field is snake_case (`event_id`,
// `achievement_id`, …) because the GameAnalytics compaction filters on the exact
// snake_case allow-list key.

import { ACHIEVEMENT_CATALOG } from './catalog';
import type { CommittedAchievementDelta } from './AchievementSystem';

/** The reserved sentinel for the system-scoped reconciliation anomaly (not a real
 *  catalog achievement — a settlement may aggregate multiple unlocks). */
export const ACHIEVEMENT_SYSTEM_ID = 'achievement_system';

export type AchievementEventName =
  | 'achievement_progress'
  | 'achievement_unlocked'
  | 'achievement_reward_granted'
  | 'achievement_reconciliation_anomaly';

interface AchievementAnalyticsBase {
  /** Stable, durable, bounded id: `ach:<sequence>:<eventKind>:<achievementId>`. */
  readonly event_id: string;
  readonly achievement_id: string;
  readonly occurrence_id: string;
  readonly category: string;
}

export interface AchievementProgressPayload extends AchievementAnalyticsBase {
  readonly progress: number;
  readonly threshold: number;
}

export interface AchievementUnlockedPayload extends AchievementAnalyticsBase {
  readonly threshold: number;
}

export interface AchievementRewardGrantedPayload extends AchievementAnalyticsBase {
  readonly reward_coins: number;
  readonly reward_hints: number;
}

export interface AchievementReconciliationAnomalyPayload extends AchievementAnalyticsBase {
  /** Names the torn wallet component (coins | hints | coinsGranted | …). */
  readonly wallet_component: string;
}

export type AchievementAnalyticsPayload =
  | AchievementProgressPayload
  | AchievementUnlockedPayload
  | AchievementRewardGrantedPayload
  | AchievementReconciliationAnomalyPayload;

/**
 * The durable outbox entry — a discriminated union on `name` (each member couples
 * its literal name with its exact payload type). `switch (event.name)` narrows
 * `event.payload` so the typed dispatcher's arms type-check.
 */
export type PendingAnalyticsEvent =
  | { readonly eventId: string; readonly name: 'achievement_progress'; readonly payload: AchievementProgressPayload }
  | { readonly eventId: string; readonly name: 'achievement_unlocked'; readonly payload: AchievementUnlockedPayload }
  | { readonly eventId: string; readonly name: 'achievement_reward_granted'; readonly payload: AchievementRewardGrantedPayload }
  | { readonly eventId: string; readonly name: 'achievement_reconciliation_anomaly'; readonly payload: AchievementReconciliationAnomalyPayload };

const CATEGORY_BY_ID: ReadonlyMap<string, string> = new Map(
  ACHIEVEMENT_CATALOG.map((achievement) => [achievement.id, achievement.category]),
);

function categoryFor(achievementId: string): string {
  return CATEGORY_BY_ID.get(achievementId) ?? 'unknown';
}

function eventId(sequence: number, kind: string, achievementId: string): string {
  return `ach:${sequence}:${kind}:${achievementId}`;
}

/**
 * PURE mapper. Turns a committed delta into the full analytics event list, minting
 * one durable sequence-backed id per event (drawing consecutive values from
 * `startSequence`). Emits:
 * - one `achievement_progress` per progressChange that did NOT unlock this occurrence,
 * - one `achievement_unlocked` per newlyUnlocked (catalog order),
 * - one `achievement_reward_granted` per granted reward (reads `GrantedReward.achievementId`).
 * Returns the events and the advanced counter so checkpoint 1 persists both together.
 */
export function deltaToEvents(
  delta: CommittedAchievementDelta,
  startSequence: number,
): { events: PendingAnalyticsEvent[]; nextSequence: number } {
  const events: PendingAnalyticsEvent[] = [];
  let sequence = startSequence;

  const unlockedIds = new Set(delta.newlyUnlocked.map((a) => a.id));

  for (const change of delta.progressChanges) {
    if (unlockedIds.has(change.achievementId)) continue; // unlock event covers crossings
    const id = eventId(sequence, 'progress', change.achievementId);
    sequence += 1;
    events.push({
      eventId: id,
      name: 'achievement_progress',
      payload: {
        event_id: id,
        achievement_id: change.achievementId,
        occurrence_id: delta.occurrenceId,
        category: categoryFor(change.achievementId),
        progress: change.progress,
        threshold: change.threshold,
      },
    });
  }

  for (const achievement of delta.newlyUnlocked) {
    const id = eventId(sequence, 'unlocked', achievement.id);
    sequence += 1;
    events.push({
      eventId: id,
      name: 'achievement_unlocked',
      payload: {
        event_id: id,
        achievement_id: achievement.id,
        occurrence_id: delta.occurrenceId,
        category: achievement.category,
        threshold: achievement.threshold,
      },
    });
  }

  for (const reward of delta.rewards) {
    const id = eventId(sequence, 'reward', reward.achievementId);
    sequence += 1;
    events.push({
      eventId: id,
      name: 'achievement_reward_granted',
      payload: {
        event_id: id,
        achievement_id: reward.achievementId,
        occurrence_id: delta.occurrenceId,
        category: categoryFor(reward.achievementId),
        reward_coins: reward.coins,
        reward_hints: reward.hints,
      },
    });
  }

  return { events, nextSequence: sequence };
}

/**
 * Build the system-scoped reconciliation-anomaly outbox event (correction 4).
 * Not tied to any single unlock — reserves `achievement_system` and a
 * sequence-backed `ach:<sequence>:reconciliation:achievement_system` id.
 */
export function buildReconciliationAnomalyEvent(
  occurrenceId: string,
  walletComponent: string,
  startSequence: number,
): { event: PendingAnalyticsEvent; nextSequence: number } {
  const id = eventId(startSequence, 'reconciliation', ACHIEVEMENT_SYSTEM_ID);
  return {
    nextSequence: startSequence + 1,
    event: {
      eventId: id,
      name: 'achievement_reconciliation_anomaly',
      payload: {
        event_id: id,
        achievement_id: ACHIEVEMENT_SYSTEM_ID,
        occurrence_id: occurrenceId,
        category: 'system',
        wallet_component: walletComponent,
      },
    },
  };
}
