import {
  D1AnalyticsEventStore,
  AnalyticsEngineStore,
  buildSourceHealthRow,
} from './storage.ts';
import { OwnedAnalyticsQueryApi } from './query.ts';
import {
  ANALYTICS_ENVIRONMENTS,
  ownedAnalyticsWorkerSchema,
  type AnalyticsEnvironment,
  type AnalyticsWorkerAbuseCounters,
  type AnalyticsWorkerEnv,
  type AnalyticsWorkerRequestContext,
  type AnalyticsWorkerStateSnapshot,
  type AnalyticsWorkerStorageMode,
  type AnalyticsWorkerStore,
  type OwnedAnalyticsWorkerBatch,
  type OwnedAnalyticsWorkerEvent,
} from './contracts.ts';

interface AnalyticsWorkerDependencies {
  readonly nowMs?: () => number;
  readonly replayStore?: TtlSet;
  readonly rateLimiter?: SlidingWindowRateLimiter;
  readonly store?: AnalyticsWorkerStore;
}

interface AnalyticsWorkerConfig {
  readonly enabled: boolean;
  readonly killSwitch: boolean;
  readonly publicClientKeys: ReadonlySet<string>;
  readonly allowedGameIds: ReadonlySet<string>;
  readonly maxBatchEvents: number;
  readonly maxBodyBytes: number;
  readonly maxClockSkewMs: number;
  readonly rateLimitPerMinute: number;
  readonly replayTtlMs: number;
  readonly storageMode: AnalyticsWorkerStorageMode;
  readonly sampleRate: number;
}

interface WorkerError {
  readonly code: string;
  readonly message: string;
}

