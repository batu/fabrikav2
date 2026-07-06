import type { AnalyticsEnvironment, AnalyticsWorkerEnv, D1Database } from './contracts.ts';
import { ANALYTICS_ENVIRONMENTS } from './contracts.ts';

export type AnalyticsQuerySourceState = 'owned_live' | 'owned_cached' | 'partial' | 'stale' | 'empty';
export type AnalyticsQueryTrustLabel = 'owned_ingest_verified' | 'owned_ingest_partial' | 'owned_ingest_stale' | 'sample';
export type AnalyticsQueryConfidenceState = 'ready' | 'suppressed_low_n' | 'partial_timeout' | 'stale';

export interface AnalyticsFunnelRow {
  readonly event_id: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly query_window: AnalyticsQueryWindow;
  readonly source_state: AnalyticsQuerySourceState;
  readonly trust_label: AnalyticsQueryTrustLabel;
  readonly sequence_slot: number;
  readonly confidence_state: AnalyticsQueryConfidenceState;
  readonly suppression_state: 'visible' | 'suppressed';
}

export interface AnalyticsQueryWindow {
  readonly start_ms: number;
  readonly end_ms: number;
}

interface AnalyticsFunnelQuery {
  readonly gameId: string;
  readonly env: AnalyticsEnvironment;
  readonly window: AnalyticsQueryWindow;
  readonly limit: number;
  readonly offset: number;
}

export interface AnalyticsFreshness {
  readonly last_ingest_at: number | null;
  readonly last_aggregate_at: number | null;
  readonly last_ga4_import_at: number | null;
  readonly last_provider_import_at: number | null;
  readonly generated_at: number;
}

export interface AnalyticsFunnelResponse {
  readonly ok: true;
  readonly game_id: string;
  readonly env: AnalyticsEnvironment;
  readonly rows: readonly AnalyticsFunnelRow[];
  readonly page: {
    readonly limit: number;
    readonly cursor: string | null;
    readonly next_cursor: string | null;
  };
  readonly freshness: AnalyticsFreshness;
  readonly source_state: AnalyticsQuerySourceState;
  readonly partial: boolean;
  readonly stale: boolean;
  readonly cache: {
    readonly policy: 'private-no-store';
    readonly snapshot: boolean;
  };
}

interface AnalyticsQueryConfig {
  readonly enabled: boolean;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly operatorToken: string | null;
  readonly maxRows: number;
  readonly timeoutMs: number;
  readonly staleAfterMs: number;
}

interface AnalyticsEventRow {
  readonly event_id: string;
  readonly sequence_slot: number | string | null;
  readonly numerator: number;
}

interface AnalyticsDenominatorRow {
  readonly denominator?: number | null;
}

interface AnalyticsFreshnessRow {
  readonly last_ingest_at?: number | null;
  readonly last_aggregate_at?: number | null;
  readonly last_ga4_import_at?: number | null;
  readonly last_provider_import_at?: number | null;
}

interface AnalyticsQueryError {
  readonly code: string;
  readonly message: string;
}

const DEFAULT_QUERY_MAX_ROWS = 500;
const DEFAULT_QUERY_TIMEOUT_MS = 750;
const DEFAULT_STALE_AFTER_MS = 15 * 60_000;
const MIN_VISIBLE_DENOMINATOR = 25;

export class OwnedAnalyticsQueryApi {
  constructor(
    private readonly env: AnalyticsWorkerEnv,
    private readonly dependencies: { readonly nowMs?: () => number } = {},
  ) {}

  async fetch(request: Request): Promise<Response> {
    const config = readAnalyticsQueryConfig(this.env);
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin, config);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
    }
    if (request.method !== 'GET') return jsonError(405, { code: 'method_not_allowed', message: 'Use GET /v1/query/funnel.' }, cors.headers);
    if (!config.enabled) return jsonError(503, { code: 'query_disabled', message: 'Owned analytics query API is disabled.' }, cors.headers);
    if (!cors.allowed) return jsonError(403, { code: 'cors_origin_denied', message: 'Origin is not allowed for owned analytics queries.' }, cors.headers);

    const auth = authenticateOperator(request, config);
    if (!auth.ok) return jsonError(auth.status, auth.error, cors.headers);
    if (this.env.DB === undefined) return jsonError(503, { code: 'd1_unavailable', message: 'Owned analytics query API requires DB binding.' }, cors.headers);

    const parsed = parseFunnelQuery(new URL(request.url), config);
    if (!parsed.ok) return jsonError(400, parsed.error, cors.headers);

    const now = this.dependencies.nowMs?.() ?? Date.now();
    const response = await queryWithTimeout(
      queryFunnel(this.env.DB, parsed.query, now, config),
      config.timeoutMs,
      now,
      parsed.query,
    );
    return jsonResponse(200, response, cors.headers);
  }
}

