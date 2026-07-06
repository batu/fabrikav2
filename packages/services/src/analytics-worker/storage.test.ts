import { describe, expect, it } from 'vitest';
import { analyticsWorkerD1Budget } from './budget.ts';
import { D1AnalyticsEventStore, AnalyticsEngineStore, analyticsEngineLayout, buildSourceHealthRow, shouldWriteAnalyticsEngineSample, toAnalyticsEnginePoint } from './storage.ts';
import type { AnalyticsWorkerRequestContext, D1Database, D1PreparedStatement, OwnedAnalyticsWorkerBatch } from './contracts.ts';

function context(overrides: Partial<AnalyticsWorkerRequestContext> = {}): AnalyticsWorkerRequestContext {
  return {
    nowMs: 2_000,
    gameId: 'marble_run',
    env: 'production',
    publicClientKey: 'public-client-key-123456',
    clientIp: '203.0.113.10',
    appVersion: '1.2.3',
    storageMode: 'analytics_engine',
    sampleRate: 0.5,
    ...overrides,
  };
}

function testBatch(size = 2): OwnedAnalyticsWorkerBatch {
  return {
    schema: 'fabrika-owned-analytics-v1',
    game_id: 'marble_run',
    env: 'production',
    events: Array.from({ length: size }, (_, index) => ({
      id: 'level_start',
      params: {
        app_version: '1.2.3',
        platform: 'android',
        level_id: `level-${index + 1}`,
      },
      event_occurrence_id: `event-${index + 1}`,
      dedupe_key: `dedupe-${index + 1}`,
      enqueued_at_ms: 1_000 + index,
      attempt: index,
    })),
  };
}

describe('owned analytics worker storage', (): void => {
  it('publishes the Analytics Engine layout scoped by game_id and env', (): void => {
    const point = toAnalyticsEnginePoint(testBatch(1).events[0], context(), null);

    expect(analyticsEngineLayout).toEqual({
      indexes: ['game_id', 'env', 'event_id', 'app_version', 'platform'],
      blobs: ['event_occurrence_id', 'dedupe_key', 'dimension_json', 'source_health_json'],
      doubles: ['event_count', 'enqueued_at_ms', 'attempt', 'sample_rate'],
    });
    expect(point.indexes).toEqual(['marble_run', 'production', 'level_start', '1.2.3', 'android']);
    expect(point.blobs.slice(0, 2)).toEqual(['event-1', 'dedupe-1']);
    expect(JSON.parse(point.blobs[2]) as Record<string, unknown>).toMatchObject({ level_id: 'level-1' });
    expect(point.doubles).toEqual([1, 1_000, 0, 0.5]);
  });

  it('builds source-health rows carrying game_id and env for accepted/rejected ingest', (): void => {
    expect(buildSourceHealthRow({
      nowMs: 2_000,
      status: 'rejected',
      reason: 'rate_limited',
      context: context({ storageMode: 'd1', env: 'test' }),
      acceptedEvents: 0,
      rejectedEvents: 3,
      abuseCounter: 4,
    })).toEqual({
      checked_at_ms: 2_000,
      source: 'owned_mirror_worker',
      game_id: 'marble_run',
      env: 'test',
      status: 'rejected',
      reason: 'rate_limited',
      storage_mode: 'd1',
      app_version: '1.2.3',
      accepted_events: 0,
      rejected_events: 3,
      abuse_counter: 4,
    });
  });

  it('keeps D1 fallback within row, query-count, storage, and duration budgets', async (): Promise<void> => {
    const queries: string[] = [];
    const db: D1Database = {
      prepare(query: string): D1PreparedStatement {
        queries.push(query);
        return {
          bind(): D1PreparedStatement {
            return this;
          },
          async first<T>(): Promise<T | null> {
            return null;
          },
          async all<T>(): Promise<{ readonly results: readonly T[] }> {
            return { results: [] };
          },
          async run(): Promise<unknown> {
            return { success: true };
          },
        };
      },
    };
    let now = 10;
    const store = new D1AnalyticsEventStore(db, () => {
      now += 5;
      return now;
    });

    const result = await store.writeBatch(testBatch(2), context({ storageMode: 'd1' }));

    expect(result).toMatchObject({
      acceptedEvents: 2,
      storageMode: 'd1',
      storageWrites: 3,
      d1Reads: 1,
      d1Writes: 3,
      d1QueryCount: 4,
      d1DurationMs: 5,
    });
    expect(result.d1Reads).toBeLessThanOrEqual(analyticsWorkerD1Budget.maxRowsReadPerBatch);
    expect(result.d1Writes).toBeLessThanOrEqual(analyticsWorkerD1Budget.maxRowsWrittenPerBatch);
    expect(result.d1QueryCount).toBeLessThanOrEqual(analyticsWorkerD1Budget.maxQueriesPerBatch);
    expect(result.d1DurationMs).toBeLessThanOrEqual(analyticsWorkerD1Budget.maxQueryDurationMsPerBatch);
    expect(queries).toHaveLength(4);
    // game_id scoping is threaded into the source-health read and event inserts.
    expect(queries[0]).toContain('game_id = ?');
    expect(queries[1]).toContain('insert into analytics_events (game_id, env,');
  });

  it('applies Analytics Engine sampling instead of only recording sample rate', async (): Promise<void> => {
    const writes: unknown[] = [];
    const store = new AnalyticsEngineStore({ writeDataPoint: (point) => writes.push(point) });
    const batch = testBatch(2);
    const sampleRate = shouldWriteAnalyticsEngineSample('dedupe-1', 0.5) ? 0 : 0.5;

    await store.writeBatch(batch, context({ sampleRate }));

    expect(writes).toHaveLength(sampleRate === 0 ? 1 : 2);
  });

  it('rejects D1 batches that cannot fit query budgets before any write', async (): Promise<void> => {
    const queries: string[] = [];
    const db: D1Database = {
      prepare(query: string): D1PreparedStatement {
        queries.push(query);
        return {
          bind(): D1PreparedStatement {
            return this;
          },
          async first<T>(): Promise<T | null> {
            return null;
          },
          async all<T>(): Promise<{ readonly results: readonly T[] }> {
            return { results: [] };
          },
          async run(): Promise<unknown> {
            return { success: true };
          },
        };
      },
    };

    await expect(new D1AnalyticsEventStore(db).writeBatch(testBatch(101), context({ storageMode: 'd1' }))).rejects.toThrow('D1 analytics batch would exceed');
    expect(queries).toHaveLength(0);
  });
});