const DEFAULT_MAX_BATCH_EVENTS = 100;
const DEFAULT_MAX_BODY_BYTES = 96_000;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 300;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;
const DEFAULT_REPLAY_TTL_SECONDS = 600;
const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class OwnedAnalyticsIngestWorker {
  private readonly nowMs: () => number;
  private readonly replayStore: TtlSet;
  private readonly rateLimiter: SlidingWindowRateLimiter;
  private abuseCounters = {
    unauthorized: 0,
    malformed: 0,
    replayed: 0,
    rateLimited: 0,
    clockSkew: 0,
    oversized: 0,
  };

  constructor(private readonly env: AnalyticsWorkerEnv, dependencies: AnalyticsWorkerDependencies = {}) {
    this.nowMs = dependencies.nowMs ?? (() => Date.now());
    this.replayStore = dependencies.replayStore ?? new TtlSet();
    this.rateLimiter = dependencies.rateLimiter ?? new SlidingWindowRateLimiter();
  }

  async fetch(request: Request, dependencies: AnalyticsWorkerDependencies = {}): Promise<Response> {
    const config = readAnalyticsWorkerConfig(this.env);
    const pathname = new URL(request.url).pathname;
    if (pathname === '/v1/query/funnel') {
      return new OwnedAnalyticsQueryApi(this.env, { nowMs: this.nowMs }).fetch(request);
    }
    if (request.method === 'GET' && pathname === '/health') {
      return jsonResponse(200, {
        ok: true,
        service: 'owned_mirror_worker',
      });
    }
    if (request.method !== 'POST') return jsonError(405, { code: 'method_not_allowed', message: 'Use POST /ingest.' });
    if (!config.enabled) return jsonError(503, { code: 'ingest_disabled', message: 'Owned analytics ingest is disabled.' });
    if (config.killSwitch) return jsonError(503, { code: 'kill_switch', message: 'Owned analytics ingest kill switch is active.' });

    const auth = authenticate(request, config);
    if (!auth.ok) {
      this.abuseCounters.unauthorized += 1;
      return jsonError(auth.status, auth.error);
    }

    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > config.maxBodyBytes) {
      this.abuseCounters.oversized += 1;
      return jsonError(413, { code: 'body_too_large', message: `Body exceeds ${config.maxBodyBytes} bytes.` });
    }

    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > config.maxBodyBytes) {
      this.abuseCounters.oversized += 1;
      return jsonError(413, { code: 'body_too_large', message: `Body exceeds ${config.maxBodyBytes} bytes.` });
    }

    const parsed = parseOwnedAnalyticsBatch(bodyText, config.maxBatchEvents, config.allowedGameIds);
    if (!parsed.ok) {
      this.abuseCounters.malformed += 1;
      return jsonError(400, parsed.error);
    }

    const now = this.nowMs();
    const appVersion = appVersionFor(request, parsed.batch);
    const context: AnalyticsWorkerRequestContext = {
      nowMs: now,
      gameId: parsed.batch.game_id,
      env: parsed.batch.env,
      publicClientKey: auth.publicClientKey,
      clientIp: clientIpFor(request),
      appVersion,
      storageMode: config.storageMode,
      sampleRate: config.sampleRate,
    };

    const duplicateDedupeKey = firstDuplicate(parsed.batch.events.map((event) => event.dedupe_key));
    if (duplicateDedupeKey !== null) {
      this.abuseCounters.replayed += 1;
      return jsonError(409, { code: 'duplicate_dedupe_key', message: `Batch contains duplicate dedupe key ${duplicateDedupeKey}.` });
    }

    const rateKey = `${context.gameId}:${auth.publicClientKey}:${context.clientIp}`;
    const rate = this.rateLimiter.check(rateKey, now, 60_000, config.rateLimitPerMinute, parsed.batch.events.length);
    if (!rate.allowed) {
      this.abuseCounters.rateLimited += 1;
      return jsonResponse(429, {
        ok: false,
        error: { code: 'rate_limited', message: 'Owned analytics ingest rate limit exceeded.' },
        retry_after_seconds: rate.retryAfterSeconds,
        abuse_counters: this.abuseCounters,
      });
    }

    const skewed = parsed.batch.events.find((event) => Math.abs(now - event.enqueued_at_ms) > config.maxClockSkewMs);
    if (skewed !== undefined) {
      this.abuseCounters.clockSkew += 1;
      return jsonError(400, { code: 'clock_skew', message: `Event ${skewed.dedupe_key} is outside the allowed clock skew.` });
    }

    const replayed = parsed.batch.events.find((event) => this.replayStore.has(replayKey(context.gameId, event.dedupe_key), now));
    if (replayed !== undefined) {
      this.abuseCounters.replayed += 1;
      return jsonError(409, { code: 'replay', message: `Event ${replayed.dedupe_key} was already accepted.` });
    }

    const store = dependencies.store ?? this.createStore(config);
    const result = await store.writeBatch(parsed.batch, context);
    for (const event of parsed.batch.events) {
      this.replayStore.add(replayKey(context.gameId, event.dedupe_key), now + config.replayTtlMs);
    }

    return jsonResponse(202, {
      ok: true,
      game_id: context.gameId,
      env: context.env,
      accepted_events: result.acceptedEvents,
      storage_mode: result.storageMode,
      storage_writes: result.storageWrites,
      d1_budget: {
        reads: result.d1Reads,
        writes: result.d1Writes,
        query_count: result.d1QueryCount,
        duration_ms: result.d1DurationMs,
      },
      source_health: buildSourceHealthRow({
        nowMs: now,
        status: 'accepted',
        reason: 'accepted',
        context,
        acceptedEvents: result.acceptedEvents,
        rejectedEvents: 0,
        abuseCounter: totalAbuse(this.abuseCounters),
      }),
    });
  }

  stateSnapshot(): AnalyticsWorkerStateSnapshot {
    return {
      abuseCounters: this.abuseCounters,
      replayKeys: this.replayStore.size,
      rateBuckets: this.rateLimiter.size,
    };
  }

  private createStore(config: AnalyticsWorkerConfig): AnalyticsWorkerStore {
    if (config.storageMode === 'd1') {
      if (this.env.DB === undefined) throw new Error('ANALYTICS_STORAGE_MODE=d1 requires DB binding.');
      return new D1AnalyticsEventStore(this.env.DB, this.nowMs);
    }
    if (this.env.ANALYTICS === undefined) throw new Error('Analytics Engine binding ANALYTICS is required.');
    return new AnalyticsEngineStore(this.env.ANALYTICS);
  }
}

