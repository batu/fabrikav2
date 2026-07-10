import { afterEach, describe, expect, it, vi } from 'vitest';
import workerEntrypoint from './index.ts';
import { OwnedAnalyticsIngestWorker, parseOwnedAnalyticsBatch } from './ingest.ts';
import type { AnalyticsEngineDataPoint, AnalyticsWorkerEnv, AnalyticsWorkerStore, AnalyticsWorkerWriteResult } from './contracts.ts';

const publicKey = 'public-client-key-123456';
const secondaryKey = 'secondary-client-key-123456';

function scopedCredentials(
  entries: readonly Record<string, unknown>[] = [{
    key: publicKey,
    games: ['marble_run', 'find_the_dog'],
    envs: ['production', 'development', 'test'],
  }],
): string {
  return JSON.stringify(entries);
}

function enabledEnv(overrides: Partial<AnalyticsWorkerEnv> = {}): AnalyticsWorkerEnv {
  return {
    ANALYTICS_INGEST_ENABLED: 'true',
    ANALYTICS_INGEST_CREDENTIALS: scopedCredentials(),
    ANALYTICS_RATE_LIMIT_PER_MINUTE: '3',
    ANALYTICS_REPLAY_TTL_SECONDS: '60',
    ANALYTICS: {
      writeDataPoint: vi.fn(),
    },
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'event-1',
    enqueued_at: 1_000,
    name: 'level_start',
    params: {
      app_version: '1.2.3',
      platform: 'ios',
      level_id: 'level-1',
    },
    ...overrides,
  };
}

function batch(eventOverrides: Record<string, unknown> = {}, batchOverrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'fabrika-owned-analytics-v1',
    game_id: 'marble_run',
    env: 'production',
    events: [event(eventOverrides)],
    ...batchOverrides,
  });
}

afterEach((): void => {
  vi.restoreAllMocks();
});