export function readAnalyticsQueryConfig(env: AnalyticsWorkerEnv): AnalyticsQueryConfig {
  return {
    enabled: envFlag(env.ANALYTICS_QUERY_ENABLED, false),
    allowedOrigins: new Set(envList(env.ANALYTICS_QUERY_ALLOWED_ORIGINS)),
    operatorToken: envString(env.ANALYTICS_OPERATOR_TOKEN),
    maxRows: envPositiveInt(env.ANALYTICS_QUERY_MAX_ROWS, DEFAULT_QUERY_MAX_ROWS),
    timeoutMs: envPositiveInt(env.ANALYTICS_QUERY_TIMEOUT_MS, DEFAULT_QUERY_TIMEOUT_MS),
    staleAfterMs: envPositiveInt(env.ANALYTICS_QUERY_STALE_AFTER_MS, DEFAULT_STALE_AFTER_MS),
  };
}

async function queryFunnel(
  db: D1Database,
  query: AnalyticsFunnelQuery,
  nowMs: number,
  config: AnalyticsQueryConfig,
): Promise<AnalyticsFunnelResponse> {
  const denominatorRow = await db.prepare(
    'select count(*) as denominator from analytics_events where game_id = ? and env = ? and enqueued_at_ms >= ? and enqueued_at_ms < ?',
  ).bind(query.gameId, query.env, query.window.start_ms, query.window.end_ms).first<AnalyticsDenominatorRow>();
  const rowsResult = await db.prepare(
    "select event_id, json_extract(payload_json, '$.params.sequence_slot') as sequence_slot, count(*) as numerator from analytics_events where game_id = ? and env = ? and enqueued_at_ms >= ? and enqueued_at_ms < ? group by event_id, sequence_slot order by sequence_slot asc, event_id asc limit ? offset ?",
  ).bind(query.gameId, query.env, query.window.start_ms, query.window.end_ms, query.limit + 1, query.offset).all<AnalyticsEventRow>();
  const freshness = await db.prepare(
    'select max(enqueued_at_ms) as last_ingest_at, max(enqueued_at_ms) as last_aggregate_at, null as last_ga4_import_at, null as last_provider_import_at from analytics_events where game_id = ? and env = ?',
  ).bind(query.gameId, query.env).first<AnalyticsFreshnessRow>();

  const denominator = denominatorRow?.denominator ?? 0;
  const baseState = sourceStateFor(freshness?.last_ingest_at ?? null, nowMs, config.staleAfterMs, denominator);
  const funnelRows = rowsResult.results.slice(0, query.limit)
    .map((row): AnalyticsFunnelRow => {
      const suppressed = denominator < MIN_VISIBLE_DENOMINATOR;
      return {
        event_id: row.event_id,
        numerator: suppressed ? 0 : row.numerator,
        denominator: suppressed ? 0 : denominator,
        query_window: query.window,
        source_state: baseState,
        trust_label: trustLabelFor(baseState),
        sequence_slot: sequenceSlotFor(row.sequence_slot),
        confidence_state: suppressed ? 'suppressed_low_n' : confidenceFor(baseState),
        suppression_state: suppressed ? 'suppressed' : 'visible',
      };
    });

  return {
    ok: true,
    game_id: query.gameId,
    env: query.env,
    rows: funnelRows,
    page: {
      limit: query.limit,
      cursor: query.offset === 0 ? null : String(query.offset),
      next_cursor: rowsResult.results.length > query.limit ? String(query.offset + query.limit) : null,
    },
    freshness: {
      last_ingest_at: freshness?.last_ingest_at ?? null,
      last_aggregate_at: freshness?.last_aggregate_at ?? null,
      last_ga4_import_at: freshness?.last_ga4_import_at ?? null,
      last_provider_import_at: freshness?.last_provider_import_at ?? null,
      generated_at: nowMs,
    },
    source_state: baseState,
    partial: false,
    stale: baseState === 'stale',
    cache: {
      policy: 'private-no-store',
      snapshot: false,
    },
  };
}