export function readAnalyticsWorkerConfig(env: AnalyticsWorkerEnv): AnalyticsWorkerConfig {
  const storageMode = env.ANALYTICS_STORAGE_MODE === 'd1' ? 'd1' : 'analytics_engine';
  return {
    enabled: envFlag(env.ANALYTICS_INGEST_ENABLED, false),
    killSwitch: envFlag(env.ANALYTICS_KILL_SWITCH, false),
    publicClientKeys: new Set(envList(env.ANALYTICS_PUBLIC_CLIENT_KEYS).filter((key) => key.length >= 16)),
    allowedGameIds: new Set(envList(env.ANALYTICS_ALLOWED_GAME_IDS)),
    maxBatchEvents: envPositiveInt(env.ANALYTICS_MAX_BATCH_EVENTS, DEFAULT_MAX_BATCH_EVENTS),
    maxBodyBytes: envPositiveInt(env.ANALYTICS_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    maxClockSkewMs: envPositiveInt(env.ANALYTICS_MAX_CLOCK_SKEW_SECONDS, DEFAULT_MAX_CLOCK_SKEW_SECONDS) * 1000,
    rateLimitPerMinute: envPositiveInt(env.ANALYTICS_RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT_PER_MINUTE),
    replayTtlMs: envPositiveInt(env.ANALYTICS_REPLAY_TTL_SECONDS, DEFAULT_REPLAY_TTL_SECONDS) * 1000,
    storageMode,
    sampleRate: envUnitInterval(env.ANALYTICS_AE_SAMPLE_RATE, 1),
  };
}

export function parseOwnedAnalyticsBatch(
  bodyText: string,
  maxBatchEvents: number,
  allowedGameIds: ReadonlySet<string> = new Set(),
): { readonly ok: true; readonly batch: OwnedAnalyticsWorkerBatch } | { readonly ok: false; readonly error: WorkerError } {
  let value: unknown;
  try {
    value = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } };
  }
  if (!isObject(value) || value.schema !== ownedAnalyticsWorkerSchema || !Array.isArray(value.events)) {
    return { ok: false, error: { code: 'invalid_schema', message: `Expected ${ownedAnalyticsWorkerSchema} batch.` } };
  }
  const gameId = value.game_id;
  if (typeof gameId !== 'string' || !GAME_ID_PATTERN.test(gameId)) {
    return { ok: false, error: { code: 'invalid_game_id', message: 'Batch game_id must match [a-z0-9][a-z0-9_-]{0,63}.' } };
  }
  if (allowedGameIds.size > 0 && !allowedGameIds.has(gameId)) {
    return { ok: false, error: { code: 'unknown_game_id', message: `game_id ${gameId} is not enabled on this deployment.` } };
  }
  if (typeof value.env !== 'string' || !isAnalyticsEnvironment(value.env)) {
    return { ok: false, error: { code: 'invalid_env', message: 'Batch env must be one of production, development, test.' } };
  }
  if (value.events.length === 0 || value.events.length > maxBatchEvents) {
    return { ok: false, error: { code: 'invalid_event_count', message: `Batch must contain 1..${maxBatchEvents} events.` } };
  }
  const events: OwnedAnalyticsWorkerEvent[] = [];
  for (const candidate of value.events) {
    if (!isOwnedAnalyticsWorkerEvent(candidate)) {
      return { ok: false, error: { code: 'invalid_event', message: 'Batch contains an invalid event.' } };
    }
    events.push(candidate);
  }
  return { ok: true, batch: { schema: ownedAnalyticsWorkerSchema, game_id: gameId, env: value.env, events } };
}

