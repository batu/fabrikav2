import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from './contract.ts';
import { ENV_PARAM_KEY } from './contract.ts';
import {
  OWNED_MIRROR_SCHEMA,
  createOwnedMirrorSink,
  type MirrorTransport,
  type MirrorTransportResult,
  type OwnedMirrorSinkOptions,
} from './owned-mirror-sink.ts';

function event(name: string, params: Record<string, string | number> = {}): AnalyticsEvent {
  return { name, params, timestamp: 1_700_000_000_000, sessionId: 'sess-1', env: 'test' };
}

/** A transport whose result queue is scripted per call; records every request. */
function scriptedTransport(results: MirrorTransportResult[]): MirrorTransport & {
  calls: { body: string }[];
} {
  const calls: { body: string }[] = [];
  let i = 0;
  const transport = vi.fn(async (req) => {
    calls.push({ body: req.body });
    return results[i++] ?? { ok: true, status: 200 };
  }) as unknown as MirrorTransport & { calls: { body: string }[] };
  transport.calls = calls;
  return transport;
}

function baseOptions(
  transport: MirrorTransport,
  overrides: Partial<OwnedMirrorSinkOptions> = {},
): OwnedMirrorSinkOptions {
  let n = 0;
  return {
    url: 'https://mirror.example/ingest',
    publicClientKey: 'pk_test_0123456789abcdef',
    transport,
    gameId: 'marble_run',
    env: 'test',
    now: () => 1_700_000_000_000,
    generateId: () => `evt-${++n}`,
    ...overrides,
  };
}

describe('createOwnedMirrorSink — batching + wire body', () => {
  it('auto-flushes once batchSize is reached and posts a schema-tagged body', async () => {
    const transport = scriptedTransport([{ ok: true, status: 200 }]);
    const sink = createOwnedMirrorSink(baseOptions(transport, { batchSize: 2 }));

    sink.emit(event('level_start', { level_id: 'l1' }));
    expect(sink.stats().queueLength).toBe(1);
    expect(transport.calls).toHaveLength(0); // not yet at batchSize

    sink.emit(event('level_complete', { level_id: 'l1' }));
    // auto-flush was triggered; let the async flush settle
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.calls).toHaveLength(1);
    const body = JSON.parse(transport.calls[0]!.body) as {
      schema: string;
      game_id: string;
      env: string;
      events: { event_id: string; name: string; params: Record<string, unknown> }[];
    };
    expect(body.schema).toBe(OWNED_MIRROR_SCHEMA);
    // batch envelope carries game_id + env (the multi-game / env-partition keys)
    expect(body.game_id).toBe('marble_run');
    expect(body.env).toBe('test');
    expect(body.events).toHaveLength(2);
    // idempotency ids are distinct per enqueue
    expect(body.events[0]!.event_id).toBe('evt-1');
    expect(body.events[1]!.event_id).toBe('evt-2');
    // env marker rides in every event body
    expect(body.events[0]!.params[ENV_PARAM_KEY]).toBe('test');

    const stats = sink.stats();
    expect(stats.enqueued).toBe(2);
    expect(stats.sent).toBe(2);
    expect(stats.queueLength).toBe(0);
  });

  it('manual flush drains everything queued', async () => {
    const transport = scriptedTransport([{ ok: true, status: 200 }]);
    const sink = createOwnedMirrorSink(baseOptions(transport, { batchSize: 100 }));

    sink.emit(event('session_start'));
    sink.emit(event('session_end'));
    expect(transport.calls).toHaveLength(0);

    await sink.flush();

    expect(transport.calls).toHaveLength(1);
    expect(sink.stats().sent).toBe(2);
  });
});

describe('createOwnedMirrorSink — retry + drop', () => {
  it('retries a retryable status: bumps attempts and requeues survivors', async () => {
    const transport = scriptedTransport([
      { ok: false, status: 503 }, // first flush fails transiently
      { ok: true, status: 200 }, // retry succeeds
    ]);
    const sink = createOwnedMirrorSink(
      baseOptions(transport, { batchSize: 100, maxAttempts: 3 }),
    );

    sink.emit(event('purchase', { product_id: 'p1' }));
    await sink.flush(); // 503 → requeued
    expect(sink.stats().sent).toBe(0);
    expect(sink.stats().retried).toBe(1);
    expect(sink.stats().queueLength).toBe(1);

    await sink.flush(); // 200 → sent
    expect(sink.stats().sent).toBe(1);
    expect(sink.stats().queueLength).toBe(0);
  });

  it('drops immediately on a non-retryable status', async () => {
    const transport = scriptedTransport([{ ok: false, status: 400 }]);
    const sink = createOwnedMirrorSink(baseOptions(transport, { batchSize: 100 }));

    sink.emit(event('purchase', { product_id: 'p1' }));
    await sink.flush();

    const stats = sink.stats();
    expect(stats.sent).toBe(0);
    expect(stats.dropped).toBe(1);
    expect(stats.dropReasons.status_400).toBe(1);
    expect(stats.queueLength).toBe(0);
  });

  it('drops after maxAttempts of retryable failures', async () => {
    const transport = scriptedTransport([
      { ok: false, status: 500 },
      { ok: false, status: 500 },
    ]);
    const sink = createOwnedMirrorSink(
      baseOptions(transport, { batchSize: 100, maxAttempts: 2 }),
    );

    sink.emit(event('resource_change', { currency: 'coins', amount: 5 }));
    await sink.flush(); // attempt 1 → requeue
    expect(sink.stats().queueLength).toBe(1);

    await sink.flush(); // attempt 2 → hits cap, dropped
    const stats = sink.stats();
    expect(stats.dropped).toBe(1);
    expect(stats.dropReasons.max_attempts).toBe(1);
    expect(stats.queueLength).toBe(0);
  });

  it('treats a transport throw as a transient (retryable) failure', async () => {
    const transport = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as MirrorTransport;
    const sink = createOwnedMirrorSink(
      baseOptions(transport, { batchSize: 100, maxAttempts: 3 }),
    );

    sink.emit(event('ad_impression', { ad_format: 'banner', placement: 'home' }));
    await sink.flush();

    // requeued for retry, not dropped
    expect(sink.stats().queueLength).toBe(1);
    expect(sink.stats().dropped).toBe(0);
    expect(sink.stats().retried).toBe(1);
  });
});
