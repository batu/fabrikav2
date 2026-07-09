/**
 * OwnedMirrorSink — the first-party ("owned") egress, CLIENT SIDE ONLY. This is
 * the distilled port of FTD's 337-line `OwnedAnalyticsMirror`: queue → batch →
 * POST → retry, over an INJECTABLE transport so it unit-tests against a fake
 * with zero network. The ingestion worker that receives these batches is a
 * later card (`packages/services: owned-analytics ...`); this file stops at the
 * `fetch` boundary.
 *
 * What survived the distillation (the parts that carry test value and matter to
 * the contract):
 *   - idempotency: every enqueue gets a unique `event_id` (injectable id gen),
 *   - batching: flush fires automatically once `batchSize` events are queued,
 *   - retry: only retryable statuses are retried, with a per-event attempt cap,
 *     and a failing flush STOPS rather than hammering a down backend,
 *   - observability: a `stats()` counter block (enqueued/sent/dropped/retried).
 * What was dropped as FTD-infra-specific: byte/age eviction, backoff-jitter
 * scheduling, HMAC identifier policy, keepalive tuning. The env marker rides in
 * every event body because payloads are built via `toWirePayload`.
 */
import type {
  AnalyticsEnvironment,
  AnalyticsEvent,
  AnalyticsParams,
} from './contract.ts';
import { toWirePayload } from './contract.ts';
import type { AnalyticsSink } from './sink.ts';
import { OWNED_ANALYTICS_WIRE_SCHEMA } from './wire.ts';
import type { OwnedAnalyticsWireEvent } from './wire.ts';

/**
 * Schema tag on every batch body; lets the worker version its ingest format.
 * Aliased to the shared {@link OWNED_ANALYTICS_WIRE_SCHEMA} so producer and
 * consumer cannot drift out of lockstep.
 */
export const OWNED_MIRROR_SCHEMA = OWNED_ANALYTICS_WIRE_SCHEMA;

/** HTTP statuses worth retrying (transient); everything else drops immediately. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);

export interface MirrorTransportRequest {
  readonly url: string;
  /** Sent as `Authorization: Bearer <publicClientKey>` by a real transport. */
  readonly publicClientKey: string;
  /** JSON string of a `OwnedAnalyticsWireBatch`: `{ schema, game_id, env, events }`. */
  readonly body: string;
}

export interface MirrorTransportResult {
  readonly ok: boolean;
  readonly status: number;
}

/** The one injected dependency — a real one POSTs; a fake one asserts. */
export type MirrorTransport = (
  request: MirrorTransportRequest,
) => Promise<MirrorTransportResult>;

export interface OwnedMirrorSinkOptions {
  readonly url: string;
  readonly publicClientKey: string;
  readonly transport: MirrorTransport;
  /** Which game's traffic this sink mirrors — rides the batch envelope. */
  readonly gameId: string;
  /** Environment marker for the batch envelope (partitions test from prod). */
  readonly env: AnalyticsEnvironment;
  /** Flush automatically once this many events are queued. Default 10. */
  readonly batchSize?: number;
  /** Drop an event after this many failed attempts. Default 3. */
  readonly maxAttempts?: number;
  /** Injected clock (for `enqueued_at`); default `Date.now`. */
  readonly now?: () => number;
  /** Injected id generator (idempotency); default `crypto.randomUUID`. */
  readonly generateId?: () => string;
}

export interface OwnedMirrorStats {
  readonly enqueued: number;
  readonly sent: number;
  readonly dropped: number;
  readonly retried: number;
  readonly queueLength: number;
  readonly dropReasons: Readonly<Record<string, number>>;
}

interface QueuedEvent {
  readonly event_id: string;
  readonly enqueued_at: number;
  readonly name: string;
  readonly params: AnalyticsParams;
  readonly attempt: number;
}

export interface OwnedMirrorSink extends AnalyticsSink {
  flush(): Promise<void>;
  stats(): OwnedMirrorStats;
}

export function createOwnedMirrorSink(
  options: OwnedMirrorSinkOptions,
): OwnedMirrorSink {
  const batchSize = options.batchSize ?? 10;
  const maxAttempts = options.maxAttempts ?? 3;
  const now = options.now ?? Date.now;
  const generateId = options.generateId ?? (() => crypto.randomUUID());

  const queue: QueuedEvent[] = [];
  // The single in-flight drain, shared by every concurrent flush() caller. When
  // null, no drain is running and the next flush() starts one. A caller that
  // arrives mid-drain gets THIS promise back (not an instant resolve), so it
  // only settles once the active drain has finished — including any events it
  // enqueued before calling, which the drain's `while (queue.length > 0)` loop
  // picks up in the same pass. Cleared in `finally` so the next flush() is fresh.
  let inFlight: Promise<void> | null = null;

  let enqueued = 0;
  let sent = 0;
  let dropped = 0;
  let retried = 0;
  const dropReasons: Record<string, number> = {};

  function recordDrop(count: number, reason: string): void {
    dropped += count;
    dropReasons[reason] = (dropReasons[reason] ?? 0) + count;
  }

  function toBodyEvent(event: QueuedEvent): OwnedAnalyticsWireEvent {
    return {
      event_id: event.event_id,
      enqueued_at: event.enqueued_at,
      name: event.name,
      params: event.params,
    };
  }

  function flush(): Promise<void> {
    // Concurrent callers share the one active drain rather than each firing a
    // duplicate send (or, as the old guard did, resolving instantly while zero
    // events had reached transport).
    if (inFlight) return inFlight;
    inFlight = drain().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.splice(0, batchSize);
      const body = JSON.stringify({
        schema: OWNED_MIRROR_SCHEMA,
        game_id: options.gameId,
        env: options.env,
        events: batch.map(toBodyEvent),
      });

      let result: MirrorTransportResult;
      try {
        result = await options.transport({
          url: options.url,
          publicClientKey: options.publicClientKey,
          body,
        });
      } catch {
        // Network throw is transient — treat as retryable (status 0).
        result = { ok: false, status: 0 };
      }

      if (result.ok) {
        sent += batch.length;
        continue;
      }

      const retryable =
        result.status === 0 || RETRYABLE_STATUSES.has(result.status);
      if (!retryable) {
        recordDrop(batch.length, `status_${result.status}`);
        continue;
      }

      // Retryable failure: bump attempts, drop the exhausted, requeue the rest
      // at the front, and STOP flushing so we don't hammer a down backend.
      retried += 1;
      const survivors: QueuedEvent[] = [];
      for (const event of batch) {
        const attempt = event.attempt + 1;
        if (attempt >= maxAttempts) {
          recordDrop(1, 'max_attempts');
        } else {
          survivors.push({ ...event, attempt });
        }
      }
      queue.unshift(...survivors);
      break;
    }
  }

  return {
    name: 'owned-mirror',

    emit(event: AnalyticsEvent): void {
      queue.push({
        event_id: generateId(),
        enqueued_at: now(),
        name: event.name,
        params: toWirePayload(event),
        attempt: 0,
      });
      enqueued += 1;
      if (queue.length >= batchSize) {
        void flush();
      }
    },

    flush,

    stats(): OwnedMirrorStats {
      return {
        enqueued,
        sent,
        dropped,
        retried,
        queueLength: queue.length,
        dropReasons: { ...dropReasons },
      };
    },
  };
}