function parseFunnelQuery(url: URL, config: AnalyticsQueryConfig): { readonly ok: true; readonly query: AnalyticsFunnelQuery } | { readonly ok: false; readonly error: AnalyticsQueryError } {
  const gameId = url.searchParams.get('game_id')?.trim() ?? '';
  if (gameId.length === 0) {
    return { ok: false, error: { code: 'missing_game_id', message: 'game_id is required to scope owned analytics queries.' } };
  }
  const env = url.searchParams.get('env')?.trim() ?? 'production';
  if (!isAnalyticsEnvironment(env)) {
    return { ok: false, error: { code: 'invalid_env', message: 'env must be one of production, development, test.' } };
  }
  const startMs = intParam(url, 'start_ms');
  const endMs = intParam(url, 'end_ms');
  if (startMs === null || endMs === null || endMs <= startMs) {
    return { ok: false, error: { code: 'invalid_window', message: 'start_ms and end_ms must define a positive query window.' } };
  }
  const requestedLimit = intParam(url, 'limit') ?? config.maxRows;
  const limit = Math.min(config.maxRows, Math.max(1, requestedLimit));
  const offset = Math.max(0, intParam(url, 'cursor') ?? 0);
  return { ok: true, query: { gameId, env, window: { start_ms: startMs, end_ms: endMs }, limit, offset } };
}

async function queryWithTimeout(
  work: Promise<AnalyticsFunnelResponse>,
  timeoutMs: number,
  nowMs: number,
  query: AnalyticsFunnelQuery,
): Promise<AnalyticsFunnelResponse> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<AnalyticsFunnelResponse>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        ok: true,
        game_id: query.gameId,
        env: query.env,
        rows: [],
        page: { limit: query.limit, cursor: query.offset === 0 ? null : String(query.offset), next_cursor: null },
        freshness: {
          last_ingest_at: null,
          last_aggregate_at: null,
          last_ga4_import_at: null,
          last_provider_import_at: null,
          generated_at: nowMs,
        },
        source_state: 'partial',
        partial: true,
        stale: false,
        cache: { policy: 'private-no-store', snapshot: false },
      });
    }, timeoutMs);
  });
  const result = await Promise.race([work, timeout]);
  if (timeoutId !== null) clearTimeout(timeoutId);
  return result;
}

function authenticateOperator(request: Request, config: AnalyticsQueryConfig): { readonly ok: true } | { readonly ok: false; readonly status: 401 | 403; readonly error: AnalyticsQueryError } {
  const url = new URL(request.url);
  if (url.username.length > 0 || url.password.length > 0 || url.searchParams.has('token')) {
    return { ok: false, status: 403, error: { code: 'browser_credential_exposure', message: 'Operator credentials must not appear in URLs.' } };
  }
  if (request.headers.get('cf-access-authenticated-user-email') !== null) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'unverified_access_identity',
        message: 'Raw Cloudflare Access identity headers are not accepted without JWT validation.',
      },
    };
  }
  const authorization = request.headers.get('authorization');
  if (config.operatorToken !== null && authorization === `Bearer ${config.operatorToken}`) return { ok: true };
  return { ok: false, status: 401, error: { code: 'operator_auth_required', message: 'Operator authentication is required.' } };
}

function corsHeaders(origin: string | null, config: AnalyticsQueryConfig): { readonly allowed: boolean; readonly headers: Headers } {
  const headers = new Headers({
    'cache-control': 'private, no-store',
    vary: 'origin',
  });
  if (origin === null) return { allowed: true, headers };
  if (!config.allowedOrigins.has(origin)) return { allowed: false, headers };
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', 'GET, OPTIONS');
  headers.set('access-control-allow-headers', 'authorization, content-type');
  headers.set('access-control-max-age', '60');
  return { allowed: true, headers };
}

function sourceStateFor(lastIngestAt: number | null, nowMs: number, staleAfterMs: number, rowCount: number): AnalyticsQuerySourceState {
  if (rowCount === 0) return 'empty';
  if (lastIngestAt === null) return 'empty';
  return nowMs - lastIngestAt > staleAfterMs ? 'stale' : 'owned_live';
}

function trustLabelFor(state: AnalyticsQuerySourceState): AnalyticsQueryTrustLabel {
  if (state === 'stale') return 'owned_ingest_stale';
  if (state === 'partial') return 'owned_ingest_partial';
  if (state === 'empty') return 'sample';
  return 'owned_ingest_verified';
}

function sequenceSlotFor(value: number | string | null): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function confidenceFor(state: AnalyticsQuerySourceState): AnalyticsQueryConfidenceState {
  if (state === 'partial') return 'partial_timeout';
  if (state === 'stale') return 'stale';
  return 'ready';
}

function isAnalyticsEnvironment(value: string): value is AnalyticsEnvironment {
  return (ANALYTICS_ENVIRONMENTS as readonly string[]).includes(value);
}

function jsonError(status: number, error: AnalyticsQueryError, headers: Headers): Response {
  return jsonResponse(status, { ok: false, error }, headers);
}

function jsonResponse(status: number, body: unknown, headers: Headers): Response {
  headers.set('content-type', 'application/json');
  headers.set('cache-control', 'private, no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function intParam(url: URL, key: string): number | null {
  const value = url.searchParams.get(key);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function envList(value: string | undefined): readonly string[] {
  return typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
    : [];
}

function envString(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
