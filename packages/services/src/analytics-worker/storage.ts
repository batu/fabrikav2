import { analyticsWorkerD1Budget } from './budget.ts';
import type {
  AnalyticsEngineDataPoint,
  AnalyticsWorkerRequestContext,
  AnalyticsWorkerStore,
  AnalyticsWorkerWriteResult,
  D1Database,
  OwnedAnalyticsWorkerBatch,
  OwnedAnalyticsWorkerEvent,
  SourceHealthRow,
} from './contracts.ts';

/**
 * Analytics Engine column layout. `game_id` and `env` lead the index tuple so
 * every dashboard query is naturally scoped to one game + one environment —
 * the multi-game and test-partitioning generalizations, made queryable at the
 * storage boundary rather than reconstructed from blobs.
 */
export const analyticsEngineLayout = {
  indexes: ['game_id', 'env', 'event_id', 'app_version', 'platform'] as const,
  blobs: ['event_occurrence_id', 'dedupe_key', 'dimension_json', 'source_health_json'] as const,
  doubles: ['event_count', 'enqueued_at_ms', 'attempt', 'sample_rate'] as const,
};

export class AnalyticsEngineStore implements AnalyticsWorkerStore {
  constructor(private readonly dataset: { writeDataPoint(point: AnalyticsEngineDataPoint): void }) {}

  async writeBatch(batch: OwnedAnalyticsWorkerBatch, context: AnalyticsWorkerRequestContext): Promise<AnalyticsWorkerWriteResult> {
    let eventWrites = 0;
    for (const event of batch.events) {
      if (!shouldWriteAnalyticsEngineSample(event.dedupe_key, context.sampleRate)) continue;
      this.dataset.writeDataPoint(toAnalyticsEnginePoint(event, context, null));
      eventWrites += 1;
    }
    this.dataset.writeDataPoint(sourceHealthAnalyticsPoint(buildSourceHealthRow({
      nowMs: context.nowMs,
      status: 'accepted',
      reason: 'accepted',
      context,
      acceptedEvents: batch.events.length,
      rejectedEvents: 0,
      abuseCounter: 0,
    })));
    return {
      acceptedEvents: batch.events.length,
      storageMode: 'analytics_engine',
      storageWrites: eventWrites + 1,
      d1Reads: 0,
      d1Writes: 0,
      d1QueryCount: 0,
      d1DurationMs: 0,
    };
  }
}

export class D1AnalyticsEventStore implements AnalyticsWorkerStore {
  constructor(
    private readonly db: D1Database,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  async writeBatch(batch: OwnedAnalyticsWorkerBatch, context: AnalyticsWorkerRequestContext): Promise<AnalyticsWorkerWriteResult> {
    const startedAt = this.nowMs();
    let queryCount = 0;
    let reads = 0;
    let writes = 0;

    preflightD1Budget(batch.events.length);

    queryCount += 1;
    reads += 1;
    await this.db.prepare(
      'select checked_at_ms from analytics_source_health where source = ? and game_id = ? order by checked_at_ms desc limit 1',
    ).bind('owned_mirror_worker', context.gameId).first();

    for (const event of batch.events) {
      const payload = JSON.stringify(event);
      if (new TextEncoder().encode(payload).byteLength > analyticsWorkerD1Budget.maxStoredEventBytes) {
        throw new Error(`D1 analytics event exceeds ${analyticsWorkerD1Budget.maxStoredEventBytes} bytes`);
      }
      queryCount += 1;
      writes += 1;
      await this.db.prepare(
        'insert into analytics_events (game_id, env, dedupe_key, event_id, app_version, enqueued_at_ms, payload_json) values (?, ?, ?, ?, ?, ?, ?)',
      ).bind(context.gameId, context.env, event.dedupe_key, event.id, context.appVersion, event.enqueued_at_ms, payload).run();
    }

    queryCount += 1;
    writes += 1;
    await this.db.prepare(
      'insert into analytics_source_health (checked_at_ms, source, game_id, env, status, reason, storage_mode, app_version, accepted_events, rejected_events, abuse_counter) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      context.nowMs,
      'owned_mirror_worker',
      context.gameId,
      context.env,
      'accepted',
      'accepted',
      'd1',
      context.appVersion,
      batch.events.length,
      0,
      0,
    ).run();

    const durationMs = this.nowMs() - startedAt;
    return {
      acceptedEvents: batch.events.length,
      storageMode: 'd1',
      storageWrites: writes,
      d1Reads: reads,
      d1Writes: writes,
      d1QueryCount: queryCount,
      d1DurationMs: durationMs,
    };
  }
}

export function shouldWriteAnalyticsEngineSample(key: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return hashFraction(key) < sampleRate;
}

export function toAnalyticsEnginePoint(
  event: OwnedAnalyticsWorkerEvent,
  context: AnalyticsWorkerRequestContext,
  sourceHealth: SourceHealthRow | null,
): AnalyticsEngineDataPoint {
  return {
    indexes: [
      context.gameId,
      context.env,
      event.id,
      context.appVersion,
      stringDimension(event.params.platform, 'unknown'),
    ],
    blobs: [
      event.event_occurrence_id,
      event.dedupe_key,
      JSON.stringify(event.params),
      sourceHealth === null ? '' : JSON.stringify(sourceHealth),
    ],
    doubles: [
      1,
      event.enqueued_at_ms,
      event.attempt,
      context.sampleRate,
    ],
  };
}

export function buildSourceHealthRow(input: {
  readonly nowMs: number;
  readonly status: 'accepted' | 'rejected';
  readonly reason: string;
  readonly context: AnalyticsWorkerRequestContext;
  readonly acceptedEvents: number;
  readonly rejectedEvents: number;
  readonly abuseCounter: number;
}): SourceHealthRow {
  return {
    checked_at_ms: input.nowMs,
    source: 'owned_mirror_worker',
    game_id: input.context.gameId,
    env: input.context.env,
    status: input.status,
    reason: input.reason,
    storage_mode: input.context.storageMode,
    app_version: input.context.appVersion,
    accepted_events: input.acceptedEvents,
    rejected_events: input.rejectedEvents,
    abuse_counter: input.abuseCounter,
  };
}

function sourceHealthAnalyticsPoint(row: SourceHealthRow): AnalyticsEngineDataPoint {
  return {
    indexes: [row.game_id, row.env, 'source_health', row.app_version, row.storage_mode],
    blobs: ['', '', '{}', JSON.stringify(row)],
    doubles: [row.accepted_events, row.checked_at_ms, row.rejected_events, 1],
  };
}

function preflightD1Budget(eventCount: number): void {
  const rowsWritten = eventCount + 1;
  const queries = eventCount + 2;
  if (rowsWritten > analyticsWorkerD1Budget.maxRowsWrittenPerBatch) {
    throw new Error(`D1 analytics batch would exceed ${analyticsWorkerD1Budget.maxRowsWrittenPerBatch} row writes`);
  }
  if (queries > analyticsWorkerD1Budget.maxQueriesPerBatch) {
    throw new Error(`D1 analytics batch would exceed ${analyticsWorkerD1Budget.maxQueriesPerBatch} queries`);
  }
}

function stringDimension(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function hashFraction(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}
