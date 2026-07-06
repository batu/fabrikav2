/**
 * Shared wire-contract round-trip: the SDK owned-mirror sink (the PRODUCER) and
 * this worker (the CONSUMER) must agree on `fabrika-owned-analytics-v1` byte for
 * byte. This test captures the sink's ACTUAL HTTP body via a fake transport and
 * feeds it straight into `parseOwnedAnalyticsBatch` with ZERO adaptation — if
 * either side edits the shape, this fails. It is the regression guard for the
 * wire-contract divergence that previously existed under the shared schema tag.
 */
import { describe, expect, it } from 'vitest';
import {
  createOwnedMirrorSink,
  type AnalyticsEvent,
  type MirrorTransport,
} from '@fabrikav2/sdk/analytics';
import { parseOwnedAnalyticsBatch } from './ingest.ts';

function event(name: string, params: Record<string, string | number> = {}): AnalyticsEvent {
  return { name, params, timestamp: 1_700_000_000_000, sessionId: 'sess-1', env: 'test' };
}

describe('owned-analytics wire round-trip (sdk sink → services parser)', (): void => {
  it('parses the sink’s real batch body with zero adaptation', async (): Promise<void> => {
    const bodies: string[] = [];
    const transport: MirrorTransport = async (request) => {
      bodies.push(request.body);
      return { ok: true, status: 200 };
    };

    let counter = 0;
    const sink = createOwnedMirrorSink({
      url: 'https://mirror.example/ingest',
      publicClientKey: 'pk_test_0123456789abcdef',
      transport,
      gameId: 'marble_run',
      env: 'test',
      batchSize: 100,
      now: () => 1_700_000_000_000,
      generateId: () => `evt-${++counter}`,
    });

    sink.emit(event('level_start', { level_id: 'l1' }));
    sink.emit(event('level_complete', { level_id: 'l1' }));
    await sink.flush();

    expect(bodies).toHaveLength(1);

    // The worker parses the sink's body verbatim — no field renames, no reshaping.
    const parsed = parseOwnedAnalyticsBatch(bodies[0]!, 100);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.batch.game_id).toBe('marble_run');
    expect(parsed.batch.env).toBe('test');
    expect(parsed.batch.events).toHaveLength(2);
    expect(parsed.batch.events[0]).toMatchObject({
      event_id: 'evt-1',
      enqueued_at: 1_700_000_000_000,
      name: 'level_start',
    });
    // env marker rides inside every event's params (toWirePayload guarantee).
    expect(parsed.batch.events[0]!.params.env).toBe('test');
    expect(parsed.batch.events[1]!.name).toBe('level_complete');
  });
});
