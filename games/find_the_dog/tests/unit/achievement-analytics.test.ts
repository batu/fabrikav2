import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allocateAchievementViewEvent,
  buildReconciliationAnomalyEvent,
  deltaToEvents,
  parsePendingAnalyticsEvent,
  type PendingAnalyticsEvent,
} from '../../src/achievements/AchievementAnalytics';
import type { CommittedAchievementDelta } from '../../src/achievements/AchievementSystem';
import { ACHIEVEMENT_CATALOG } from '../../src/achievements/catalog';
import { analytics } from '../../src/analytics/AnalyticsService';
import { designEvent, gameAnalyticsDesignEventId, type GameAnalyticsCustomFields } from '../../src/analytics/GameAnalyticsEvents';
import { canonicalAnalyticsEvents } from '../../src/analytics/CanonicalAnalyticsEvents';

function catalogEntry(id: string) {
  const entry = ACHIEVEMENT_CATALOG.find((a) => a.id === id);
  if (entry === undefined) throw new Error(`missing catalog entry ${id}`);
  return entry;
}

function multiUnlockDelta(occurrenceId: string): CommittedAchievementDelta {
  return {
    occurrenceId,
    progressChanges: [
      { achievementId: 'completions_10', progress: 5, threshold: 10 }, // advanced, not unlocked
      { achievementId: 'first_completion', progress: 1, threshold: 1 },
      { achievementId: 'first_best', progress: 1, threshold: 1 },
    ],
    newlyUnlocked: [catalogEntry('first_completion'), catalogEntry('first_best')],
    masteredLevelIdsAdded: [],
    rewards: [
      { achievementId: 'first_completion', coins: 25, hints: 0 },
      { achievementId: 'first_best', coins: 20, hints: 0 },
    ],
  };
}

function fields(payload: object): GameAnalyticsCustomFields {
  return { ...payload } as GameAnalyticsCustomFields;
}

function trackSpy(): ReturnType<typeof vi.spyOn> {
  const sdk = (analytics as unknown as { sdk: { track: (...args: unknown[]) => void } }).sdk;
  return vi.spyOn(sdk, 'track');
}

afterEach(() => vi.restoreAllMocks());

describe('deltaToEvents (AC7)', () => {
  it('maps a delta to progress-for-non-unlocks + one unlock + one reward event, in order', () => {
    const { events, nextSequence } = deltaToEvents(multiUnlockDelta('occ-1'), 0);
    const names = events.map((e) => e.name);
    // 1 progress (completions_10) + 2 unlocked + 2 reward = 5.
    expect(names).toEqual([
      'achievement_progress',
      'achievement_unlocked',
      'achievement_unlocked',
      'achievement_reward_granted',
      'achievement_reward_granted',
    ]);
    expect(nextSequence).toBe(5);
    // Every event carries a stable, sequence-backed, snake_case event_id equal to
    // the outbox entry's structural eventId.
    for (const event of events) {
      expect(event.payload.event_id).toBe(event.eventId);
      expect(event.eventId).toMatch(/^ach:\d+:/);
      expect(event.eventId.length).toBeLessThanOrEqual(96);
    }
  });

  it('mints distinct ids for the known 32-bit shortHash collision pair (break #3)', () => {
    const a = deltaToEvents(multiUnlockDelta('completion:2155:0:synthetic-level-2155'), 0);
    const b = deltaToEvents(multiUnlockDelta('completion:11853:0:synthetic-level-11853'), a.nextSequence);
    const idsA = new Set(a.events.map((e) => e.eventId));
    for (const event of b.events) expect(idsA.has(event.eventId)).toBe(false);
  });

  it('zero-adaptation round trip: mapper payload consumed with no renaming', () => {
    const [event] = deltaToEvents(multiUnlockDelta('occ-z'), 0).events;
    // A consumer stub reads the exact declared fields.
    const consume = (p: { event_id: string; achievement_id: string; occurrence_id: string }) => p.event_id;
    expect(consume(event.payload)).toBe(event.eventId);
  });
});