function request(body = batch(), headers: Record<string, string> = {}): Request {
  return new Request('https://analytics.example.com/ingest', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${publicKey}`,
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
      ...headers,
    },
    body,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('owned analytics worker ingest', (): void => {
  it('writes valid authenticated batches keyed by game_id and env to Analytics Engine', async (): Promise<void> => {
    const dataPoints: AnalyticsEngineDataPoint[] = [];
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS: { writeDataPoint: (point) => dataPoints.push(point) },
    }), { nowMs: () => 1_100 });

    const response = await worker.fetch(request());
    const body = await json(response);

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      ok: true,
      game_id: 'marble_run',
      env: 'production',
      accepted_events: 1,
      storage_mode: 'analytics_engine',
      storage_writes: 2,
    });
    expect(dataPoints).toHaveLength(2);
    expect(dataPoints[0].indexes).toEqual(['marble_run', 'production', 'level_start', '1.2.3', 'ios']);
    expect(dataPoints[0].blobs[0]).toBe('event-1');
    expect(JSON.parse(dataPoints[0].blobs[1]) as Record<string, unknown>).toMatchObject({ level_id: 'level-1' });
    expect(dataPoints[0].doubles).toEqual([1, 1_000, 1]);
  });

  it('rejects malformed game_id and unknown game_id (env allow-list), and invalid env', async (): Promise<void> => {
    const badGameId = new OwnedAnalyticsIngestWorker(enabledEnv(), { nowMs: () => 1_100 });
    const unknownGame = new OwnedAnalyticsIngestWorker(enabledEnv({ ANALYTICS_ALLOWED_GAME_IDS: 'find_the_dog' }), { nowMs: () => 1_100 });
    const badEnv = new OwnedAnalyticsIngestWorker(enabledEnv(), { nowMs: () => 1_100 });

    const badId = await badGameId.fetch(request(batch({}, { game_id: 'Marble Run!' })));
    expect(badId.status).toBe(400);
    expect(await json(badId)).toMatchObject({ ok: false, error: { code: 'invalid_game_id' } });

    const unknown = await unknownGame.fetch(request(batch({}, { game_id: 'marble_run' })));
    expect(unknown.status).toBe(400);
    expect(await json(unknown)).toMatchObject({ ok: false, error: { code: 'unknown_game_id' } });

    const invalidEnv = await badEnv.fetch(request(batch({}, { env: 'staging' })));
    expect(invalidEnv.status).toBe(400);
    expect(await json(invalidEnv)).toMatchObject({ ok: false, error: { code: 'invalid_env' } });
  });

  it('honors an env allow-list that names the game_id', async (): Promise<void> => {
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({ ANALYTICS_ALLOWED_GAME_IDS: 'marble_run, find_the_dog' }), { nowMs: () => 1_100 });
    expect((await worker.fetch(request())).status).toBe(202);
  });

  it('honors zero Analytics Engine sample rate as an event-write kill switch', async (): Promise<void> => {
    const dataPoints: AnalyticsEngineDataPoint[] = [];
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_AE_SAMPLE_RATE: '0',
      ANALYTICS: { writeDataPoint: (point) => dataPoints.push(point) },
    }), { nowMs: () => 1_100 });

    const response = await worker.fetch(request());

    expect(response.status).toBe(202);
    expect(await json(response)).toMatchObject({
      ok: true,
      accepted_events: 1,
      storage_writes: 1,
    });
    expect(dataPoints).toHaveLength(1);
    expect(dataPoints[0].indexes).toEqual(['marble_run', 'production', 'source_health', '1.2.3', 'analytics_engine']);
  });

  it('rejects missing, invalid, and disabled auth before writing', async (): Promise<void> => {
    const writes = vi.fn();
    const missingAuth = new OwnedAnalyticsIngestWorker(enabledEnv({ ANALYTICS: { writeDataPoint: writes } }), { nowMs: () => 1_100 });
    const invalidAuth = new OwnedAnalyticsIngestWorker(enabledEnv({ ANALYTICS: { writeDataPoint: writes } }), { nowMs: () => 1_100 });
    const disabled = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_INGEST_ENABLED: 'false',
      ANALYTICS: { writeDataPoint: writes },
    }), { nowMs: () => 1_100 });

    expect((await missingAuth.fetch(request(batch(), { authorization: '' }))).status).toBe(401);
    expect((await invalidAuth.fetch(request(batch(), { authorization: 'Bearer wrong-public-key-123456' }))).status).toBe(403);
    expect((await disabled.fetch(request())).status).toBe(503);
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', ' \n\t '],
    ['malformed', '{'],
    ['non-array', '{}'],
  ] as const)('fails closed without a legacy runtime fallback when scoped config is %s', async (_label, scopedConfig): Promise<void> => {
    const writes = vi.fn();
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_INGEST_CREDENTIALS: scopedConfig,
      ANALYTICS_PUBLIC_CLIENT_KEYS: publicKey,
      ANALYTICS_ALLOWED_GAME_IDS: 'marble_run,find_the_dog',
      ANALYTICS: { writeDataPoint: writes },
    }), { nowMs: () => 1_100 });

    const response = await worker.fetch(request());

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({
      ok: false,
      error: { code: 'invalid_token', message: 'Invalid public client token.' },
    });
    expect(writes).not.toHaveBeenCalled();
  });

  it('returns one secret-safe scope denial while retaining sanitized internal reasons', async (): Promise<void> => {
    const writes = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_INGEST_CREDENTIALS: scopedCredentials([{
        key: publicKey,
        games: ['marble_run'],
        envs: ['production'],
      }]),
      ANALYTICS: { writeDataPoint: writes },
    }), { nowMs: () => 1_100 });

    const gameOnly = await worker.fetch(request(batch({}, { game_id: 'find_the_dog', env: 'production' })));
    const envOnly = await worker.fetch(request(batch({}, { game_id: 'marble_run', env: 'development' })));
    const both = await worker.fetch(request(batch({}, { game_id: 'find_the_dog', env: 'test' })));
    const bodies = await Promise.all([gameOnly.text(), envOnly.text(), both.text()]);

    expect([gameOnly.status, envOnly.status, both.status]).toEqual([403, 403, 403]);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual({
      ok: false,
      error: {
        code: 'forbidden_scope',
        message: 'Credential is not authorized for this analytics scope.',
      },
    });
    expect(bodies[0]).not.toContain(publicKey);
    expect(bodies[0]).not.toContain('scope_reason');
    expect(bodies[0]).not.toContain('development');

    expect(worker.stateSnapshot()).toEqual({
      abuseCounters: {
        unauthorized: 0,
        forbiddenScopeGame: 2,
        forbiddenScopeEnv: 1,
        malformed: 0,
        replayed: 0,
        rateLimited: 0,
        clockSkew: 0,
        oversized: 0,
      },
      replayKeys: 0,
      rateBuckets: 0,
    });
    expect(warn.mock.calls).toEqual([
      [{ game_id: 'find_the_dog', env: 'production', scope_reason: 'game' }],
      [{ game_id: 'marble_run', env: 'development', scope_reason: 'env' }],
      [{ game_id: 'find_the_dog', env: 'test', scope_reason: 'game' }],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(publicKey);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('games');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('envs');
    expect(writes).not.toHaveBeenCalled();

    const accepted = await worker.fetch(request(batch({ event_id: 'accepted-after-denials' })));
    expect(accepted.status).toBe(202);
    expect(await json(accepted)).toMatchObject({ source_health: { abuse_counter: 3 } });
  });

  it('keeps production and development/test claims isolated per presenting credential', async (): Promise<void> => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_INGEST_CREDENTIALS: scopedCredentials([
        { key: publicKey, games: ['marble_run'], envs: ['production'] },
        { key: secondaryKey, games: ['marble_run'], envs: ['development', 'test'] },
      ]),
    }), { nowMs: () => 1_100 });

    const productionAccepted = await worker.fetch(request(batch({ event_id: 'production-accepted' })));
    const developmentAccepted = await worker.fetch(request(
      batch({ event_id: 'development-accepted' }, { env: 'development' }),
      { authorization: `Bearer ${secondaryKey}` },
    ));
    expect([productionAccepted.status, developmentAccepted.status]).toEqual([202, 202]);

    const denials = [
      await worker.fetch(request(batch({ event_id: 'production-key-development-1' }, { env: 'development' }))),
      await worker.fetch(request(batch({ event_id: 'production-key-development-2' }, { env: 'development' }))),
      await worker.fetch(request(
        batch({ event_id: 'development-key-production-1' }),
        { authorization: `Bearer ${secondaryKey}` },
      )),
      await worker.fetch(request(
        batch({ event_id: 'development-key-production-2' }),
        { authorization: `Bearer ${secondaryKey}` },
      )),
    ];
    const denialBodies = await Promise.all(denials.map(async (response) => await response.text()));

    expect(denials.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(new Set(denialBodies).size).toBe(1);
    expect(JSON.parse(denialBodies[0]!)).toEqual({
      ok: false,
      error: {
        code: 'forbidden_scope',
        message: 'Credential is not authorized for this analytics scope.',
      },
    });
    expect(worker.stateSnapshot().abuseCounters).toMatchObject({
      unauthorized: 0,
      forbiddenScopeGame: 0,
      forbiddenScopeEnv: 4,
    });
  });

  it('denies scope before duplicate, rate, skew, replay, and storage state can change', async (): Promise<void> => {
    const writeBatch = vi.fn(async (): Promise<AnalyticsWorkerWriteResult> => ({
      acceptedEvents: 1,
      storageMode: 'analytics_engine',
      storageWrites: 1,
      d1Reads: 0,
      d1Writes: 0,
      d1QueryCount: 0,
      d1DurationMs: 0,
    }));
    const store: AnalyticsWorkerStore = { writeBatch };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_INGEST_CREDENTIALS: scopedCredentials([
        { key: publicKey, games: ['marble_run'], envs: ['production'] },
        { key: secondaryKey, games: ['find_the_dog'], envs: ['production'] },
      ]),
      ANALYTICS_RATE_LIMIT_PER_MINUTE: '1',
      ANALYTICS_MAX_CLOCK_SKEW_SECONDS: '5',
      ANALYTICS_ALLOWED_GAME_IDS: 'marble_run,find_the_dog',
    }), { nowMs: () => 100_000 });

    const seed = await worker.fetch(request(
      batch({ event_id: 'replayed-event', enqueued_at: 100_000 }, { game_id: 'find_the_dog' }),
      { authorization: `Bearer ${secondaryKey}` },
    ), { store });
    expect(seed.status).toBe(202);
    const beforeSnapshot = worker.stateSnapshot();
    const before = {
      abuseCounters: { ...beforeSnapshot.abuseCounters },
      replayKeys: beforeSnapshot.replayKeys,
      rateBuckets: beforeSnapshot.rateBuckets,
    };

    const replayedEvent = event({ event_id: 'replayed-event', enqueued_at: 1_000 });
    const composite = batch({}, {
      game_id: 'find_the_dog',
      events: [replayedEvent, { ...replayedEvent }],
    });
    const denied = await worker.fetch(request(composite), { store });
    const after = worker.stateSnapshot();

    expect(denied.status).toBe(403);
    expect(await json(denied)).toEqual({
      ok: false,
      error: {
        code: 'forbidden_scope',
        message: 'Credential is not authorized for this analytics scope.',
      },
    });
    expect(after.replayKeys).toBe(before.replayKeys);
    expect(after.rateBuckets).toBe(before.rateBuckets);
    expect(after.abuseCounters).toEqual({
      ...before.abuseCounters,
      forbiddenScopeGame: before.abuseCounters.forbiddenScopeGame + 1,
    });
    expect(writeBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects replayed dedupe keys without a second storage write', async (): Promise<void> => {
    const writes = vi.fn();
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({ ANALYTICS: { writeDataPoint: writes } }), { nowMs: () => 1_100 });

    expect((await worker.fetch(request())).status).toBe(202);
    const replay = await worker.fetch(request());

    expect(replay.status).toBe(409);
    expect(await json(replay)).toMatchObject({ ok: false, error: { code: 'replay' } });
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('scopes replay dedupe by game_id so a different game reusing a key is accepted', async (): Promise<void> => {
    const writes = vi.fn();
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_ALLOWED_GAME_IDS: 'marble_run, find_the_dog',
      ANALYTICS: { writeDataPoint: writes },
    }), { nowMs: () => 1_100 });

    expect((await worker.fetch(request(batch({}, { game_id: 'marble_run' })))).status).toBe(202);
    // Same dedupe_key, different game — must not collide with marble_run's replay set.
    expect((await worker.fetch(request(batch({}, { game_id: 'find_the_dog' })))).status).toBe(202);
    // Same game + key again — replayed.
    expect((await worker.fetch(request(batch({}, { game_id: 'marble_run' })))).status).toBe(409);
  });

  it('rejects over-limit buckets with structured 429 and no storage write', async (): Promise<void> => {
    const store: AnalyticsWorkerStore = {
      writeBatch: vi.fn(async (): Promise<AnalyticsWorkerWriteResult> => ({
        acceptedEvents: 1,
        storageMode: 'analytics_engine',
        storageWrites: 1,
        d1Reads: 0,
        d1Writes: 0,
        d1QueryCount: 0,
        d1DurationMs: 0,
      })),
    };
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv(), { nowMs: () => 1_100 });

    expect((await worker.fetch(request(batch({ event_id: 'event-1' })), { store })).status).toBe(202);
    expect((await worker.fetch(request(batch({ event_id: 'event-2' })), { store })).status).toBe(202);
    expect((await worker.fetch(request(batch({ event_id: 'event-3' })), { store })).status).toBe(202);
    const limited = await worker.fetch(request(batch({ event_id: 'event-4' })), { store });

    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({
      ok: false,
      error: { code: 'rate_limited' },
      retry_after_seconds: 60,
      abuse_counters: {
        forbiddenScopeGame: 0,
        forbiddenScopeEnv: 0,
        rateLimited: 1,
      },
    });
    expect(store.writeBatch).toHaveBeenCalledTimes(3);
  });

  it('does not shard rate limits by caller-controlled app version', async (): Promise<void> => {
    const store: AnalyticsWorkerStore = {
      writeBatch: vi.fn(async (): Promise<AnalyticsWorkerWriteResult> => ({
        acceptedEvents: 1,
        storageMode: 'analytics_engine',
        storageWrites: 1,
        d1Reads: 0,
        d1Writes: 0,
        d1QueryCount: 0,
        d1DurationMs: 0,
      })),
    };
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv(), { nowMs: () => 1_100 });

    expect((await worker.fetch(request(batch({ event_id: 'event-v1' }), { 'x-fabrika-app-version': 'spoof-1' }), { store })).status).toBe(202);
    expect((await worker.fetch(request(batch({ event_id: 'event-v2' }), { 'x-fabrika-app-version': 'spoof-2' }), { store })).status).toBe(202);
    expect((await worker.fetch(request(batch({ event_id: 'event-v3' }), { 'x-fabrika-app-version': 'spoof-3' }), { store })).status).toBe(202);

    expect((await worker.fetch(request(batch({ event_id: 'event-v4' }), { 'x-fabrika-app-version': 'spoof-4' }), { store })).status).toBe(429);
  });

  it('does not let one game exhaust another game rate-limit bucket', async (): Promise<void> => {
    const store: AnalyticsWorkerStore = {
      writeBatch: vi.fn(async (): Promise<AnalyticsWorkerWriteResult> => ({
        acceptedEvents: 1,
        storageMode: 'analytics_engine',
        storageWrites: 1,
        d1Reads: 0,
        d1Writes: 0,
        d1QueryCount: 0,
        d1DurationMs: 0,
      })),
    };
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_RATE_LIMIT_PER_MINUTE: '1',
      ANALYTICS_ALLOWED_GAME_IDS: 'marble_run, find_the_dog',
    }), { nowMs: () => 1_100 });

    expect((await worker.fetch(request(batch({ event_id: 'a' }), {}), { store })).status).toBe(202);
    // find_the_dog still has its own budget.
    expect((await worker.fetch(request(batch({ event_id: 'b' }, { game_id: 'find_the_dog' })), { store })).status).toBe(202);
    // marble_run is now over its own limit.
    expect((await worker.fetch(request(batch({ event_id: 'c' }), {}), { store })).status).toBe(429);
  });

  it('rejects duplicate event_id inside the same batch', async (): Promise<void> => {
    const writes = vi.fn();
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({ ANALYTICS: { writeDataPoint: writes } }), { nowMs: () => 1_100 });
    const parsedBatch = JSON.parse(batch()) as { events: Record<string, unknown>[] };
    const body = JSON.stringify({
      schema: 'fabrika-owned-analytics-v1',
      game_id: 'marble_run',
      env: 'production',
      events: [
        parsedBatch.events[0],
        // same event_id, different name — collides on the idempotency key.
        { ...parsedBatch.events[0], name: 'level_complete' },
      ],
    });

    const response = await worker.fetch(request(body));

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ ok: false, error: { code: 'duplicate_event_id' } });
    expect(writes).not.toHaveBeenCalled();
  });

  it('rejects clock-skewed events before storage', async (): Promise<void> => {
    const writes = vi.fn();
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv({
      ANALYTICS_MAX_CLOCK_SKEW_SECONDS: '5',
      ANALYTICS: { writeDataPoint: writes },
    }), { nowMs: () => 100_000 });

    const response = await worker.fetch(request(batch({ enqueued_at: 1_000 })));

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ ok: false, error: { code: 'clock_skew' } });
    expect(writes).not.toHaveBeenCalled();
  });

  it('rejects an untagged batch missing env before storage (parser guard)', (): void => {
    const parsed = parseOwnedAnalyticsBatch(JSON.stringify({
      schema: 'fabrika-owned-analytics-v1',
      game_id: 'marble_run',
      events: [JSON.parse(batch()).events[0]],
    }), 100);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('invalid_env');
  });

  it('keeps replay and rate state across the default Worker export requests', async (): Promise<void> => {
    const now = Date.now();
    const replayEnv = enabledEnv({
      ANALYTICS_INGEST_CREDENTIALS: scopedCredentials([{
        key: 'entrypoint-public-key-123456',
        games: ['marble_run'],
        envs: ['production'],
      }]),
      ANALYTICS_RATE_LIMIT_PER_MINUTE: '10',
      ANALYTICS: { writeDataPoint: vi.fn() },
    });
    const makeRequest = (eventId: string, ip: string, key: string): Request =>
      new Request('https://analytics.example.com/ingest', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'cf-connecting-ip': ip,
        },
        body: batch({ event_id: eventId, enqueued_at: now }),
      });

    expect((await workerEntrypoint.fetch(makeRequest('entrypoint-event-1', '198.51.100.9', 'entrypoint-public-key-123456'), replayEnv)).status).toBe(202);
    expect((await workerEntrypoint.fetch(makeRequest('entrypoint-event-1', '198.51.100.9', 'entrypoint-public-key-123456'), replayEnv)).status).toBe(409);

    const rateEnv = enabledEnv({
      ANALYTICS_INGEST_CREDENTIALS: scopedCredentials([{
        key: 'entrypoint-rate-key-123456',
        games: ['marble_run'],
        envs: ['production'],
      }]),
      ANALYTICS_RATE_LIMIT_PER_MINUTE: '1',
      ANALYTICS: { writeDataPoint: vi.fn() },
    });
    expect((await workerEntrypoint.fetch(makeRequest('entrypoint-rate-event-1', '198.51.100.10', 'entrypoint-rate-key-123456'), rateEnv)).status).toBe(202);
    expect((await workerEntrypoint.fetch(makeRequest('entrypoint-rate-event-2', '198.51.100.10', 'entrypoint-rate-key-123456'), rateEnv)).status).toBe(429);
  });

  it('keeps unauthenticated health response minimal', async (): Promise<void> => {
    const worker = new OwnedAnalyticsIngestWorker(enabledEnv(), { nowMs: () => 1_100 });

    const response = await worker.fetch(new Request('https://analytics.example.com/health'));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true, service: 'owned_mirror_worker' });
  });
});