export class TtlSet {
  private readonly expiresAtByKey = new Map<string, number>();

  add(key: string, expiresAtMs: number): void {
    this.expiresAtByKey.set(key, expiresAtMs);
  }

  has(key: string, nowMs: number): boolean {
    this.prune(nowMs);
    return this.expiresAtByKey.has(key);
  }

  get size(): number {
    return this.expiresAtByKey.size;
  }

  private prune(nowMs: number): void {
    for (const [key, expiresAt] of this.expiresAtByKey.entries()) {
      if (expiresAt <= nowMs) this.expiresAtByKey.delete(key);
    }
  }
}

export class SlidingWindowRateLimiter {
  private readonly timestampsByKey = new Map<string, number[]>();

  check(key: string, nowMs: number, windowMs: number, limit: number, cost: number): { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number } {
    const existing = (this.timestampsByKey.get(key) ?? []).filter((timestamp) => nowMs - timestamp < windowMs);
    if (existing.length + cost > limit) {
      const oldest = existing[0] ?? nowMs;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)) };
    }
    this.timestampsByKey.set(key, [...existing, ...Array.from({ length: cost }, () => nowMs)]);
    return { allowed: true };
  }

  get size(): number {
    return this.timestampsByKey.size;
  }
}

function replayKey(gameId: string, dedupeKey: string): string {
  return `${gameId}:${dedupeKey}`;
}

function authenticate(request: Request, config: AnalyticsWorkerConfig): { readonly ok: true; readonly publicClientKey: string } | { readonly ok: false; readonly status: 401 | 403; readonly error: WorkerError } {
  const authorization = request.headers.get('authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: { code: 'missing_token', message: 'Missing bearer token.' } };
  }
  const publicClientKey = authorization.slice('Bearer '.length).trim();
  if (!config.publicClientKeys.has(publicClientKey)) {
    return { ok: false, status: 403, error: { code: 'invalid_token', message: 'Invalid public client token.' } };
  }
  return { ok: true, publicClientKey };
}

function isAnalyticsEnvironment(value: string): value is AnalyticsEnvironment {
  return (ANALYTICS_ENVIRONMENTS as readonly string[]).includes(value);
}

function isOwnedAnalyticsWorkerEvent(value: unknown): value is OwnedAnalyticsWorkerEvent {
  if (!isObject(value)) return false;
  const enqueuedAtMs = value.enqueued_at_ms;
  const attempt = value.attempt;
  return isObject(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && isObject(value.params)
    && typeof value.event_occurrence_id === 'string'
    && value.event_occurrence_id.length > 0
    && typeof value.dedupe_key === 'string'
    && value.dedupe_key.length > 0
    && Number.isSafeInteger(enqueuedAtMs)
    && typeof enqueuedAtMs === 'number'
    && enqueuedAtMs > 0
    && Number.isSafeInteger(attempt)
    && typeof attempt === 'number'
    && attempt >= 0
    && Object.values(value.params).every(isAnalyticsPrimitive);
}

function jsonError(status: number, error: WorkerError): Response {
  return jsonResponse(status, { ok: false, error });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function appVersionFor(request: Request, batch: OwnedAnalyticsWorkerBatch): string {
  const fromHeader = request.headers.get('x-fabrika-app-version')?.trim();
  if (fromHeader !== undefined && fromHeader.length > 0) return fromHeader;
  const first = batch.events[0]?.params.app_version;
  return typeof first === 'string' && first.trim().length > 0 ? first.trim() : 'unknown';
}

function clientIpFor(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function totalAbuse(counters: AnalyticsWorkerAbuseCounters): number {
  return counters.unauthorized + counters.malformed + counters.replayed + counters.rateLimited + counters.clockSkew + counters.oversized;
}

function envList(value: string | undefined): readonly string[] {
  return typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
    : [];
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === 'true';
}

function envPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function envUnitInterval(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAnalyticsPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}