describe('achievement UI view-event allocation (ACH-2 dependency)', () => {
  it('allocates collision-free, bounded, typed payloads from the owned sequence', () => {
    const viewed = allocateAchievementViewEvent(
      { name: 'achievement_viewed', achievementId: 'first_completion' },
      20,
    );
    expect(viewed).toEqual({
      event: {
        eventId: 'ach:20:viewed:first_completion',
        name: 'achievement_viewed',
        payload: {
          event_id: 'ach:20:viewed:first_completion',
          achievement_id: 'first_completion',
          occurrence_id: 'ach:20:viewed:first_completion',
          category: 'completion',
        },
      },
      nextSequence: 21,
    });

    const page = allocateAchievementViewEvent({ name: 'achievement_page_viewed' }, viewed!.nextSequence);
    expect(page?.event).toEqual({
      eventId: 'ach:21:page:achievement_system',
      name: 'achievement_page_viewed',
      payload: { event_id: 'ach:21:page:achievement_system' },
    });
    expect(page?.nextSequence).toBe(22);
    expect(new Set([viewed?.event.eventId, page?.event.eventId]).size).toBe(2);
    expect(page?.event.eventId.length).toBeLessThanOrEqual(96);
  });

  it('rejects unknown achievement ids without consuming a sequence', () => {
    expect(
      allocateAchievementViewEvent({ name: 'achievement_viewed', achievementId: 'not-in-catalog' }, 9),
    ).toBeNull();
  });
});

describe('dispatchAchievementEvent (correction 1)', () => {
  it('routes each achievement event to its typed sdk.track name', () => {
    const spy = trackSpy();
    const events: PendingAnalyticsEvent[] = deltaToEvents(multiUnlockDelta('occ-d'), 0).events;
    for (const event of events) analytics.dispatchAchievementEvent(event);
    const trackedNames = spy.mock.calls.map((c: unknown[]) => c[0]);
    expect(trackedNames).toContain('achievement_progress');
    expect(trackedNames).toContain('achievement_unlocked');
    expect(trackedNames).toContain('achievement_reward_granted');
  });

  it('routes the system-scoped reconciliation anomaly', () => {
    const spy = trackSpy();
    const { event } = buildReconciliationAnomalyEvent('occ-x', 'coins', 7);
    analytics.dispatchAchievementEvent(event);
    expect(spy).toHaveBeenCalledWith(
      'achievement_reconciliation_anomaly',
      expect.objectContaining({ wallet_component: 'coins', achievement_id: 'achievement_system' }),
    );
  });

  it('exposes typed discovery and page-view methods for the dependent UI card', () => {
    const spy = trackSpy();
    analytics.achievementViewed({
      event_id: 'ach:20:viewed:first_completion',
      achievement_id: 'first_completion',
      occurrence_id: 'view:first_completion',
      category: 'completion',
    });
    analytics.achievementPageViewed({ event_id: 'ach:21:page:achievement_system' });
    expect(spy).toHaveBeenCalledWith('achievement_viewed', expect.objectContaining({ achievement_id: 'first_completion' }));
    expect(spy).toHaveBeenCalledWith('achievement_page_viewed', { event_id: 'ach:21:page:achievement_system' });
  });

  it('dispatches allocated view events without payload adaptation', () => {
    const spy = trackSpy();
    const viewed = allocateAchievementViewEvent(
      { name: 'achievement_viewed', achievementId: 'first_completion' },
      30,
    );
    const page = allocateAchievementViewEvent({ name: 'achievement_page_viewed' }, 31);
    analytics.dispatchAchievementEvent(viewed!.event);
    analytics.dispatchAchievementEvent(page!.event);
    expect(spy).toHaveBeenCalledWith('achievement_viewed', viewed!.event.payload);
    expect(spy).toHaveBeenCalledWith('achievement_page_viewed', page!.event.payload);
  });
});

