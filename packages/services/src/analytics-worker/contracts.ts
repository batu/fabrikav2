/**
 * Owned-analytics ingest worker contracts — the game-agnostic core.
 *
 * This is v1 find_the_dog's Cloudflare worker (`ftd-owned-analytics-v1`)
 * generalized to serve MANY games from ONE deployment. Two things change vs
 * FTD, everything else is a faithful port:
 *
 *   1. `game_id` rides on the batch envelope and threads into every storage
 *      key / index / D1 row, so a single worker keyed by `game_id` replaces
 *      one-worker-per-game. Rate-limit and dedupe scoping stay per (game, key).
 *   2. `env` (production/development/test) rides on the batch envelope and is
 *      indexed at storage time — the decision-doc 'SDK test credentials'
 *      guardrail that a game's dev/test SDK verification must be partitionable
 *      out of production data. FTD only separated env at the credential level;
 *      here the marker is a first-class, validated field of the ingest
 *      contract so untagged traffic is rejected at the door.
 *
 * Pure types + Cloudflare binding shapes only — no transport, no I/O, no game
 * strings. The schema tag matches the SDK owned-mirror sink's
 * `fabrika-owned-analytics-v1` so client and worker version the wire format in
 * lockstep.
 */

import {
  OWNED_ANALYTICS_WIRE_SCHEMA,
  type AnalyticsEnvironment,
  type OwnedAnalyticsWireBatch,
  type OwnedAnalyticsWireEvent,
} from '@fabrikav2/sdk/analytics';

/**
 * The wire shape is owned by the PRODUCER: `@fabrikav2/sdk`'s
 * `owned-mirror-sink` builds these batches, and this worker validates against
 * the exact same declaration (imported below) so client and worker can never
 * drift under the shared `fabrika-owned-analytics-v1` tag. The worker's own
 * types (`OwnedAnalyticsWorkerBatch`/`Event`) are thin aliases kept for local
 * readability and back-compat of the module's exported names.
 */
export const ownedAnalyticsWorkerSchema = OWNED_ANALYTICS_WIRE_SCHEMA;

export type OwnedAnalyticsWorkerSchema = typeof ownedAnalyticsWorkerSchema;

/** The environment marker every batch must carry (decision-doc guardrail). */
export type { AnalyticsEnvironment };

export const ANALYTICS_ENVIRONMENTS: readonly AnalyticsEnvironment[] = [
  'production',
  'development',
  'test',
];

export type OwnedAnalyticsWorkerEvent = OwnedAnalyticsWireEvent;

export type OwnedAnalyticsWorkerBatch = OwnedAnalyticsWireBatch;

export interface AnalyticsEngineDataPoint {
  readonly indexes: readonly string[];
  readonly blobs: readonly string[];
  readonly doubles: readonly number[];
}

export interface AnalyticsEngineDataset {
  writeDataPoint(point: AnalyticsEngineDataPoint): void;
}

export interface D1PreparedStatement {
  bind(...values: readonly unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ readonly results: readonly T[] }>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface AnalyticsWorkerEnv {
  readonly ANALYTICS_INGEST_ENABLED?: string;
  readonly ANALYTICS_KILL_SWITCH?: string;
  readonly ANALYTICS_PUBLIC_CLIENT_KEYS?: string;
  readonly ANALYTICS_MAX_BATCH_EVENTS?: string;
  readonly ANALYTICS_MAX_BODY_BYTES?: string;
  readonly ANALYTICS_MAX_CLOCK_SKEW_SECONDS?: string;
  readonly ANALYTICS_RATE_LIMIT_PER_MINUTE?: string;
  readonly ANALYTICS_REPLAY_TTL_SECONDS?: string;
  readonly ANALYTICS_STORAGE_MODE?: string;
  readonly ANALYTICS_AE_SAMPLE_RATE?: string;
  /** Comma-separated allow-list; empty accepts any game_id on the deployment. */
  readonly ANALYTICS_ALLOWED_GAME_IDS?: string;
  readonly ANALYTICS_QUERY_ENABLED?: string;
  readonly ANALYTICS_QUERY_ALLOWED_ORIGINS?: string;
  readonly ANALYTICS_OPERATOR_EMAILS?: string;
  readonly ANALYTICS_OPERATOR_TOKEN?: string;
  readonly ANALYTICS_QUERY_MAX_ROWS?: string;
  readonly ANALYTICS_QUERY_TIMEOUT_MS?: string;
  readonly ANALYTICS_QUERY_STALE_AFTER_MS?: string;
  readonly ANALYTICS?: AnalyticsEngineDataset;
  readonly DB?: D1Database;
}

export type AnalyticsWorkerStorageMode = 'analytics_engine' | 'd1';

export interface AnalyticsWorkerRequestContext {
  readonly nowMs: number;
  readonly gameId: string;
  readonly env: AnalyticsEnvironment;
  readonly publicClientKey: string;
  readonly clientIp: string;
  readonly appVersion: string;
  readonly storageMode: AnalyticsWorkerStorageMode;
  readonly sampleRate: number;
}

export interface AnalyticsWorkerWriteResult {
  readonly acceptedEvents: number;
  readonly storageMode: AnalyticsWorkerStorageMode;
  readonly storageWrites: number;
  readonly d1Reads: number;
  readonly d1Writes: number;
  readonly d1QueryCount: number;
  readonly d1DurationMs: number;
}

export interface AnalyticsWorkerStore {
  writeBatch(batch: OwnedAnalyticsWorkerBatch, context: AnalyticsWorkerRequestContext): Promise<AnalyticsWorkerWriteResult>;
}

export interface SourceHealthRow {
  readonly checked_at_ms: number;
  readonly source: 'owned_mirror_worker';
  readonly game_id: string;
  readonly env: AnalyticsEnvironment;
  readonly status: 'accepted' | 'rejected';
  readonly reason: string;
  readonly storage_mode: AnalyticsWorkerStorageMode;
  readonly app_version: string;
  readonly accepted_events: number;
  readonly rejected_events: number;
  readonly abuse_counter: number;
}

export interface AnalyticsWorkerAbuseCounters {
  readonly unauthorized: number;
  readonly malformed: number;
  readonly replayed: number;
  readonly rateLimited: number;
  readonly clockSkew: number;
  readonly oversized: number;
}

export interface AnalyticsWorkerStateSnapshot {
  readonly abuseCounters: AnalyticsWorkerAbuseCounters;
  readonly replayKeys: number;
  readonly rateBuckets: number;
}
