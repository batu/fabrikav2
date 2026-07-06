import { describe, expect, it, vi } from 'vitest';
import { OwnedAnalyticsIngestWorker } from './ingest.ts';
import type { AnalyticsWorkerEnv, D1Database, D1PreparedStatement } from './contracts.ts';

function queryEnv(overrides: Partial<AnalyticsWorkerEnv> = {}): AnalyticsWorkerEnv {
  return {
    ANALYTICS_QUERY_ENABLED: 'true',
    ANALYTICS_QUERY_ALLOWED_ORIGINS: 'https://dashboard.example.com',
    ANALYTICS_OPERATOR_TOKEN: 'operator-token-123456',
    ANALYTICS_QUERY_MAX_ROWS: '2',
    ANALYTICS_QUERY_TIMEOUT_MS: '50',
    ANALYTICS_QUERY_STALE_AFTER_MS: '1000',
    DB: fakeDb(),
    ...overrides,
  };
}

const baseQuery = 'game_id=marble_run&env=production&start_ms=1000&end_ms=5000&limit=2';

function queryRequest(headers: Record<string, string> = {}, query = baseQuery): Request {
  return new Request(`https://analytics.example.com/v1/query/funnel?${query}`, {
    method: 'GET',
    headers: {
      origin: 'https://dashboard.example.com',
      authorization: 'Bearer operator-token-123456',
      ...headers,
    },
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('owned analytics query API', (): void => {
  it('rejects unauthenticated reads, disallowed CORS origins, URL credentials, and spoofed Access headers', async (): Promise<void> => {
    const worker = new OwnedAnalyticsIngestWorker(queryEnv());

    expect((await worker.fetch(queryRequest({ authorization: '' }))).status).toBe(401);
    expect((await worker.fetch(queryRequest({ origin: 'https://evil.example.com' }))).status).toBe(403);
    expect((await worker.fetch(new Request(`https://analytics.example.com/v1/query/funnel?${baseQuery}&token=leak`, {
      headers: {
        origin: 'https://dashboard.example.com',
        authorization: 'Bearer operator-token-123456',
      },
    }))).status).toBe(403);
    expect((await worker.fetch(new Request(`https://analytics.example.com/v1/query/funnel?${baseQuery}`, {
      headers: {
        'cf-access-authenticated-user-email': 'ops@example.com',
      },
    }))).status).toBe(403);
  });

  it('requires game_id and validates env before touching D1', async (): Promise<void> => {
    const worker = new OwnedAnalyticsIngestWorker(queryEnv(), { nowMs: () => 4_000 });

    const missingGame = await worker.fetch(queryRequest({}, 'env=production&start_ms=1000&end_ms=5000'));
    expect(missingGame.status).toBe(400);
    expect(await responseJson(missingGame)).toMatchObject({ error: { code: 'missing_game_id' } });

    const badEnv = await worker.fetch(queryRequest({}, 'game_id=marble_run&env=staging&start_ms=1000&end_ms=5000'));
    expect(badEnv.status).toBe(400);
    expect(await responseJson(badEnv)).toMatchObject({ error: { code: 'invalid_env' } });
  });

  it('allows bearer operator token for non-browser tools without exposing SQL credentials', async (): Promise<void> => {
    const worker = new OwnedAnalyticsIngestWorker(queryEnv(), { nowMs: () => 4_000 });
    const response = await worker.fetch(new Request('https://analytics.example.com/v1/query/funnel?game_id=marble_run&env=production&start_ms=1000&end_ms=5000', {
      headers: {
        authorization: 'Bearer operator-token-123456',
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await responseJson(response);
    expect(JSON.stringify(body)).not.toContain('operator-token-123456');
    expect(JSON.stringify(body)).not.toContain('select event_id');
  });

  it('returns normalized funnel rows, freshness fields, trust labels, and pagination scoped to game+env', async (): Promise<void> => {
    const worker = new OwnedAnalyticsIngestWorker(queryEnv(), { nowMs: () => 4_000 });

    const response = await worker.fetch(queryRequest());
    const body = await responseJson(response) as {
      game_id: string;
      env: string;
      rows: Array<Record<string, unknown>>;
      page: Record<string, unknown>;
      freshness: Record<string, unknown>;
      source_state: string;
      partial: boolean;
      stale: boolean;
      cache: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://dashboard.example.com');
    expect(body.game_id).toBe('marble_run');
    expect(body.env).toBe('production');
    expect(body.rows).toEqual([
      {
        event_id: 'level_complete',
        numerator: 10,
        denominator: 31,
        query_window: { start_ms: 1000, end_ms: 5000 },
        source_state: 'owned_live',
        trust_label: 'owned_ingest_verified',
        sequence_slot: 28,
        confidence_state: 'ready',
        suppression_state: 'visible',
      },
      {
        event_id: 'level_start',
        numerator: 20,
        denominator: 31,
        query_window: { start_ms: 1000, end_ms: 5000 },
        source_state: 'owned_live',
        trust_label: 'owned_ingest_verified',
        sequence_slot: 28,
        confidence_state: 'ready',
        suppression_state: 'visible',
      },
    ]);
    expect(body.page).toEqual({ limit: 2, cursor: null, next_cursor: '2' });
    expect(body.freshness).toEqual({
      last_ingest_at: 3_800,
      last_aggregate_at: 3_700,
      last_ga4_import_at: null,
      last_provider_import_at: null,
      generated_at: 4_000,
    });
    expect(body.source_state).toBe('owned_live');
    expect(body.partial).toBe(false);
    expect(body.stale).toBe(false);
    expect(body.cache).toEqual({ policy: 'private-no-store', snapshot: false });
  });

  it('scopes every D1 query by game_id and env', async (): Promise<void> => {
    const queries: string[] = [];
    const binds: unknown[][] = [];
    const worker = new OwnedAnalyticsIngestWorker(queryEnv({ DB: recordingDb(queries, binds) }), { nowMs: () => 4_000 });

    await worker.fetch(queryRequest());

    expect(queries.every((q) => q.includes('game_id = ? and env = ?'))).toBe(true);
    expect(binds[0].slice(0, 2)).toEqual(['marble_run', 'production']);
  });

  it('reports stale source state separately from partial timeout state', async (): Promise<void> => {
    const staleWorker = new OwnedAnalyticsIngestWorker(queryEnv(), { nowMs: () => 10_000 });

    const stale = await responseJson(await staleWorker.fetch(queryRequest()));

    expect(stale).toMatchObject({
      source_state: 'stale',
      stale: true,
      partial: false,
    });
    expect((stale.rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      trust_label: 'owned_ingest_stale',
      confidence_state: 'stale',
    });
  });

  it('redacts exact low-N numerator and denominator values', async (): Promise<void> => {
    const worker = new OwnedAnalyticsIngestWorker(queryEnv({ DB: lowNDb() }), { nowMs: () => 4_000 });

    const body = await responseJson(await worker.fetch(queryRequest())) as { rows: Array<Record<string, unknown>> };

    expect(body.rows[0]).toMatchObject({
      event_id: 'level_start',
      numerator: 0,
      denominator: 0,
      sequence_slot: 4,
      confidence_state: 'suppressed_low_n',
      suppression_state: 'suppressed',
    });
  });

  it('returns explicit partial state when the D1 query exceeds the timeout', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const worker = new OwnedAnalyticsIngestWorker(queryEnv({
        ANALYTICS_QUERY_TIMEOUT_MS: '10',
        DB: slowDb(),
      }), { nowMs: () => 4_000 });
      const promise = worker.fetch(queryRequest());

      await vi.advanceTimersByTimeAsync(11);
      const response = await promise;
      const body = await responseJson(response);

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        rows: [],
        source_state: 'partial',
        partial: true,
        stale: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

function fakeDb(): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      const statement: D1PreparedStatement = {
        bind(): D1PreparedStatement {
          return statement;
        },
        async first<T>(): Promise<T | null> {
          if (query.includes('count(*) as denominator')) return { denominator: 31 } as T;
          return {
            last_ingest_at: 3_800,
            last_aggregate_at: 3_700,
            last_ga4_import_at: null,
            last_provider_import_at: null,
          } as T;
        },
        async all<T>(): Promise<{ readonly results: readonly T[] }> {
          if (!query.includes('group by event_id')) return { results: [] };
          return {
            results: ([
              { event_id: 'level_complete', sequence_slot: 28, numerator: 10 },
              { event_id: 'level_start', sequence_slot: 28, numerator: 20 },
              { event_id: 'level_fail', sequence_slot: 29, numerator: 1 },
            ] as unknown) as readonly T[],
          };
        },
        async run(): Promise<unknown> {
          return { success: true };
        },
      };
      return statement;
    },
  };
}

function recordingDb(queries: string[], binds: unknown[][]): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      queries.push(query);
      const statement: D1PreparedStatement = {
        bind(...values: readonly unknown[]): D1PreparedStatement {
          binds.push([...values]);
          return statement;
        },
        async first<T>(): Promise<T | null> {
          if (query.includes('count(*) as denominator')) return { denominator: 31 } as T;
          return { last_ingest_at: 3_800, last_aggregate_at: 3_700, last_ga4_import_at: null, last_provider_import_at: null } as T;
        },
        async all<T>(): Promise<{ readonly results: readonly T[] }> {
          if (!query.includes('group by event_id')) return { results: [] };
          return { results: ([{ event_id: 'level_start', sequence_slot: 28, numerator: 20 }] as unknown) as readonly T[] };
        },
        async run(): Promise<unknown> {
          return { success: true };
        },
      };
      return statement;
    },
  };
}

function lowNDb(): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      const statement: D1PreparedStatement = {
        bind(): D1PreparedStatement {
          return statement;
        },
        async first<T>(): Promise<T | null> {
          if (query.includes('count(*) as denominator')) return { denominator: 2 } as T;
          return {
            last_ingest_at: 3_800,
            last_aggregate_at: 3_700,
            last_ga4_import_at: null,
            last_provider_import_at: null,
          } as T;
        },
        async all<T>(): Promise<{ readonly results: readonly T[] }> {
          return {
            results: ([{ event_id: 'level_start', sequence_slot: 4, numerator: 2 }] as unknown) as readonly T[],
          };
        },
        async run(): Promise<unknown> {
          return { success: true };
        },
      };
      return statement;
    },
  };
}

function slowDb(): D1Database {
  return {
    prepare(): D1PreparedStatement {
      const statement: D1PreparedStatement = {
        bind(): D1PreparedStatement {
          return statement;
        },
        async first<T>(): Promise<T | null> {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return null;
        },
        async all<T>(): Promise<{ readonly results: readonly T[] }> {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { results: [] };
        },
        async run(): Promise<unknown> {
          return { success: true };
        },
      };
      return statement;
    },
  };
}