describe('parsePendingAnalyticsEvent', () => {
  it('round-trips each owned persisted event shape', () => {
    const events = deltaToEvents(multiUnlockDelta('occ-parse'), 0).events;
    const anomaly = buildReconciliationAnomalyEvent('occ-parse', 'coins', events.length).event;
    for (const event of [...events, anomaly]) {
      expect(parsePendingAnalyticsEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
    }
  });

  it.each([
    { eventId: 'ach:1:x:y', name: 'unknown', payload: { event_id: 'ach:1:x:y' } },
    {
      eventId: 'ach:1:progress:first_completion',
      name: 'achievement_progress',
      payload: {
        event_id: 'different', achievement_id: 'first_completion', occurrence_id: 'occ',
        category: 'completion', progress: 1, threshold: 1,
      },
    },
    {
      eventId: 'ach:1:reward:first_completion',
      name: 'achievement_reward_granted',
      payload: {
        event_id: 'ach:1:reward:first_completion', achievement_id: 'first_completion',
        occurrence_id: 'occ', category: 'completion', reward_coins: 25,
      },
    },
  ])('rejects malformed or mismatched durable outbox entry %#', (value) => {
    expect(parsePendingAnalyticsEvent(value)).toBeNull();
  });
});

describe('GameAnalytics wire field survival (break #3, correction 2)', () => {
  it('carries achievement_id/event_id/progress/threshold through the design mapping (not {})', () => {
    const [, unlock] = deltaToEvents(multiUnlockDelta('occ-1'), 0).events;
    const ga = designEvent(gameAnalyticsDesignEventId(unlock.name, fields(unlock.payload)), fields(unlock.payload));
    expect(ga.customFields).toHaveProperty('achievement_id');
    expect(ga.customFields).toHaveProperty('event_id', unlock.payload.event_id);
    expect(ga.customFields).toHaveProperty('threshold');
    expect(Object.keys(ga.customFields ?? {}).length).toBeGreaterThan(0);
  });

  it('reward fields survive', () => {
    const events = deltaToEvents(multiUnlockDelta('occ-1'), 0).events;
    const reward = events.find((e) => e.name === 'achievement_reward_granted')!;
    const ga = designEvent(gameAnalyticsDesignEventId(reward.name, fields(reward.payload)), fields(reward.payload));
    expect(ga.customFields).toHaveProperty('reward_coins');
    expect(ga.customFields).toHaveProperty('achievement_id');
  });

  it('anomaly wallet_component survives compaction (break #3)', () => {
    const { event } = buildReconciliationAnomalyEvent('occ-x', 'hintsGranted', 0);
    const ga = designEvent(gameAnalyticsDesignEventId(event.name, fields(event.payload)), fields(event.payload));
    expect(ga.customFields).toHaveProperty('wallet_component', 'hintsGranted');
  });

  it('later-UI page-view ids resolve (correction 5)', () => {
    const viewed = designEvent(gameAnalyticsDesignEventId('achievement_viewed', { event_id: 'ach:1:x:y' }), {
      event_id: 'ach:1:x:y',
      achievement_id: 'first_completion',
    });
    expect(ga(viewed)).toContain('event_id');
    const page = designEvent(gameAnalyticsDesignEventId('achievement_page_viewed', { event_id: 'ach:2:x:y' }), {
      event_id: 'ach:2:x:y',
    });
    expect(ga(page)).toContain('event_id');
  });
});

function ga(event: ReturnType<typeof designEvent>): string[] {
  return Object.keys(event.customFields ?? {});
}

describe('canonical contract', () => {
  it('achievement events are registered and runtime-instrumented', () => {
    const byId = new Map(canonicalAnalyticsEvents.map((e) => [e.id, e]));
    for (const id of ['achievement_progress', 'achievement_unlocked', 'achievement_reward_granted', 'achievement_reconciliation_anomaly'] as const) {
      expect(byId.get(id)?.instrumentationStatus).toBe('runtime');
    }
    for (const id of ['achievement_viewed', 'achievement_page_viewed'] as const) {
      expect(byId.get(id)?.instrumentationStatus).toBe('contract');
    }
  });
});
