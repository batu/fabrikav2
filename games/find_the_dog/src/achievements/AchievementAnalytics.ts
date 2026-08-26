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

/** Typed discovery/view contracts owned by the achievement domain. */
export type AchievementViewedPayload = AchievementAnalyticsBase;

export interface AchievementPageViewedPayload {
  readonly event_id: string;
}

export type AchievementViewEventRequest =
  | { readonly name: 'achievement_viewed'; readonly achievementId: string }
  | { readonly name: 'achievement_page_viewed' };

/** UI-ready event returned by the owned allocator; no payload adaptation needed. */
export type AchievementViewEvent =
  | {
      readonly eventId: string;
      readonly name: 'achievement_viewed';
      readonly payload: AchievementViewedPayload;
    }
  | {
      readonly eventId: string;
      readonly name: 'achievement_page_viewed';
      readonly payload: AchievementPageViewedPayload;
    };

export interface AchievementViewEventAllocation {
  readonly event: AchievementViewEvent;
  readonly nextSequence: number;
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

function analyticsBase(value: unknown, eventId: string): AchievementAnalyticsBase | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.event_id !== eventId) return null;
  if (typeof record.achievement_id !== 'string' || record.achievement_id.length === 0) return null;
  if (typeof record.occurrence_id !== 'string' || record.occurrence_id.length === 0) return null;
  if (typeof record.category !== 'string' || record.category.length === 0) return null;
  return {
    event_id: eventId,
    achievement_id: record.achievement_id,
    occurrence_id: record.occurrence_id,
    category: record.category,
  };
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Fail-closed parser for the durable analytics outbox. The TypeScript union is
 * not evidence that persisted JSON has the same shape, so validate the name,
 * its coupled payload, and the duplicated event id before dispatch.
 */
export function parsePendingAnalyticsEvent(value: unknown): PendingAnalyticsEvent | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.eventId !== 'string' || record.eventId.length === 0) return null;
  const base = analyticsBase(record.payload, record.eventId);
  if (base === null) return null;
  const payload = record.payload as Record<string, unknown>;

  switch (record.name) {
    case 'achievement_progress':
      if (!nonNegativeNumber(payload.progress) || !nonNegativeNumber(payload.threshold)) return null;
      return {
        eventId: record.eventId,
        name: record.name,
        payload: { ...base, progress: payload.progress, threshold: payload.threshold },
      };
    case 'achievement_unlocked':
      if (!nonNegativeNumber(payload.threshold)) return null;
      return {
        eventId: record.eventId,
        name: record.name,
        payload: { ...base, threshold: payload.threshold },
      };
    case 'achievement_reward_granted':
      if (!nonNegativeNumber(payload.reward_coins) || !nonNegativeNumber(payload.reward_hints)) return null;
      return {
        eventId: record.eventId,
        name: record.name,
        payload: {
          ...base,
          reward_coins: payload.reward_coins,
          reward_hints: payload.reward_hints,
        },
      };
    case 'achievement_reconciliation_anomaly':
      if (typeof payload.wallet_component !== 'string' || payload.wallet_component.length === 0) return null;
      return {
        eventId: record.eventId,
        name: record.name,
        payload: { ...base, wallet_component: payload.wallet_component },
      };
    default:
      return null;
  }
}

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
 * Pure half of the UI analytics allocator. GameState persists `nextSequence`
 * before returning the event, making IDs collision-free across relaunches and
 * shared with domain/outbox IDs. Unknown catalog IDs consume no sequence.
 */
export function allocateAchievementViewEvent(
  request: AchievementViewEventRequest,
  startSequence: number,
): AchievementViewEventAllocation | null {
  if (!Number.isSafeInteger(startSequence) || startSequence < 0 || startSequence >= Number.MAX_SAFE_INTEGER) {
    return null;
  }
  if (request.name === 'achievement_page_viewed') {
    const id = eventId(startSequence, 'page', ACHIEVEMENT_SYSTEM_ID);
    return {
      event: { eventId: id, name: request.name, payload: { event_id: id } },
      nextSequence: startSequence + 1,
    };
  }

  const category = CATEGORY_BY_ID.get(request.achievementId);
  if (category === undefined) return null;
  const id = eventId(startSequence, 'viewed', request.achievementId);
  return {
    event: {
      eventId: id,
      name: request.name,
      payload: {
        event_id: id,
        achievement_id: request.achievementId,
        occurrence_id: id,
        category,
      },
    },
    nextSequence: startSequence + 1,
  };
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
