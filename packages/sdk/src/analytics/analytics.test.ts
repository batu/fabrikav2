import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from './contract.ts';
import type { AnalyticsSink } from './sink.ts';
import { createAnalytics } from './analytics.ts';

/** A recording sink that captures every emitted envelope. */
function recordingSink(name = 'rec'): AnalyticsSink & { events: AnalyticsEvent[] } {
  const events: AnalyticsEvent[] = [];
  return { name, events, emit: (e) => events.push(e) };
}

describe('createAnalytics — env marker is mandatory on every event', () => {
  it('stamps env + session + timestamp on every event reaching a sink', () => {
    const sink = recordingSink();
    // The generic parameter is the per-game extension point: declare the
    // game's own event-name union and `track` accepts canonical OR game names.
    const analytics = createAnalytics<'dog_found'>({
      env: 'test',
      sessionId: 'sess-9',
      sinks: [sink],
      now: () => 42,
    });

    analytics.sessionStart({ first_open: true });
    analytics.levelStart({ level_id: 'l1', level_index: 0 });
    analytics.track('dog_found', { level_id: 'l1' }); // game extension

    expect(sink.events).toHaveLength(3);
    for (const e of sink.events) {
      expect(e.env).toBe('test'); // mandatory marker — never absent
      expect(e.sessionId).toBe('sess-9');
      expect(e.timestamp).toBe(42);
    }
    expect(sink.events.map((e) => e.name)).toEqual([
      'session_start',
      'level_start',
      'dog_found',
    ]);
  });
});

describe('createAnalytics — params', () => {
  it('merges global params and lets per-event params win on collision', () => {
    const sink = recordingSink();
    const analytics = createAnalytics({
      env: 'production',
      sessionId: 's',
      sinks: [sink],
      globalParams: { app_version: '2.0.0', platform: 'ios', level_id: 'global' },
    });

    analytics.levelComplete({ level_id: 'l7', duration_ms: 1234 });

    const [event] = sink.events;
    expect(event!.params).toEqual({
      app_version: '2.0.0',
      platform: 'ios',
      level_id: 'l7', // per-event wins
      duration_ms: 1234,
    });
  });

  it('drops undefined/null optional params', () => {
    const sink = recordingSink();
    const analytics = createAnalytics({ env: 'test', sessionId: 's', sinks: [sink] });

    analytics.levelFail({ level_id: 'l1', reason: undefined });

    expect(sink.events[0]!.params).toEqual({ level_id: 'l1' });
  });
});

describe('createAnalytics — fan-out robustness', () => {
  it('isolates a throwing sink so the others still receive the event', () => {
    const good = recordingSink('good');
    const bad: AnalyticsSink = {
      name: 'bad',
      emit: () => {
        throw new Error('boom');
      },
    };
    const onSinkError = vi.fn();
    const analytics = createAnalytics({
      env: 'test',
      sessionId: 's',
      sinks: [bad, good],
      onSinkError,
    });

    expect(() => analytics.purchase({ product_id: 'p1' })).not.toThrow();
    expect(good.events).toHaveLength(1);
    expect(onSinkError).toHaveBeenCalledWith('bad', expect.any(Error));
  });

  it('flush fans out to sinks that buffer', async () => {
    const flush = vi.fn(() => Promise.resolve());
    const buffering: AnalyticsSink = { name: 'buf', emit: () => {}, flush };
    const analytics = createAnalytics({
      env: 'test',
      sessionId: 's',
      sinks: [recordingSink(), buffering],
    });

    await analytics.flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
