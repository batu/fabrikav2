/**
 * Owned-analytics WIRE CONTRACT — the single source of truth for the batch
 * shape the client posts and the ingest worker parses.
 *
 * The PRODUCER owns the contract: this file lives in the SDK (which builds the
 * body in `owned-mirror-sink.ts`), and `@fabrikav2/services` imports these types
 * to validate against them. Previously the sink and the worker each declared a
 * private, divergent shape under the SAME `schema` tag — every real batch would
 * have failed ingest validation. One declaration, imported both sides, makes
 * that class of drift impossible.
 *
 * Shape:
 *   - batch envelope: { schema, game_id, env, events }
 *   - event:          { event_id, enqueued_at, name, params }
 *
 * `event_id` is a unique-per-enqueue idempotency id (the worker keys replay and
 * in-batch dedupe on it); `name` is the canonical event type (the funnel
 * dimension); `enqueued_at` is client wall-clock ms. Client-local concerns
 * (retry `attempt`) never ride the wire.
 */
import type { AnalyticsEnvironment, AnalyticsParams } from './contract.ts';

/** Schema tag on every batch body; lets client and worker version in lockstep. */
export const OWNED_ANALYTICS_WIRE_SCHEMA = 'fabrika-owned-analytics-v1' as const;

export type OwnedAnalyticsWireSchema = typeof OWNED_ANALYTICS_WIRE_SCHEMA;

/** One event inside a batch body. */
export interface OwnedAnalyticsWireEvent {
  /** Unique-per-enqueue idempotency id; the worker dedupes/replays on this. */
  readonly event_id: string;
  /** Client wall-clock ms at enqueue time (clock-skew checked at ingest). */
  readonly enqueued_at: number;
  /** Canonical event type (e.g. `level_start`) — the funnel dimension. */
  readonly name: string;
  /** Flat param bag, already carrying the env/session/timestamp markers. */
  readonly params: AnalyticsParams;
}

/** The batch envelope the sink POSTs and the worker parses. */
export interface OwnedAnalyticsWireBatch {
  readonly schema: OwnedAnalyticsWireSchema;
  /** Which game these events belong to — keys storage, never trusted for auth. */
  readonly game_id: string;
  /** Environment marker; test/development traffic is partitioned from prod. */
  readonly env: AnalyticsEnvironment;
  readonly events: readonly OwnedAnalyticsWireEvent[];
}
