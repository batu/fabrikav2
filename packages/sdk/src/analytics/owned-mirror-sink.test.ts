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

/**
 * A transport whose every call parks on a manually-released gate, so a test can
 * hold a flush in-flight while it exercises concurrent callers / mid-flush
 * arrivals. `release(n)` opens the next `n` parked (or future) calls in order.
 */
function gatedTransport(results: MirrorTransportResult[] = []): MirrorTransport & {
  calls: { body: string }[];
  release: (n?: number) => void;
} {
  const calls: { body: string }[] = [];
  const pending: (() => void)[] = [];
  let credits = 0;
  let i = 0;
  const open = () => {
    while (credits > 0 && pending.length > 0) {
      credits -= 1;
      pending.shift()!();
    }
  };
  const transport = vi.fn((req: { body: string }) => {
    calls.push({ body: req.body });
    const result = results[i++] ?? { ok: true, status: 200 };
    return new Promise<MirrorTransportResult>((resolve) => {
      pending.push(() => resolve(result));
      open();
    });
  }) as unknown as MirrorTransport & {
    calls: { body: string }[];
    release: (n?: number) => void;
  };
  transport.calls = calls;
  transport.release = (n = 1) => {
    credits += n;
    open();
  };
  return transport;
}

describe('createOwnedMirrorSink — concurrent flush', () => {
  it('drains an event emitted synchronously after an empty flush starts', async () => {
    const transport = scriptedTransport([{ ok: true, status: 200 }]);
    const sink = createOwnedMirrorSink(baseOptions(transport, { batchSize: 100 }));

    const done = sink.flush();
    sink.emit(event('joined-before-settlement'));
    await done;

    expect(transport.calls).toHaveLength(1);
    expect(sink.stats().sent).toBe(1);
    expect(sink.stats().queueLength).toBe(0);
  });

  it('stops after a retryable failure during the empty-flush handoff', async () => {
    const transport = scriptedTransport([
      { ok: false, status: 503 },
      { ok: true, status: 200 },
    ]);
    const sink = createOwnedMirrorSink(
      baseOptions(transport, { batchSize: 100, maxAttempts: 3 }),
    );

    const done = sink.flush();
    sink.emit(event('joined-before-retry'));
    await done;

    expect(transport.calls).toHaveLength(1);
    expect(sink.stats().retried).toBe(1);
    expect(sink.stats().queueLength).toBe(1);

    await sink.flush();
    expect(transport.calls).toHaveLength(2);
    expect(sink.stats().sent).toBe(1);
    expect(sink.stats().queueLength).toBe(0);
  });

  it('concurrent callers share one in-flight drain (no duplicate sends) and both resolve after delivery', async () => {
    const transport = gatedTransport();
    const sink = createOwnedMirrorSink(baseOptions(transport, { batchSize: 100 }));

    sink.emit(event('a'));
    sink.emit(event('b'));

    let firstDone = false;
    let secondDone = false;
    const firstFlush = sink.flush();
    const secondFlush = sink.flush();
    expect(secondFlush).toBe(firstFlush);
    const first = firstFlush.then(() => {
      firstDone = true;
    });
    const second = secondFlush.then(() => {
      secondDone = true;
    });

    // Second caller must NOT resolve instantly while nothing has been sent.
    await Promise.resolve();
    expect(secondDone).toBe(false);
    expect(transport.calls).toHaveLength(1); // one shared send, not two

    transport.release();
    await Promise.all([first, second]);

    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
    expect(transport.calls).toHaveLength(1);
    expect(sink.stats().sent).toBe(2);
    expect(sink.stats().queueLength).toBe(0);
  });

  it('events enqueued during a flush are drained by the same in-flight pass', async () => {
    const transport = gatedTransport();
    const sink = createOwnedMirrorSink(baseOptions(transport, { batchSize: 1 }));

    sink.emit(event('a')); // batchSize 1 → auto-flush starts, parks on gate
    await Promise.resolve();
    expect(transport.calls).toHaveLength(1);

    // Arrives mid-flush; a caller who awaits flush() must see it delivered too.
    sink.emit(event('b'));
    const joined = sink.flush(); // joins the active drain

    transport.release(); // finish 'a' → loop picks up 'b'
    await Promise.resolve();
    transport.release(); // finish 'b'
    await joined;

    expect(transport.calls).toHaveLength(2);
    expect(sink.stats().sent).toBe(2);
    expect(sink.stats().queueLength).toBe(0);
  });

  it('a partial failure mid-drain is shared by all callers and requeues survivors', async () => {
    // First batch ok, second batch 503 → drain stops, survivors requeued.
    const transport = gatedTransport([
      { ok: true, status: 200 },
      { ok: false, status: 503 },
    ]);
    const sink = createOwnedMirrorSink(
      baseOptions(transport, { batchSize: 1, maxAttempts: 3 }),
    );

    sink.emit(event('a'));
    sink.emit(event('b'));

    const first = sink.flush();
    const second = sink.flush(); // shares the same drain
    expect(transport.calls.length).toBeGreaterThanOrEqual(1);

    transport.release(2); // let both batches run to completion
    await Promise.all([first, second]);

    const stats = sink.stats();
    expect(stats.sent).toBe(1); // 'a' delivered
    expect(stats.retried).toBe(1); // 'b' hit the 503
    expect(stats.queueLength).toBe(1); // 'b' requeued as a survivor
    expect(stats.dropped).toBe(0);
  });

  it('clears the in-flight handle so a later flush re-drains fresh arrivals', async () => {
    const transport = gatedTransport();
    const sink = createOwnedMirrorSink(baseOptions(transport, { batchSize: 100 }));

    sink.emit(event('a'));
    const first = sink.flush();
    transport.release();
    await first;
    expect(sink.stats().sent).toBe(1);

    // A brand-new flush after the first settled must start a fresh drain, not
    // hand back the stale resolved promise.
    sink.emit(event('b'));
    const second = sink.flush();
    transport.release();
    await second;

    expect(transport.calls).toHaveLength(2);
    expect(sink.stats().sent).toBe(2);
    expect(sink.stats().queueLength).toBe(0);
  });
});
